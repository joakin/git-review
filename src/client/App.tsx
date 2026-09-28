import { useEffect, useState } from "preact/hooks";
import { fetchDirectory, fetchLanguages, fetchProjectDiff, fetchProjectSearch, fetchProjectStatus, fetchProjectTree, fetchRoot, openProject } from "./api.ts";
import { diffCardId, diffCardKey, DiffCard } from "./DiffCard.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { SearchView, type SearchState } from "./SearchView.tsx";
import { anchorMatches, formatFeedback, maxDrafts, newLocalId, readCommentStore, recordSuccessfulCopy, saveCommentStore, type CommentAnchor, type CommentStore, type DraftComment } from "./comments.ts";
import { CommentEditor, FeedbackDialog, type CheckState, type EditorState } from "./ReviewDialogs.tsx";
import { InstallDataDialog, isInstallPromptEvent, type InstallPromptEvent } from "./InstallDataDialog.tsx";
import { emptyWorkspace, readActiveProject, readOpenCards, readSavedWorkspace, readWrapPreference, saveActiveProject, saveOpenCards, saveWorkspace, saveWrapPreference, withSelectedPath, type SavedWorkspace } from "./storage.ts";
import type { ChangeEntry, ChangeLayer, DirectoryListing, FileTree, LanguageOption, Project, ProjectStatus, RootInfo, SearchMatch } from "../shared/api.ts";

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
  const [viewMode, setViewMode] = useState<"changes" | "files" | "search">("changes");
  const [treePath, setTreePath] = useState("");
  const [tree, setTree] = useState<LoadState<FileTree>>({ kind: "loading" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [searchTarget, setSearchTarget] = useState<{ path: string; line: number; query: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [wrapCode, setWrapCode] = useState(readWrapPreference);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<"folders" | "changes" | "files">("folders");
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentStore | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [checkState, setCheckState] = useState<CheckState>("checking");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [undoCopyId, setUndoCopyId] = useState<string | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [installDataOpen, setInstallDataOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      if (!isInstallPromptEvent(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLanguages(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setLanguages(value); },
      () => { /* Automatic detection still works when the picker list is unavailable. */ },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function connect(): Promise<void> {
      try {
        const value = await fetchRoot(controller.signal);
        if (controller.signal.aborted) return;
        const restored = readSavedWorkspace(value.path);
        setSaved(restored);
        setRoot({ kind: "ready", value });
        const activePath = readActiveProject(value.path);
        if (activePath === null) return;
        try {
          const selected = await openProject(activePath, controller.signal);
          if (controller.signal.aborted) return;
          setProject(selected);
          setComments(readCommentStore(selected.id));
          setExpandedKeys(readOpenCards(selected.id));
          setPath(selected.path);
          setTreePath("");
          setSelectedFile(null);
          setSearchQuery("");
          setSubmittedQuery(null);
          setSearchState({ kind: "idle" });
          setViewMode("changes");
          setSidebarMode("changes");
        } catch {
          if (controller.signal.aborted) return;
          setNotice("The previous folder is unavailable. Choose a folder to continue.");
          saveActiveProject(value.path, null);
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
      (value) => { if (!controller.signal.aborted) { setStatus({ kind: "ready", value }); setRefreshing(false); if (value.kind === "not_git") { setViewMode((mode) => mode === "changes" ? "files" : mode); setSidebarMode((mode) => mode === "folders" ? mode : "files"); } } },
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
    if (project === null || viewMode !== "files") return;
    const controller = new AbortController();
    setTree({ kind: "loading" });
    fetchProjectTree(project.id, treePath, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setTree({ kind: "ready", value }); },
      (error: unknown) => { if (!controller.signal.aborted) setTree({ kind: "error", message: messageFor(error) }); },
    );
    return () => controller.abort();
  }, [project, viewMode, treePath, fileRefresh]);

  useEffect(() => {
    if (project === null || submittedQuery === null) return;
    const controller = new AbortController();
    setSearchState({ kind: "loading" });
    fetchProjectSearch(project.id, submittedQuery, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setSearchState({ kind: "ready", value }); },
      (error: unknown) => { if (!controller.signal.aborted) setSearchState({ kind: "error", message: messageFor(error) }); },
    );
    return () => controller.abort();
  }, [project, submittedQuery, searchRefresh]);

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
      setComments(readCommentStore(selected.id));
      setEditor(null);
      setFeedbackOpen(false);
      setReattachId(null);
      setExpandedKeys(readOpenCards(selected.id));
      setPath(selected.path);
      setTreePath("");
      setSelectedFile(null);
      setSearchQuery("");
      setSubmittedQuery(null);
      setSearchState({ kind: "idle" });
      setSearchTarget(null);
      setViewMode("changes");
      setSidebarMode("changes");
      setDrawerOpen(false);
      saveActiveProject(root.value.path, selected.path);
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

  function chooseView(mode: "changes" | "files" | "search"): void {
    setViewMode(mode);
    if (mode !== "search") setSidebarMode(mode);
    if (mode === "files" && selectedFile === null && window.matchMedia("(max-width: 900px)").matches) setDrawerOpen(true);
  }

  function submitSearch(): void {
    const query = searchQuery.trim();
    if (query.length === 0 || query.length > 128 || /[\0\r\n]/.test(query)) {
      setSearchState({ kind: "error", message: "Enter 1–128 characters on one line." });
      return;
    }
    if (query === submittedQuery) setSearchRefresh((value) => value + 1);
    else setSubmittedQuery(query);
  }

  function openSearchMatch(match: SearchMatch, query: string): void {
    setSelectedFile(match.path);
    setTreePath(match.path.includes("/") ? match.path.slice(0, match.path.lastIndexOf("/")) : "");
    setSearchTarget({ path: match.path, line: match.line, query });
    setViewMode("files");
    setSidebarMode("files");
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function updateComments(change: (current: CommentStore) => CommentStore): void {
    setComments((current) => {
      if (current === null) return current;
      const next = change(current);
      if (next !== current) saveCommentStore(next);
      return next;
    });
  }

  function chooseCommentLine(anchor: CommentAnchor): void {
    if (reattachId !== null) {
      updateComments((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === reattachId ? { ...draft, anchor, state: "current", updatedAt: Date.now() } : draft) }));
      setReattachId(null);
      setNotice("Comment reattached. Open Feedback to check the new line before copying.");
      return;
    }
    setEditor({ anchor, draftId: null, body: "" });
  }

  function closeEditor(): void {
    if (editor !== null && editor.body.trim().length > 0) {
      const savedEditor = editor;
      updateComments((current) => {
        const now = Date.now();
        if (savedEditor.draftId !== null) return { ...current, drafts: current.drafts.map((draft) => draft.id === savedEditor.draftId ? { ...draft, body: savedEditor.body.trim(), updatedAt: now } : draft) };
        if (current.drafts.length >= maxDrafts) {
          setNotice(`This project has reached the ${maxDrafts} comment limit.`);
          return current;
        }
        const draft: DraftComment = { id: newLocalId(), anchor: savedEditor.anchor, body: savedEditor.body.trim(), createdAt: now, updatedAt: now, state: "current" };
        return { ...current, drafts: [...current.drafts, draft] };
      });
    }
    setEditor(null);
  }

  function deleteEditor(): void {
    if (editor?.draftId !== null && editor !== null) {
      const id = editor.draftId;
      updateComments((current) => ({ ...current, drafts: current.drafts.filter((draft) => draft.id !== id) }));
    }
    setEditor(null);
  }

  async function checkComments(): Promise<CommentStore | null> {
    if (project === null || comments === null || comments.projectId !== project.id) return null;
    setCheckState("checking");
    setCheckError(null);
    try {
      const signal = new AbortController().signal;
      const latest = await fetchProjectStatus(project.id, signal);
      const results = new Map<string, Awaited<ReturnType<typeof fetchProjectDiff>>>();
      if (latest.kind === "git") {
        for (const draft of comments.drafts) {
          const key = `${draft.anchor.layer}:${draft.anchor.path}`;
          if (results.has(key) || !latest.entries.some((entry) => entry.layer === draft.anchor.layer && entry.path === draft.anchor.path)) continue;
          const result = await fetchProjectDiff(project.id, draft.anchor.layer, draft.anchor.path, latest.revision, null, signal);
          if (result.kind === "stale") throw new Error("The files changed during checking. Try again.");
          results.set(key, result);
        }
      }
      const checked: CommentStore = { ...comments, drafts: comments.drafts.map((draft) => ({ ...draft, state: (() => {
        const result = results.get(`${draft.anchor.layer}:${draft.anchor.path}`);
        return result !== undefined && anchorMatches(result, draft.anchor) ? "current" : "outdated";
      })() })) };
      updateComments((current) => current.projectId === checked.projectId ? checked : current);
      setCheckState("ready");
      return checked;
    } catch (error: unknown) {
      setCheckError(messageFor(error));
      setCheckState("error");
      return null;
    }
  }

  function openFeedback(): void {
    setFeedbackOpen(true);
    setCopyError(null);
    void checkComments();
  }

  async function copyFeedback(): Promise<void> {
    if (project === null || comments === null) return;
    const checked = await checkComments();
    if (checked === null) return;
    const text = formatFeedback(project.absolutePath, checked.drafts);
    if (text.length === 0) { setCopyError("No current comments to copy. Reattach outdated comments first."); return; }
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard access is unavailable here. Select the feedback text below to copy it manually.");
      await navigator.clipboard.writeText(text);
      const id = newLocalId();
      updateComments((current) => current.projectId === checked.projectId ? recordSuccessfulCopy(checked, text, Date.now(), id) : current);
      setUndoCopyId(id);
      setCopyError(null);
      setNotice("Feedback copied. The copied comments are in history; Undo restores them.");
    } catch (error: unknown) {
      setCopyError(messageFor(error));
    }
  }

  async function copyHistory(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard access is unavailable here. Expand this history entry and select its text instead.");
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setNotice("History feedback copied.");
    } catch (error: unknown) { setCopyError(messageFor(error)); }
  }

  function undoLastCopy(): void {
    if (undoCopyId === null) return;
    updateComments((current) => {
      if (current.history[0]?.id !== undoCopyId) return current;
      const entry = current.history[0];
      const existing = new Set(current.drafts.map((draft) => draft.id));
      return { ...current, drafts: [...current.drafts, ...entry.comments.filter((draft) => !existing.has(draft.id))], history: current.history.slice(1) };
    });
    setUndoCopyId(null);
    setNotice("Copied comments restored to your draft.");
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
        <button class="project-switch" type="button" onClick={() => { setSidebarMode(project === null ? "folders" : viewMode === "search" ? "files" : viewMode); setDrawerOpen(true); }}>
          <span class="switch-icon" aria-hidden="true">▦</span>
          <span class="switch-label">{project?.name ?? "Choose folder"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </header>

      <div class="workspace">
        {drawerOpen && <button class="drawer-scrim" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)} />}
        <aside class={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label={project !== null && sidebarMode === "changes" ? "Changed files" : project !== null && sidebarMode === "files" ? "Project files" : "Folder picker"}>
          <div class="sidebar-head">
            <div>
              <p class="eyebrow">ON THIS HOST</p>
              <h2>{project !== null && sidebarMode === "changes" ? "Changes" : project !== null && sidebarMode === "files" ? "Files" : "Folders"}</h2>
            </div>
            <button class="icon-button close-drawer" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)}>×</button>
          </div>

          {sidebarMode === "files" && project !== null ? <div class="sidebar-files">
            <div class="sidebar-project-name" title={project.absolutePath}>{project.name}</div>
            <button class="sidebar-switch-mode" type="button" onClick={() => setSidebarMode("folders")}>Browse host folders <span aria-hidden="true">→</span></button>
            <div class="file-tree-location">
              <span class="section-label">CURRENT DIRECTORY</span>
              <div class="folder-name-row">
                {treePath !== "" && <button class="back-button" type="button" aria-label="Go to parent directory" onClick={() => setTreePath(treePath.split("/").slice(0, -1).join("/"))}>←</button>}
                <strong title={treePath}>{treePath === "" ? project.name : shortName(treePath)}</strong>
              </div>
              <span class="folder-path">/{treePath}</span>
            </div>
            {tree.kind === "loading" && <p class="sidebar-message">Loading files…</p>}
            {tree.kind === "error" && <div class="sidebar-error" role="alert">{tree.message} <button type="button" onClick={() => setFileRefresh((value) => value + 1)}>Retry</button></div>}
            {tree.kind === "ready" && tree.value.entries.length === 0 && <p class="sidebar-message">This directory is empty.</p>}
            {tree.kind === "ready" && <div class="file-tree-list">{tree.value.entries.map((entry) => <button class={`file-tree-row${selectedFile === entry.path ? " file-tree-row-selected" : ""}`} type="button" key={entry.path} onClick={() => {
              if (entry.kind === "directory") setTreePath(entry.path);
              else { setSelectedFile(entry.path); setSearchTarget(null); setDrawerOpen(false); }
            }} title={entry.path}>
              <span class="file-tree-icon" aria-hidden="true">{entry.kind === "directory" ? "▰" : entry.kind === "symlink" ? "↗" : entry.kind === "other" ? "◇" : "▤"}</span>
              <span>{entry.name}</span>{entry.kind === "directory" && <span class="row-arrow" aria-hidden="true">›</span>}
            </button>)}</div>}
          </div> : sidebarMode === "changes" && project !== null ? <div class="sidebar-changes">
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
          {project !== null && <button class="sidebar-switch-mode" type="button" onClick={() => setSidebarMode(viewMode === "search" ? "files" : viewMode)}>Back to project files <span aria-hidden="true">→</span></button>}
          </>}
          <button class="sidebar-install-data" type="button" onClick={() => { setDrawerOpen(false); setInstallDataOpen(true); }}>Install & local data <span aria-hidden="true">↗</span></button>
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
              <nav class="project-view-tabs" aria-label="Project views">
                <button type="button" aria-current={viewMode === "changes" ? "page" : undefined} disabled={status.kind === "ready" && status.value.kind === "not_git"} onClick={() => chooseView("changes")}>Changes</button>
                <button type="button" aria-current={viewMode === "files" ? "page" : undefined} onClick={() => chooseView("files")}>Files</button>
                <button type="button" aria-current={viewMode === "search" ? "page" : undefined} onClick={() => chooseView("search")}>Search</button>
              </nav>
              {viewMode === "search" ? <SearchView query={searchQuery} state={searchState} onQuery={setSearchQuery} onSubmit={submitSearch} onRefresh={() => setSearchRefresh((value) => value + 1)} canRefresh={submittedQuery !== null} onOpen={openSearchMatch} /> : viewMode === "files" ? <>
                <div class="changes-heading">
                  <div><p class="eyebrow">WORKING TREE</p><h2>Browse files</h2></div>
                  <div class="changes-actions">
                    <button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button>
                    <button type="button" onClick={() => setFileRefresh((value) => value + 1)}>Refresh</button>
                  </div>
                </div>
                <div class="file-location-bar"><span>{selectedFile ?? (treePath === "" ? "Choose a file to read" : `/${treePath}`)}</span><button type="button" onClick={() => { setSidebarMode("files"); setDrawerOpen(true); }}>Browse files <span aria-hidden="true">☰</span></button></div>
                {selectedFile === null ? <p class="status-message">Open a folder or file from the Files list. Changes and feedback remain available when you return to review.</p> : <FileViewer key={`${project.id}:${selectedFile}`} projectId={project.id} path={selectedFile} wrap={wrapCode} languages={languages} refreshKey={fileRefresh} searchTarget={searchTarget?.path === selectedFile ? searchTarget : null} />}
              </> : <>
              <div class="changes-heading">
                <div><p class="eyebrow">GIT REVIEW</p><h2>Changed files</h2></div>
                <div class="changes-actions">
                  <button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button>
                  <button type="button" disabled={refreshing} onClick={() => setStatusRefresh((value) => value + 1)}>{refreshing ? "Refreshing…" : "Refresh"}</button>
                </div>
              </div>
              {status.kind === "loading" && <p class="status-message">Reading Git changes…</p>}
              {status.kind === "error" && <p class="status-message" role="alert">{status.message}</p>}
              {status.kind === "ready" && status.value.kind === "not_git" && <p class="status-message">This folder is not a Git worktree. Use Files to browse its contents.</p>}
              {gitStatus !== null && <>
                {gitStatus.entries.length === 0 && <p class="status-message">No changes in this folder.</p>}
                <div class="diff-groups">
                  {changeLayers.map(({ key, label }) => {
                    const group = gitStatus.entries.filter((entry) => entry.layer === key);
                    if (key === "conflict" && group.length === 0) return null;
                    return <section class={`diff-section diff-section-${key}`} key={key}>
                      <h3><span>{label}</span><span class="change-count">{group.length}</span></h3>
                      {group.length === 0 ? <p class="diff-section-empty">No {label.toLowerCase()} files</p> : group.map((entry) => <DiffCard
                        key={`${project.id}:${diffCardKey(entry)}`}
                        entry={entry}
                        projectId={project.id}
                        revision={gitStatus.revision}
                        refreshKey={statusRefresh}
                        expanded={expandedKeys.has(diffCardKey(entry))}
                        wrap={wrapCode}
                        languages={languages}
                        onToggle={() => toggleEntry(entry)}
                        onStale={() => setStatusRefresh((value) => value + 1)}
                        onComment={chooseCommentLine}
                        drafts={comments?.projectId === project.id ? comments.drafts.filter((draft) => draft.anchor.layer === entry.layer && draft.anchor.path === entry.path) : []}
                      />)}
                    </section>;
                  })}
                </div>
              </>}
              </>}
            </div>
          )}
        </main>
      </div>
      {project !== null && <button class="feedback-launch" type="button" onClick={openFeedback}>Feedback <span>{comments?.projectId === project.id ? comments.drafts.length : 0}</span></button>}
      {reattachId !== null && <div class="reattach-banner" role="status">Tap a new line number to reattach this comment. <button type="button" onClick={() => setReattachId(null)}>Cancel</button></div>}
      {editor !== null && <CommentEditor editor={editor} onBody={(body) => setEditor((current) => current === null ? current : { ...current, body })} onClose={closeEditor} onDelete={deleteEditor} />}
      {feedbackOpen && project !== null && comments?.projectId === project.id && <FeedbackDialog store={comments} projectPath={project.absolutePath} checkState={checkState} error={checkError} copyError={copyError} onClose={() => setFeedbackOpen(false)} onCheck={() => void checkComments()} onCopy={() => void copyFeedback()} onEdit={(draft) => { setFeedbackOpen(false); setEditor({ anchor: draft.anchor, draftId: draft.id, body: draft.body }); }} onReattach={(draft) => { setFeedbackOpen(false); setReattachId(draft.id); selectEntry({ layer: draft.anchor.layer, path: draft.anchor.path, kind: "modified", oldPath: null, isSubmodule: false }); }} onUndo={undoLastCopy} canUndo={undoCopyId !== null && comments.history[0]?.id === undoCopyId} onCopyHistory={(text) => void copyHistory(text)} />}
      {installDataOpen && <InstallDataDialog rootPath={root.kind === "ready" ? root.value.path : null} installPrompt={installPrompt} onInstallHandled={() => setInstallPrompt(null)} onClose={() => setInstallDataOpen(false)} />}
    </div>
  );
}
