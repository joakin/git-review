import { useEffect, useState } from "preact/hooks";
import { fetchDirectory, fetchRoot, openProject } from "./api.ts";
import { emptyWorkspace, readSavedWorkspace, saveWorkspace, withSelectedPath, type SavedWorkspace } from "./storage.ts";
import type { DirectoryListing, Project, RootInfo } from "../shared/api.ts";

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

export function App() {
  const [saved, setSaved] = useState<SavedWorkspace>(() => emptyWorkspace(""));
  const [root, setRoot] = useState<LoadState<RootInfo>>({ kind: "loading" });
  const [listing, setListing] = useState<LoadState<DirectoryListing>>({ kind: "loading" });
  const [path, setPath] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
          setPath(selected.path);
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
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

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
      setProject(selected);
      setPath(selected.path);
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

  const rootLabel = root.kind === "ready" ? root.value.label : "Host folders";
  const folderLabel = listing.kind === "ready" ? shortName(listing.value.path) : shortName(path);

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand" aria-label="git-review">
          <span class="brand-mark" aria-hidden="true">{`{ }`}</span>
          <span>git<span class="brand-accent">review</span></span>
        </div>
        <span class="topbar-divider" aria-hidden="true" />
        <span class="topbar-context">Local workspace</span>
        <button class="project-switch" type="button" onClick={() => setDrawerOpen(true)}>
          <span class="switch-icon" aria-hidden="true">▦</span>
          <span class="switch-label">{project?.name ?? "Choose folder"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </header>

      <div class="workspace">
        {drawerOpen && <button class="drawer-scrim" type="button" aria-label="Close folder picker" onClick={() => setDrawerOpen(false)} />}
        <aside class={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label="Folder picker">
          <div class="sidebar-head">
            <div>
              <p class="eyebrow">ON THIS HOST</p>
              <h2>Folders</h2>
            </div>
            <button class="icon-button close-drawer" type="button" aria-label="Close folder picker" onClick={() => setDrawerOpen(false)}>×</button>
          </div>

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
            <div class="project-view">
              <div class="project-intro">
                <p class="eyebrow">CURRENT WORKSPACE</p>
                <h1>{project.name}</h1>
                <p class="project-path">{project.absolutePath}</p>
              </div>
              <div class="project-ready">
                <div class="ready-icon" aria-hidden="true">✓</div>
                <div>
                  <h2>Folder ready</h2>
                  <p>This folder is connected to your local review workspace. You can switch folders at any time.</p>
                </div>
                <button type="button" onClick={() => setDrawerOpen(true)}>Change folder <span aria-hidden="true">→</span></button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
