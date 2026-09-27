import { useEffect, useState } from "preact/hooks";
import { fetchDirectory, fetchProjectStatus, fetchRoot, openProject } from "./api.ts";
import { diffCardId, diffCardKey, DiffCard } from "./DiffCard.tsx";
import { emptyWorkspace, readOpenCards, readSavedWorkspace, readWrapPreference, saveOpenCards, saveWorkspace, saveWrapPreference, withSelectedPath, type SavedWorkspace } from "./storage.ts";
import type { ChangeEntry, ChangeLayer, DirectoryListing, Project, ProjectStatus, RootInfo } from "../shared/api.ts";

type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; value: T }
  | { kind: "error"; message: string };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function shortName(path: string): string {
  if (path === "") return "Root folder";
  return path.slice(path.lastIndexOf("/") + 1);
}

const changeLayers: readonly { key: ChangeLayer; label: string }[] = [
  { key: "conflict", label: "Conflicts" },
  { key: "staged", label: "Staged" },
  { key: "unstaged", label: "Unstaged" },
  { key: "untracked", label: "Untracked" },
];

function ChangeGroups({ entries, onSelect }: { entries: readonly ChangeEntry[]; onSelect: (entry: ChangeEntry) => void }) {
  return <div class="change-groups change-groups-compact">
    {changeLayers.map(({ key, label }) => {
      const group = entries.filter((entry) => entry.layer === key);
      if (key === "conflict" && group.length === 0) return null;
      return <section class={`change-group change-group-${key}`} key={key}>
        <h2><span>{label}</span><span class="change-count">{group.length}</span></h2>
        {group.length === 0 ? <p class="change-empty">No {label.toLowerCase()} files</p> : <ul>
          {group.map((entry) => <li key={diffCardKey(entry)}><button class="change-row-button" type="button" onClick={() => onSelect(entry)} aria-label={`Open ${entry.layer} diff for ${entry.path}`}>
            <span class={`change-mark change-mark-${entry.kind}`} aria-hidden="true">{entry.kind === "conflicted" ? "!" : entry.kind === "deleted" ? "−" : entry.kind === "added" ? "+" : "•"}</span>
            <span class="change-file">
              <strong title={entry.path}>{entry.path}</strong>
              <small><span class="change-kind">{entry.kind.replace("_", " ")}</span>{entry.oldPath === null ? "" : ` from ${entry.oldPath}`}{entry.isSubmodule ? " · submodule" : ""}</small>
            </span>
          </button></li>)}
        </ul>}
      </section>;
    })}
  </div>;
}

export function App() {
  const [saved, setSaved] = useState<SavedWorkspace>(() => emptyWorkspace(""));
  const [root, setRoot] = useState<LoadState<RootInfo>>({ kind: "loading" });
  const [listing, setListing] = useState<LoadState<DirectoryListing>>({ kind: "loading" });
  const [path, setPath] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<LoadState<ProjectStatus>>({ kind: "loading" });
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [wrapCode, setWrapCode] = useState(readWrapPreference);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<"folders" | "changes">("folders");
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function connect(): Promise<void> {
      try {
        const value = await fetchRoot(controller.signal);
        if (controller.signal.aborted) return;
        const restored = readSavedWorkspace(value.path);
        setSaved(restored);
        setRoot({ kind: "ready", value });
        if (restored.activePath === null) return;
        try {
          const selected = await openProject(restored.activePath, controller.signal);
          if (controller.signal.aborted) return;
          setProject(selected);
          setExpandedKeys(readOpenCards(selected.id));
          setPath(selected.path);
          setSidebarMode("changes");
        } catch {
          if (controller.signal.aborted) return;
          setNotice("The previous folder is unavailable. Choose a folder to continue.");
          const reset: SavedWorkspace = { ...restored, activePath: null };
          saveWorkspace(reset);
          setSaved(reset);
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) setRoot({ kind: "error", message: messageFor(error) });
      }
    }
    void connect();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setListing({ kind: "loading" });
    fetchDirectory(path, controller.signal).then(
      (value) => setListing({ kind: "ready", value }),
      (error: unknown) => {
        if (!controller.signal.aborted) setListing({ kind: "error", message: messageFor(error) });
      },
    );
    return () => controller.abort();
  }, [path]);

  useEffect(() => {
    if (project === null) return;
    const controller = new AbortController();
    setRefreshing(true);
    fetchProjectStatus(project.id, controller.signal).then(
      (value) => { if (!controller.signal.aborted) { setStatus({ kind: "ready", value }); setRefreshing(false); } },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = messageFor(error);
        setStatus((current) => current.kind === "ready" ? current : { kind: "error", message });
        setNotice(message);
        setRefreshing(false);
      },
    );
    return () => controller.abort();
  }, [project, statusRefresh]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (project !== null) saveOpenCards(project.id, expandedKeys);
  }, [project, expandedKeys]);

  async function selectFolder(selectedPath: string): Promise<void> {
    if (opening) return;
    if (root.kind !== "ready") {
      setNotice("The host folder root is not available yet.");
      return;
    }
    setOpening(true);
    setNotice(null);
    try {
      const selected = await openProject(selectedPath, new AbortController().signal);
      setStatus({ kind: "loading" });
      setProject(selected);
      setExpandedKeys(readOpenCards(selected.id));
      setPath(selected.path);
      setSidebarMode("changes");
      setDrawerOpen(false);
      setSaved((current) => {
        const scoped = current.rootPath === root.value.path ? current : emptyWorkspace(root.value.path);
        const next = withSelectedPath(scoped, selected.path);
        saveWorkspace(next);
        return next;
      });
    } catch (error: unknown) {
      setNotice(messageFor(error));
    } finally {
      setOpening(false);
    }
  }

  function toggleEntry(entry: ChangeEntry): void {
    const key = diffCardKey(entry);
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectEntry(entry: ChangeEntry): void {
    const key = diffCardKey(entry);
    setExpandedKeys((current) => new Set(current).add(key));
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      document.getElementById(diffCardId(entry))?.scrollIntoView({ behavior, block: "start" });
    });
  }

  function toggleWrap(): void {
    setWrapCode((current) => {
      const next = !current;
      saveWrapPreference(next);
      return next;
    });
  }

  const rootLabel = root.kind === "ready" ? root.value.label : "Host folders";
  const folderLabel = listing.kind === "ready" ? shortName(listing.value.path) : shortName(path);
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand" aria-label="git-review">
          <span class="brand-mark" aria-hidden="true">{`{ }`}</span>
          <span>git<span class="brand-accent">review</span></span>
        </div>
        <span class="topbar-divider" aria-hidden="true" />
        <span class="topbar-context">Local workspace</span>
        <button class="project-switch" type="button" onClick={() => { setSidebarMode(project === null ? "folders" : "changes"); setDrawerOpen(true); }}>
          <span class="switch-icon" aria-hidden="true">▦</span>
          <span class="switch-label">{project?.name ?? "Choose folder"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </header>

      <div class="workspace">
        {drawerOpen && <button class="drawer-scrim" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)} />}
        <aside class={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label={sidebarMode === "changes" && project !== null ? "Changed files" : "Folder picker"}>
          <div class="sidebar-head">
            <div>
              <p class="eyebrow">ON THIS HOST</p>
              <h2>{sidebarMode === "changes" && project !== null ? "Changes" : "Folders"}</h2>
            </div>
            <button class="icon-button close-drawer" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)}>×</button>
          </div>

          {sidebarMode === "changes" && project !== null ? <div class="sidebar-changes">
            <div class="sidebar-project-name" title={project.absolutePath}>{project.name}</div>
            <button class="sidebar-switch-mode" type="button" onClick={() => setSidebarMode("folders")}>Browse host folders <span aria-hidden="true">→</span></button>
            {status.kind === "loading" && <p class="sidebar-message">Reading Git changes…</p>}
            {status.kind === "error" && <p class="sidebar-error" role="alert">{status.message}</p>}
            {status.kind === "ready" && status.value.kind === "not_git" && <p class="sidebar-message">This folder is not a Git worktree.</p>}
            {gitStatus !== null && <ChangeGroups entries={gitStatus.entries} onSelect={selectEntry} />}
          </div> : <>

          <div class="root-card">
            <span class="root-dot" aria-hidden="true" />
            <div class="root-copy">
              <strong>{rootLabel}</strong>
              <span>{root.kind === "ready" ? root.value.path : "Connecting to the local server"}</span>
            </div>
          </div>

          <div class="folder-location">
            <span class="section-label">CURRENT FOLDER</span>
            <div class="folder-name-row">
              {listing.kind === "ready" && listing.value.parentPath !== null && (
                <button class="back-button" type="button" aria-label="Go to parent folder" onClick={() => setPath(listing.value.parentPath ?? "")}>←</button>
              )}
              <strong title={path}>{folderLabel}</strong>
            </div>
            <span class="folder-path">{path === "" ? "/" : `/${path}`}</span>
            <button class="open-button" type="button" disabled={root.kind !== "ready" || listing.kind !== "ready" || opening} onClick={() => void selectFolder(path)}>
              {opening ? "Opening…" : "Open this folder"} <span aria-hidden="true">↗</span>
            </button>
          </div>

          <div class="folder-list-section">
            <div class="section-heading"><span class="section-label">SUBFOLDERS</span><span>{listing.kind === "ready" ? listing.value.entries.length : ""}</span></div>
            {listing.kind === "loading" && <p class="sidebar-message">Loading folders…</p>}
            {listing.kind === "error" && (
              <div class="sidebar-error" role="alert">
                <p>{listing.message}</p>
                <button type="button" onClick={() => setPath("")}>Back to root</button>
              </div>
            )}
            {listing.kind === "ready" && listing.value.entries.length === 0 && <p class="sidebar-message">No subfolders here.</p>}
            {listing.kind === "ready" && listing.value.entries.map((entry) => (
              <button class="folder-row" type="button" key={entry.path} onClick={() => setPath(entry.path)}>
                <span class="folder-glyph" aria-hidden="true">▰</span>
                <span class="folder-row-name">{entry.name}</span>
                <span class="row-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>

          {saved.recentPaths.length > 0 && (
            <div class="recent-section">
              <span class="section-label">RECENT FOLDERS</span>
              {saved.recentPaths.map((recentPath) => (
                <button class="recent-row" type="button" key={recentPath} onClick={() => void selectFolder(recentPath)}>
                  <span aria-hidden="true">↺</span>
                  <span><strong>{shortName(recentPath)}</strong><small>{recentPath === "" ? "/" : `/${recentPath}`}</small></span>
                </button>
              ))}
            </div>
          )}
          {project !== null && <button class="sidebar-switch-mode" type="button" onClick={() => setSidebarMode("changes")}>Back to changes <span aria-hidden="true">→</span></button>}
          </>}
        </aside>

        <main class="main-content">
          <div class="page-topline">
            <span class="local-indicator"><span aria-hidden="true" /> LOCAL ONLY</span>
            <span class="page-topline-note">Your files stay on this host</span>
          </div>
          {notice !== null && <div class="notice" role="alert">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
          {root.kind === "error" && <div class="notice" role="alert">{root.message}</div>}

          {project === null ? (
            <div class="welcome">
              <div class="hero-orb" aria-hidden="true"><span>⌁</span></div>
              <p class="eyebrow">A CLEARER WAY TO REVIEW</p>
              <h1>Start with a folder.</h1>
              <p class="welcome-copy">Choose a project on this computer to make it your review workspace.</p>
              <button class="primary-action" type="button" onClick={() => setDrawerOpen(true)}>Browse host folders <span aria-hidden="true">→</span></button>
              <div class="welcome-foot"><span class="line-decor" aria-hidden="true" /> Staged, unstaged, and untracked changes will live here.</div>
            </div>
          ) : (
            <div class="project-view project-view-changes">
              <div class="project-intro">
                <p class="eyebrow">CURRENT WORKSPACE</p>
                <h1>{project.name}</h1>
                <p class="project-path">{project.absolutePath}</p>
              </div>
              <div class="changes-heading">
                <div><p class="eyebrow">GIT REVIEW</p><h2>Changed files</h2></div>
                <div class="changes-actions">
                  <button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button>
                  <button type="button" disabled={refreshing} onClick={() => setStatusRefresh((value) => value + 1)}>{refreshing ? "Refreshing…" : "Refresh"}</button>
                </div>
              </div>
              {status.kind === "loading" && <p class="status-message">Reading Git changes…</p>}
              {status.kind === "error" && <p class="status-message" role="alert">{status.message}</p>}
              {status.kind === "ready" && status.value.kind === "not_git" && <p class="status-message">This folder is not a Git worktree. File browsing will be available in a later slice.</p>}
              {gitStatus !== null && <>
                {gitStatus.entries.length === 0 && <p class="status-message">No changes in this folder.</p>}
                <div class="diff-groups">
                  {changeLayers.map(({ key, label }) => {
                    const group = gitStatus.entries.filter((entry) => entry.layer === key);
                    if (key === "conflict" && group.length === 0) return null;
                    return <section class={`diff-section diff-section-${key}`} key={key}>
                      <h3><span>{label}</span><span class="change-count">{group.length}</span></h3>
                      {group.length === 0 ? <p class="diff-section-empty">No {label.toLowerCase()} files</p> : group.map((entry) => <DiffCard
                        key={diffCardKey(entry)}
                        entry={entry}
                        projectId={project.id}
                        revision={gitStatus.revision}
                        expanded={expandedKeys.has(diffCardKey(entry))}
                        wrap={wrapCode}
                        onToggle={() => toggleEntry(entry)}
                        onStale={() => setStatusRefresh((value) => value + 1)}
                      />)}
                    </section>;
                  })}
                </div>
              </>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
