import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { fetchDirectory, fetchLanguages, fetchProjectDiff, fetchProjectSearch, fetchProjectStatus, fetchProjectTree, fetchRoot, openProject } from "./api.ts";
import { diffCardId, diffCardKey, DiffCard } from "./DiffCard.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { CommitViewer } from "./CommitViewer.tsx";
import { GitSidebar } from "./GitSidebar.tsx";
import { useGitBrowser } from "./git-browser.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { Icon } from "./Icons.tsx";
import { CodeSelectionSearch } from "./CodeSelectionSearch.tsx";
import { SearchView, type SearchState } from "./SearchView.tsx";
import { maxDrafts, newLocalId, readCommentStore, saveCommentStore, undoSuccessfulCopy, type CommentAnchor, type CommentStore, type DraftComment } from "./comments.ts";
import { FeedbackTransactions, type FeedbackState } from "./feedback-transactions.ts";
import { CommentEditor, FeedbackDialog, type EditorState } from "./ReviewDialogs.tsx";
import { InstallDataDialog, isInstallPromptEvent, type InstallPromptEvent } from "./InstallDataDialog.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { googleFontStylesheet } from "./code-fonts.ts";
import { parentDirectory, parseNavigationSearch, routeProjectPath, routeSection, routeUrl, type Route, type RouteState } from "./navigation.ts";
import { appearanceStorageKey, codeTypographyStorageKey, emptyWorkspace, readActiveProject, readAppearance, readCodeTypography, readOpenCards, readSavedWorkspace, readWrapPreference, resolveAppearance, saveActiveProject, saveAppearance, saveCodeTypography, saveOpenCards, saveWorkspace, saveWrapPreference, validateAppearance, validateCodeTypography, withSelectedPath, type Appearance, type CodeTypography, type SavedWorkspace } from "./storage.ts";
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
const changePollIntervalMs = 10_000;

type ReviewPosition = { projectId: string; cardId: string | null; cardIndex: number; top: number; scrollY: number };

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
  const [listingLoad, setListingLoad] = useState<{ key: string; state: LoadState<DirectoryListing> }>({ key: "", state: { kind: "loading" } });
  const [openedProject, setOpenedProject] = useState<Project | null>(null);
  const openedProjectRef = useRef<Project | null>(null);
  const [status, setStatus] = useState<LoadState<ProjectStatus>>({ kind: "loading" });
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const [changeCheckError, setChangeCheckError] = useState(false);
  const reviewPosition = useRef<ReviewPosition | null>(null);
  const [treeLoad, setTreeLoad] = useState<{ key: string; state: LoadState<FileTree> } | null>(null);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<string | null>(null);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const [searchLoad, setSearchLoad] = useState<{ key: string; state: SearchState } | null>(null);
  const [routeState, setRouteState] = useState<RouteState>(() => parseNavigationSearch(window.location.search));
  const route = routeState.kind === "ready" ? routeState.route : null;
  const routeRef = useRef<Route | null>(route);
  const focusedChangesRoute = useRef<Route | null>(null);
  const routeProject = route === null ? null : routeProjectPath(route);
  const project = openedProject?.path === routeProject ? openedProject : null;
  const viewMode = route === null ? null : routeSection(route);
  const gitRoute = route?.section === "git" ? route : null;
  const path = route?.section === "projects" ? route.directory : "";
  const listing = listingLoad.key === path ? listingLoad.state : { kind: "loading" } as const;
  const treePath = route?.section === "files" ? route.directory : route?.section === "search" && route.target.kind === "file" ? parentDirectory(route.target.path) : "";
  const treeKey = project === null ? null : `${project.id}\0${treePath}`;
  const tree = treeKey !== null && treeLoad?.key === treeKey ? treeLoad.state : { kind: "loading" } as const;
  const selectedFile = route?.section === "files" && route.target.kind === "file" || route?.section === "search" && route.target.kind === "file" ? route.target.path : null;
  const submittedQuery = route?.section === "search" ? route.query : null;
  const searchKey = project === null ? null : `${project.id}\0${submittedQuery ?? ""}`;
  const searchState = searchKey === null ? { kind: "idle" } as const : searchLoad?.key === searchKey ? searchLoad.state : submittedQuery === null ? { kind: "idle" } as const : { kind: "loading" } as const;
  const searchTarget = route?.section === "search" && route.target.kind === "file" && route.query !== null ? { path: route.target.path, line: route.target.line, query: route.query } : route?.section === "files" && route.target.kind === "file" && route.target.line !== null ? { path: route.target.path, line: route.target.line, query: null } : null;
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [wrapCode, setWrapCode] = useState(readWrapPreference);
  const [codeTypography, setCodeTypography] = useState(readCodeTypography);
  const [appearance, setAppearance] = useState(readAppearance);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const settingsOpen = route?.section === "settings";
  const settingsBackRoute = useRef<Route | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [projectOpenError, setProjectOpenError] = useState<{ path: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentStore | null>(null);
  const commentsRef = useRef<CommentStore | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({ check: { kind: "idle" }, copy: { kind: "idle" } });
  const [undoCopyId, setUndoCopyId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [installDataOpen, setInstallDataOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const git = useGitBrowser(project, gitRoute);
  const lastGitRefs = useRef(new Map<string, string>());
  const feedbackRef = useRef<FeedbackTransactions | null>(null);
  if (feedbackRef.current === null) feedbackRef.current = new FeedbackTransactions({
    readStore: () => commentsRef.current,
    updateStore: updateComments,
    onState: setFeedbackState,
    onCopied: (result) => {
      if (result.kind === "feedback") {
        setUndoCopyId(result.id);
        setUndoError(null);
        setNotice("Feedback copied. The copied comments are in history; Undo restores them.");
      } else setNotice("History feedback copied.");
    },
    fetchStatus: fetchProjectStatus,
    fetchDiff: fetchProjectDiff,
    writeText: async (text) => {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard access is unavailable here. Select the feedback or history text to copy it manually.");
      await navigator.clipboard.writeText(text);
    },
  });
  const feedback = feedbackRef.current;
  useEffect(() => () => feedback.cancel(), [feedback]);

  useEffect(() => {
    if (project === null || gitRoute === null) return;
    if (gitRoute.ref !== null) { lastGitRefs.current.set(project.id, gitRoute.ref); return; }
    if (git.refs.kind !== "ready" || git.refs.value.kind !== "git") return;
    const head = git.refs.value.head;
    // Resolving the default branch completes this destination. Keep an opened
    // list drawer and its reading position while canonicalizing the URL.
    const next = { ...gitRoute, ref: head.kind === "detached" ? "HEAD" : head.ref };
    const url = routeUrl(next);
    scrollPositions.current.set(url, window.scrollY);
    routeRef.current = next;
    window.history.replaceState(null, "", url);
    setRouteState({ kind: "ready", route: next });
  }, [project, gitRoute, git.refs]);

  function navigate(next: Route, mode: "push" | "replace" = "push"): void {
    feedback.cancel();
    const previous = routeRef.current;
    if (previous !== null) scrollPositions.current.set(routeUrl(previous), window.scrollY);
    routeRef.current = next;
    closeEditor();
    setFeedbackOpen(false);
    setDrawerOpen(false);
    setMenuOpen(false);
    const url = routeUrl(next);
    if (mode === "push" && window.location.pathname + window.location.search !== url) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setRouteState({ kind: "ready", route: next });
    if (next.section !== "settings") window.scrollTo({ top: 0, behavior: "instant" });
  }

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    const onPopState = (): void => {
      feedback.cancel();
      const previous = routeRef.current;
      if (previous !== null) scrollPositions.current.set(routeUrl(previous), window.scrollY);
      const parsed = parseNavigationSearch(window.location.search);
      if (parsed.kind === "empty" && root.kind === "ready") {
        const active = readActiveProject(root.value.path);
        navigate(active === null ? { section: "projects", directory: "" } : { section: "changes", projectPath: active, target: { kind: "all" } }, "replace");
      } else {
        routeRef.current = parsed.kind === "ready" ? parsed.route : null;
        closeEditor();
        setFeedbackOpen(false);
        setDrawerOpen(false);
        setMenuOpen(false);
        setRouteState(parsed);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [root]);

  useEffect(() => {
    if (routeState.kind !== "ready") return;
    const canonical = routeUrl(routeState.route);
    if (window.location.pathname + window.location.search !== canonical) window.history.replaceState(null, "", canonical);
  }, [routeState]);

  useLayoutEffect(() => {
    if (route?.section === "search") {
      setSearchQuery(route.query ?? "");
      if (route.query !== null) setLastSubmittedQuery(route.query);
    }
  }, [route?.section, route?.section === "search" ? route.query : null]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === codeTypographyStorageKey || event.key === null) setCodeTypography(readCodeTypography());
      if (event.key === appearanceStorageKey || event.key === null) setAppearance(readAppearance());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const { appTheme, codeTheme } = resolveAppearance(appearance, systemDark);
  useLayoutEffect(() => {
    document.documentElement.dataset["appTheme"] = appTheme;
    document.documentElement.dataset["codeTheme"] = codeTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor !== null) themeColor.content = appTheme === "dark" ? "#08151d" : "#101823";
  }, [appTheme, codeTheme]);

  useEffect(() => {
    const stylesheet = googleFontStylesheet(codeTypography.fontFamily);
    if (stylesheet === null) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheet;
    document.head.append(link);
    return () => link.remove();
  }, [codeTypography.fontFamily]);

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
        if (parseNavigationSearch(window.location.search).kind === "empty") {
          const activePath = readActiveProject(value.path);
          navigate(activePath === null ? { section: "projects", directory: "" } : { section: "changes", projectPath: activePath, target: { kind: "all" } }, "replace");
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) setRoot({ kind: "error", message: messageFor(error) });
      }
    }
    void connect();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (root.kind !== "ready" || routeProject === null || openedProjectRef.current?.path === routeProject) return;
    const controller = new AbortController();
    setOpening(true);
    setProjectOpenError(null);
    setStatus({ kind: "loading" });
    setPendingUpdate(false);
    setChangeCheckError(false);
    reviewPosition.current = null;
    openedProjectRef.current = null;
    setOpenedProject(null);
    setEditor(null);
    setFeedbackOpen(false);
    setReattachId(null);
    openProject(routeProject, controller.signal).then(
      (selected) => {
        if (controller.signal.aborted) return;
        openedProjectRef.current = selected;
        setOpenedProject(selected);
        const storedComments = readCommentStore(selected.id);
        commentsRef.current = storedComments;
        setComments(storedComments);
        setUndoCopyId(null);
        setUndoError(null);
        setExpandedKeys(readOpenCards(selected.id));
        saveActiveProject(root.value.path, selected.path);
        setSaved((current) => {
          const scoped = current.rootPath === root.value.path ? current : emptyWorkspace(root.value.path);
          const next = withSelectedPath(scoped, selected.path);
          saveWorkspace(next);
          return next;
        });
        setOpening(false);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setProjectOpenError({ path: routeProject, message: messageFor(error) });
        setOpening(false);
      },
    );
    return () => controller.abort();
  }, [root, routeProject]);

  useEffect(() => {
    const controller = new AbortController();
    setListingLoad((current) => current.key === path && current.state.kind === "ready" ? current : { key: path, state: { kind: "loading" } });
    fetchDirectory(path, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setListingLoad({ key: path, state: { kind: "ready", value } }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setListingLoad({ key: path, state: { kind: "error", message: messageFor(error) } });
      },
    );
    return () => controller.abort();
  }, [path]);

  useEffect(() => {
    if (project === null) return;
    const controller = new AbortController();
    setRefreshing(true);
    fetchProjectStatus(project.id, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setStatus({ kind: "ready", value });
        setPendingUpdate(false);
        setChangeCheckError(false);
        setRefreshing(false);
        if (value.kind === "not_git" && route?.section === "changes") navigate({ section: "files", projectPath: project.path, directory: "", target: { kind: "list" } }, "replace");
      },
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
    if (project === null || status.kind !== "ready" || status.value.kind !== "git" || viewMode !== "changes" || settingsOpen || editor !== null || feedbackOpen || installDataOpen || refreshing) return;
    const projectId = project.id;
    const displayedToken = status.value.changeToken;
    let timer: number | null = null;
    let request: AbortController | null = null;
    let disposed = false;
    let checkOnResume = false;
    let failures = 0;
    const clearTimer = (): void => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
    const check = async (): Promise<void> => {
      if (disposed || document.visibilityState !== "visible" || request !== null) return;
      clearTimer();
      const controller = new AbortController();
      request = controller;
      try {
        const latest = await fetchProjectStatus(projectId, controller.signal);
        if (disposed || controller.signal.aborted) return;
        setPendingUpdate(latest.kind !== "git" || latest.changeToken !== displayedToken);
        setChangeCheckError(false);
        failures = 0;
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 2) setChangeCheckError(true);
      } finally {
        if (request === controller) request = null;
        if (!disposed && document.visibilityState === "visible") {
          if (checkOnResume) { checkOnResume = false; void check(); }
          else timer = window.setTimeout(() => void check(), changePollIntervalMs);
        }
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") { clearTimer(); request?.abort(); return; }
      if (request !== null) checkOnResume = true;
      else void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void check();
    return () => { disposed = true; clearTimer(); request?.abort(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [project, status, viewMode, settingsOpen, editor, feedbackOpen, installDataOpen, refreshing]);

  useEffect(() => {
    const position = reviewPosition.current;
    if (position === null || project?.id !== position.projectId || status.kind !== "ready" || refreshing) return;
    reviewPosition.current = null;
    requestAnimationFrame(() => {
      const cards = [...document.querySelectorAll<HTMLElement>("main .diff-card")];
      const target = (position.cardId === null ? null : document.getElementById(position.cardId)) ?? cards[Math.min(position.cardIndex, cards.length - 1)] ?? document.querySelector<HTMLElement>(".changes-heading");
      if (target === null) { window.scrollTo({ top: position.scrollY, behavior: "instant" }); return; }
      window.scrollBy({ top: target.getBoundingClientRect().top - position.top, behavior: "instant" });
    });
  }, [project, status, refreshing]);

  useEffect(() => {
    if (route?.section !== "changes" || route.target.kind !== "file" || focusedChangesRoute.current === route || project?.path !== route.projectPath || status.kind !== "ready" || status.value.kind !== "git") return;
    const target = route.target;
    const entry = status.value.entries.find((candidate) => candidate.layer === target.layer && candidate.path === target.path);
    if (entry === undefined) {
      setNotice("This changed file is no longer in the current Git inventory. Refresh or choose another file.");
      return;
    }
    const key = diffCardKey(entry);
    setExpandedKeys((current) => current.has(key) ? current : new Set(current).add(key));
    const frame = requestAnimationFrame(() => {
      if (routeRef.current !== route) return;
      const card = document.getElementById(diffCardId(entry));
      if (card === null) return;
      // The URL selects a card once per navigation; later review interactions stay put.
      focusedChangesRoute.current = route;
      card.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [route, project, status]);

  useLayoutEffect(() => {
    if (route === null || route.section === "changes" && route.target.kind === "file" || route.section === "files" && route.target.kind === "file" || route.section === "search" && route.target.kind === "file") return;
    if (route.section === "search" && route.query !== null && searchState.kind === "loading") return;
    if (route.section === "git" && (route.target.kind === "commit" ? git.detail.kind === "loading" : git.refs.kind === "loading" || route.ref !== null && !git.unborn && git.history.kind === "loading" && git.refs.kind === "ready" && git.refs.value.kind === "git")) return;
    window.scrollTo({ top: scrollPositions.current.get(routeUrl(route)) ?? 0, behavior: "instant" });
  }, [route, searchState.kind, git.detail.kind, git.history.kind, git.refs.kind, git.unborn]);

  useEffect(() => {
    if (project === null || viewMode !== "files") return;
    const controller = new AbortController();
    const key = `${project.id}\0${treePath}`;
    setTreeLoad((current) => current?.key === key && current.state.kind === "ready" ? current : { key, state: { kind: "loading" } });
    fetchProjectTree(project.id, treePath, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setTreeLoad({ key, state: { kind: "ready", value } }); },
      (error: unknown) => { if (!controller.signal.aborted) setTreeLoad({ key, state: { kind: "error", message: messageFor(error) } }); },
    );
    return () => controller.abort();
  }, [project, viewMode, treePath, fileRefresh]);

  useEffect(() => {
    if (project === null || submittedQuery === null) return;
    const controller = new AbortController();
    const key = `${project.id}\0${submittedQuery}`;
    setSearchLoad((current) => current?.key === key && current.state.kind === "ready" ? current : { key, state: { kind: "loading" } });
    fetchProjectSearch(project.id, submittedQuery, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setSearchLoad({ key, state: { kind: "ready", value } }); },
      (error: unknown) => { if (!controller.signal.aborted) setSearchLoad({ key, state: { kind: "error", message: messageFor(error) } }); },
    );
    return () => controller.abort();
  }, [project, submittedQuery, searchRefresh]);

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); setMenuOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [drawerOpen, menuOpen]);

  useEffect(() => {
    if (project !== null) saveOpenCards(project.id, expandedKeys);
  }, [project, expandedKeys]);

  function selectFolder(selectedPath: string): void {
    if (opening) return;
    if (root.kind !== "ready") {
      setNotice("The host folder root is not available yet.");
      return;
    }
    setNotice(null);
    if (routeProject !== selectedPath && openedProjectRef.current?.path === selectedPath) {
      openedProjectRef.current = null;
      setOpenedProject(null);
    }
    navigate({ section: "changes", projectPath: selectedPath, target: { kind: "all" } });
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
    if (project === null) return;
    navigate({ section: "changes", projectPath: project.path, target: { kind: "file", layer: entry.layer, path: entry.path } });
  }

  function toggleWrap(): void {
    setWrapCode((current) => {
      const next = !current;
      saveWrapPreference(next);
      return next;
    });
  }

  function refreshChanges(): void {
    if (project === null || refreshing) return;
    const cards = [...document.querySelectorAll<HTMLElement>("main .diff-card")];
    const topbarBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    const cardIndex = cards.findIndex((card) => card.getBoundingClientRect().bottom > topbarBottom + 8);
    const card = cardIndex < 0 ? null : cards[cardIndex] ?? null;
    reviewPosition.current = { projectId: project.id, cardId: card?.id ?? null, cardIndex: Math.max(0, cardIndex), top: card?.getBoundingClientRect().top ?? topbarBottom, scrollY: window.scrollY };
    setStatusRefresh((value) => value + 1);
  }

  function chooseView(mode: "changes" | "files" | "search" | "git"): void {
    if (project === null) return;
    if (mode === "changes") navigate({ section: "changes", projectPath: project.path, target: { kind: window.matchMedia("(max-width: 600px)").matches ? "list" : "all" } });
    else if (mode === "files") navigate({ section: "files", projectPath: project.path, directory: "", target: { kind: "list" } });
    else if (mode === "git") navigate({ section: "git", projectPath: project.path, ref: lastGitRefs.current.get(project.id) ?? null, target: { kind: "list" } });
    else navigate({ section: "search", projectPath: project.path, query: lastSubmittedQuery, target: { kind: "results" } });
  }

  function updateCodeTypography(next: CodeTypography): void {
    const validated = validateCodeTypography(next);
    if (validated === null) return;
    setCodeTypography(validated);
    saveCodeTypography(validated);
  }

  function updateAppearance(next: Appearance): void {
    const validated = validateAppearance(next);
    if (validated === null) return;
    setAppearance(validated);
    saveAppearance(validated);
  }

  function openSettings(): void {
    if (!settingsOpen) settingsBackRoute.current = route;
    navigate({ section: "settings", projectPath: project?.path ?? null });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function closeSettings(): void {
    const previous = settingsBackRoute.current;
    settingsBackRoute.current = null;
    if (previous !== null) {
      window.history.back();
      return;
    }
    navigate(project === null ? { section: "projects", directory: "" } : { section: "changes", projectPath: project.path, target: { kind: "all" } }, "replace");
  }

  function submitSearch(input: string): void {
    const query = input.trim();
    if (query.length === 0 || query.length > 128 || /[\0\r\n]/.test(query)) {
      if (searchKey !== null) setSearchLoad({ key: searchKey, state: { kind: "error", message: "Enter 1–128 characters on one line." } });
      return;
    }
    setSearchQuery(query);
    setLastSubmittedQuery(query);
    if (query === submittedQuery && route?.section === "search" && route.target.kind === "results") setSearchRefresh((value) => value + 1);
    else if (project !== null) navigate({ section: "search", projectPath: project.path, query, target: { kind: "results" } });
  }

  function searchSelectedCode(query: string): void {
    if (project === null) return;
    setSearchQuery(query);
    setLastSubmittedQuery(query);
    if (query === submittedQuery && route?.section === "search" && route.target.kind === "results") setSearchRefresh((value) => value + 1);
    navigate({ section: "search", projectPath: project.path, query, target: { kind: "results" } });
  }

  function openSearchMatch(match: SearchMatch, query: string): void {
    if (project === null) return;
    navigate({ section: "search", projectPath: project.path, query, target: { kind: "file", path: match.path, line: match.line } });
  }

  function updateComments(change: (current: CommentStore) => CommentStore): CommentStore | null {
    const current = commentsRef.current;
    if (current === null) return null;
    const next = change(current);
    if (next !== current) {
      commentsRef.current = next;
      setComments(next);
      saveCommentStore(next);
    }
    return next;
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
    setEditor((savedEditor) => {
      if (savedEditor === null || savedEditor.body.trim().length === 0) return null;
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
      return null;
    });
  }

  function deleteEditor(): void {
    if (editor?.draftId !== null && editor !== null) {
      const id = editor.draftId;
      updateComments((current) => ({ ...current, drafts: current.drafts.filter((draft) => draft.id !== id) }));
    }
    setEditor(null);
  }

  function openFeedback(): void {
    if (project === null) return;
    setFeedbackOpen(true);
    void feedback.check(project);
  }

  function undoLastCopy(): void {
    if (undoCopyId === null) return;
    const before = commentsRef.current;
    const restored = updateComments((current) => undoSuccessfulCopy(current, undoCopyId));
    if (restored === before) {
      if (before?.history[0]?.id === undoCopyId) setUndoError(`Undo would exceed the ${maxDrafts} comment limit. Remove a draft and try again.`);
      return;
    }
    setUndoCopyId(null);
    setUndoError(null);
    setNotice("Copied comments restored to your draft.");
  }

  function showList(): void {
    if (route === null || route.section === "projects" || route.section === "settings") return;
    if (window.matchMedia("(min-width: 601px) and (max-width: 899px)").matches) {
      setDrawerOpen(true);
      return;
    }
    if (route.section === "changes") navigate({ section: "changes", projectPath: route.projectPath, target: { kind: "list" } });
    else if (route.section === "files") navigate({ section: "files", projectPath: route.projectPath, directory: route.directory, target: { kind: "list" } });
    else if (route.section === "git") navigate({ ...route, target: { kind: "list" } });
    else navigate({ section: "search", projectPath: route.projectPath, query: route.query, target: { kind: "results" } });
  }

  const rootLabel = root.kind === "ready" ? root.value.label : "Host folders";
  const folderLabel = listing.kind === "ready" ? shortName(listing.value.path) : shortName(path);
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;
  const listSection = route?.section === "settings" ? project === null ? "projects" : "changes" : route?.section ?? "projects";
  const mobilePane = route?.section === "projects" || route?.section === "changes" && route.target.kind === "list" || route?.section === "files" && route.target.kind === "list" || route?.section === "search" && route.target.kind === "results" || route?.section === "git" && route.target.kind === "list" ? "list" : "content";

  return (
    <div class="app" data-code-font={codeTypography.fontFamily} style={`--code-font-size: ${codeTypography.fontSize}px`}>
      <header class="topbar">
        <div class="brand" aria-label="git-review">
          <span class="brand-mark" aria-hidden="true">{`{ }`}</span>
          <span>git<span class="brand-accent">review</span></span>
        </div>
        <button class="project-switch" type="button" aria-label="Open workspace menu" aria-expanded={menuOpen} onClick={() => {
          if (window.matchMedia("(min-width: 1200px)").matches) navigate({ section: "projects", directory: "" });
          else setMenuOpen((open) => !open);
        }}>
          <span class="switch-icon" aria-hidden="true">▦</span>
          <span class="switch-label">{project?.name ?? (routeProject === null ? "Choose folder" : shortName(routeProject))}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </header>

      <div class="workspace" data-section={routeState.kind === "invalid" ? "invalid" : route?.section ?? "projects"} data-mobile-pane={mobilePane}>
        {menuOpen && <button class="menu-scrim" type="button" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />}
        <aside class={`workspace-menu${menuOpen ? " workspace-menu-open" : ""}`} aria-label="Workspace menu">
          <div class="workspace-menu-head"><button class="icon-button close-menu" type="button" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)}>×</button></div>
          <button class="menu-project" type="button" onClick={() => navigate({ section: "projects", directory: "" })}>Choose a project <span aria-hidden="true">→</span></button>
          {saved.recentPaths.length > 0 && <div class="menu-recents"><span class="section-label">RECENT PROJECTS</span>{saved.recentPaths.map((recentPath) => <button type="button" key={recentPath} onClick={() => selectFolder(recentPath)}><strong>{shortName(recentPath)}</strong><small>{recentPath === "" ? "/" : `/${recentPath}`}</small></button>)}</div>}
          <button class="sidebar-settings" type="button" aria-current={settingsOpen ? "page" : undefined} onClick={openSettings}>Settings <span aria-hidden="true">⚙</span></button>
        </aside>
        {drawerOpen && <button class="drawer-scrim" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)} />}
        <aside class={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label={listSection === "changes" ? "Changed files" : listSection === "files" ? "Project files" : listSection === "search" ? "Search results" : listSection === "git" ? "Git history" : "Folder picker"}>
          <div class="sidebar-head">
            {listSection === "projects" ? <h2>Folders</h2> : project === null ? <h2>{routeProject === null ? "Folders" : shortName(routeProject)}</h2> : <div class="sidebar-project-identity">
              <h2 class="sidebar-project-title">{project.name}</h2>
              <p class="sidebar-project-path" title={project.absolutePath}>{project.absolutePath}</p>
            </div>}
            <button class="icon-button close-drawer" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)}>×</button>
          </div>
          {listSection !== "projects" && project !== null && <nav class="project-view-tabs sidebar-project-tabs" aria-label="Project views">
            <button type="button" aria-current={viewMode === "changes" ? "page" : undefined} disabled={status.kind === "ready" && status.value.kind === "not_git"} onClick={() => chooseView("changes")}>Changes</button>
            <button type="button" aria-current={viewMode === "files" ? "page" : undefined} onClick={() => chooseView("files")}>Files</button>
            <button type="button" aria-current={viewMode === "search" ? "page" : undefined} onClick={() => chooseView("search")}>Search</button>
            <button type="button" aria-current={viewMode === "git" ? "page" : undefined} disabled={status.kind === "ready" && status.value.kind === "not_git"} onClick={() => chooseView("git")}>Git</button>
          </nav>}

          {listSection === "git" && project !== null && gitRoute !== null ? <GitSidebar browser={git} route={gitRoute} onBranch={(ref) => navigate({ ...gitRoute, ref, target: { kind: "list" } })} onCommit={(oid) => navigate({ ...gitRoute, target: { kind: "commit", oid } })} /> : listSection === "search" && project !== null ? <SearchView query={searchQuery} state={searchState} onQuery={setSearchQuery} onSubmit={submitSearch} onRefresh={() => setSearchRefresh((value) => value + 1)} canRefresh={submittedQuery !== null} onOpen={openSearchMatch} /> : listSection === "files" && project !== null ? <div class="sidebar-files">
            {treePath !== "" && <div class="file-tree-breadcrumb"><button class="back-button" type="button" aria-label="Go to parent directory" onClick={() => navigate({ section: "files", projectPath: project.path, directory: parentDirectory(treePath), target: { kind: "list" } })}><Icon name="back" /></button><span title={treePath}>/{treePath}</span></div>}
            {tree.kind === "loading" && <DelayedLoading key={treeKey ?? "files"} className="sidebar-message" message="Loading files…" />}
            {tree.kind === "error" && <div class="sidebar-error" role="alert">{tree.message} <button type="button" onClick={() => setFileRefresh((value) => value + 1)}>Retry</button></div>}
            {tree.kind === "ready" && tree.value.entries.length === 0 && <p class="sidebar-message">This directory is empty.</p>}
            {tree.kind === "ready" && <div class="file-tree-list">{tree.value.entries.map((entry) => <button class={`file-tree-row${selectedFile === entry.path ? " file-tree-row-selected" : ""}`} type="button" key={entry.path} onClick={() => {
              if (entry.kind === "directory") navigate({ section: "files", projectPath: project.path, directory: entry.path, target: { kind: "list" } });
              else navigate({ section: "files", projectPath: project.path, directory: treePath, target: { kind: "file", path: entry.path, line: null } });
            }} title={entry.path}>
              <span class="file-tree-icon"><Icon name={entry.kind === "directory" ? "folder" : entry.kind === "symlink" ? "link" : entry.kind === "other" ? "other" : "file"} /></span>
              <span>{entry.name}</span>{entry.kind === "directory" && <span class="row-arrow" aria-hidden="true">›</span>}
            </button>)}</div>}
          </div> : listSection === "changes" && project !== null ? <div class="sidebar-changes">
            {status.kind === "loading" && <DelayedLoading className="sidebar-message" message="Reading Git changes…" />}
            {status.kind === "error" && <p class="sidebar-error" role="alert">{status.message}</p>}
            {status.kind === "ready" && status.value.kind === "not_git" && <p class="sidebar-message">This folder is not a Git worktree.</p>}
            {gitStatus !== null && <ChangeGroups entries={gitStatus.entries} onSelect={selectEntry} />}
          </div> : listSection !== "projects" && project === null ? <DelayedLoading key={routeProject ?? "project"} className="sidebar-message" message="Opening project…" /> : <>

          <div class="root-card">
            <span class="root-dot" aria-hidden="true" />
            <div class="root-copy">
              <strong>{rootLabel}</strong>
              {root.kind === "ready" ? <span>{root.value.path}</span> : root.kind === "error" ? <span>{root.message}</span> : <DelayedLoading className="root-loading" message="Connecting to the local server…" />}
            </div>
          </div>

          <div class="folder-location">
            <span class="section-label">CURRENT FOLDER</span>
            <div class="folder-name-row">
              {listing.kind === "ready" && listing.value.parentPath !== null && (
                <button class="back-button" type="button" aria-label="Go to parent folder" onClick={() => navigate({ section: "projects", directory: listing.value.parentPath ?? "" })}><Icon name="back" /></button>
              )}
              <strong title={path}>{folderLabel}</strong>
            </div>
            <span class="folder-path">{path === "" ? "/" : `/${path}`}</span>
            <button class="open-button" type="button" disabled={root.kind !== "ready" || listing.kind !== "ready" || opening} onClick={() => selectFolder(path)}>
              {opening ? "Opening…" : "Open this folder"} <span aria-hidden="true">↗</span>
            </button>
          </div>

          <div class="folder-list-section">
            <div class="section-heading"><span class="section-label">SUBFOLDERS</span><span>{listing.kind === "ready" ? listing.value.entries.length : ""}</span></div>
            {listing.kind === "loading" && <DelayedLoading key={path} className="sidebar-message" message="Loading folders…" />}
            {listing.kind === "error" && (
              <div class="sidebar-error" role="alert">
                <p>{listing.message}</p>
                <button type="button" onClick={() => navigate({ section: "projects", directory: "" })}>Back to root</button>
              </div>
            )}
            {listing.kind === "ready" && listing.value.entries.length === 0 && <p class="sidebar-message">No subfolders here.</p>}
            {listing.kind === "ready" && listing.value.entries.map((entry) => (
              <button class="folder-row" type="button" key={entry.path} onClick={() => navigate({ section: "projects", directory: entry.path })}>
                <span class="folder-glyph"><Icon name="folder" /></span>
                <span class="folder-row-name">{entry.name}</span>
                <span class="row-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>

          {saved.recentPaths.length > 0 && (
            <div class="recent-section">
              <span class="section-label">RECENT FOLDERS</span>
              {saved.recentPaths.map((recentPath) => (
                <button class="recent-row" type="button" key={recentPath} onClick={() => selectFolder(recentPath)}>
                  <span aria-hidden="true">↺</span>
                  <span><strong>{shortName(recentPath)}</strong><small>{recentPath === "" ? "/" : `/${recentPath}`}</small></span>
                </button>
              ))}
            </div>
          )}
          {project !== null && <button class="sidebar-switch-mode" type="button" onClick={() => chooseView(viewMode ?? "changes")}>Back to project <span aria-hidden="true">→</span></button>}
          </>}
        </aside>

        <main class="main-content">
          {notice !== null && <div class="notice" role="alert">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
          {root.kind === "error" && <div class="notice" role="alert">{root.message}</div>}

          <div hidden={settingsOpen}>
          {routeState.kind === "invalid" ? <div class="welcome"><h1>That link cannot be opened.</h1><p class="welcome-copy">{routeState.message}</p><button class="primary-action" type="button" onClick={() => navigate({ section: "projects", directory: "" }, "replace")}>Choose a project <span aria-hidden="true">→</span></button></div> : route === null ? null : route.section === "projects" ? (
            <div class="welcome">
              <div class="hero-orb" aria-hidden="true"><span>⌁</span></div>
              <p class="eyebrow">A CLEARER WAY TO REVIEW</p>
              <h1>Start with a folder.</h1>
              <p class="welcome-copy">Choose a project on this computer to make it your review workspace.</p>
              <button class="primary-action" type="button" onClick={() => navigate({ section: "projects", directory: "" })}>Browse host folders <span aria-hidden="true">→</span></button>
              <div class="welcome-foot"><span class="line-decor" aria-hidden="true" /> Staged, unstaged, and untracked changes will live here.</div>
            </div>
          ) : project === null ? projectOpenError?.path === routeProject ? <div class="status-message" role="alert">This project could not be opened: {projectOpenError.message} <button type="button" onClick={() => navigate({ section: "projects", directory: "" }, "replace")}>Choose another project</button>.</div> : <DelayedLoading key={routeProject ?? "project"} className="status-message" message="Opening project…" /> : (
            <div class="project-view project-view-changes">
              {viewMode === "git" && gitRoute !== null ? <>
                <div class="changes-heading"><div class="content-heading-title"><button class="content-back" type="button" aria-label="Back to list" onClick={showList}><Icon name="back" /></button><h2>{gitRoute.target.kind === "commit" ? "Commit" : "Git history"}</h2></div><div class="changes-actions"><button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button><button type="button" disabled={git.refreshing} onClick={git.refreshHistory}>Refresh</button></div></div>
                {gitRoute.target.kind === "list" ? <p class="status-message">{git.refs.kind === "ready" && git.refs.value.kind === "not_git" ? "This folder is not a Git worktree." : git.unborn ? "This branch has no commits yet." : "Select a commit from the Git list to inspect its message and changes."}</p> : git.detail.kind === "loading" ? <DelayedLoading key={gitRoute.target.oid} className="status-message" message="Reading commit…" /> : git.detail.kind === "error" ? <div class="status-message" role="alert">{git.detail.message} <button type="button" onClick={git.retryCommit}>Retry</button></div> : <CommitViewer key={`${project.id}:${git.detail.value.oid}`} project={project} detail={git.detail.value} wrap={wrapCode} languages={languages} />}
              </> : viewMode === "search" ? <>
                <div class="changes-heading"><div class="content-heading-title"><button class="content-back" type="button" aria-label="Back to list" onClick={showList}><Icon name="back" /></button><h2>{selectedFile === null ? "Search files" : "Search result"}</h2></div></div>
                {selectedFile === null ? <p class="status-message">Search this project from the results list. Select a match to read its file here.</p> : <><div class="file-location-bar"><span>{selectedFile}</span></div><FileViewer key={`${project.id}:${selectedFile}`} projectId={project.id} path={selectedFile} wrap={wrapCode} languages={languages} refreshKey={fileRefresh} searchTarget={searchTarget} /></>}
              </> : viewMode === "files" ? <>
                <div class="changes-heading">
                  <div class="content-heading-title"><button class="content-back" type="button" aria-label="Back to list" onClick={showList}><Icon name="back" /></button><h2>Browse files</h2></div>
                  <div class="changes-actions">
                    <button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button>
                    <button type="button" onClick={() => setFileRefresh((value) => value + 1)}>Refresh</button>
                  </div>
                </div>
                <div class="file-location-bar"><span>{selectedFile ?? (treePath === "" ? "Choose a file to read" : `/${treePath}`)}</span></div>
                {selectedFile === null ? <p class="status-message">Open a folder or file from the Files list. Changes and feedback remain available when you return to review.</p> : <FileViewer key={`${project.id}:${selectedFile}`} projectId={project.id} path={selectedFile} wrap={wrapCode} languages={languages} refreshKey={fileRefresh} searchTarget={searchTarget?.path === selectedFile ? searchTarget : null} />}
              </> : <>
              <div class="changes-heading">
                <div class="content-heading-title"><button class="content-back" type="button" aria-label="Back to list" onClick={showList}><Icon name="back" /></button><h2>Changed files</h2></div>
                <div class="changes-actions">
                  <button type="button" aria-pressed={wrapCode} onClick={toggleWrap}>{wrapCode ? "Wrap: on" : "Wrap: off"}</button>
                  <span class="visually-hidden" role="status">{pendingUpdate && !refreshing ? "New edits are available. Use Update to load them." : ""}</span>
                  {pendingUpdate && <button class="changes-update" type="button" disabled={refreshing} onClick={refreshChanges}>{refreshing ? "Updating…" : "New edits · Update"}</button>}
                  <button type="button" disabled={refreshing} onClick={refreshChanges}>{refreshing ? "Refreshing…" : "Refresh"}</button>
                </div>
              </div>
              {changeCheckError && <p class="changes-check-error" role="status">Could not check for new edits. Refresh is still available.</p>}
              {status.kind === "loading" && <DelayedLoading className="status-message" message="Reading Git changes…" />}
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
                        changeToken={gitStatus.changeToken}
                        refreshKey={statusRefresh}
                        expanded={expandedKeys.has(diffCardKey(entry))}
                        wrap={wrapCode}
                        languages={languages}
                        onToggle={() => toggleEntry(entry)}
                        onStale={refreshChanges}
                        onComment={chooseCommentLine}
                        reattachSide={reattachId === null ? null : comments?.drafts.find((draft) => draft.id === reattachId)?.anchor.side ?? null}
                        drafts={comments?.projectId === project.id ? comments.drafts.filter((draft) => draft.anchor.layer === entry.layer && draft.anchor.path === entry.path) : []}
                      />)}
                    </section>;
                  })}
                </div>
              </>}
              </>}
            </div>
          )}
          </div>
          {settingsOpen && <SettingsView typography={codeTypography} onTypography={updateCodeTypography} appearance={appearance} onAppearance={updateAppearance} onBack={closeSettings} onInstallData={() => setInstallDataOpen(true)} />}
        </main>
      </div>
      {!settingsOpen && project !== null && (viewMode === "changes" || viewMode === "files" || viewMode === "search" && selectedFile !== null) && <CodeSelectionSearch key={project.id} onSearch={searchSelectedCode} wrap={wrapCode} />}
      {!settingsOpen && project !== null && viewMode !== null && <button class="feedback-launch" type="button" onClick={openFeedback}>Feedback <span>{comments?.projectId === project.id ? comments.drafts.length : 0}</span></button>}
      {reattachId !== null && <div class="reattach-banner" role="status">Tap a new line number to reattach this comment. <button type="button" onClick={() => setReattachId(null)}>Cancel</button></div>}
      {editor !== null && <CommentEditor editor={editor} onBody={(body) => setEditor((current) => current === null ? current : { ...current, body })} onClose={closeEditor} onDelete={deleteEditor} />}
      {feedbackOpen && project !== null && comments?.projectId === project.id && <FeedbackDialog store={comments} projectPath={project.absolutePath} state={feedbackState} undoError={undoError} onClose={() => setFeedbackOpen(false)} onCheck={() => void feedback.check(project)} onCopy={() => void feedback.copy(project)} onEdit={(draft) => { feedback.cancel(); setFeedbackOpen(false); setEditor({ anchor: draft.anchor, draftId: draft.id, body: draft.body }); }} onReattach={(draft) => { setFeedbackOpen(false); setReattachId(draft.id); selectEntry({ layer: draft.anchor.layer, path: draft.anchor.path, kind: "modified", oldPath: null, isSubmodule: false }); }} onUndo={undoLastCopy} canUndo={undoCopyId !== null && comments.history[0]?.id === undoCopyId} onCopyHistory={(text) => void feedback.copyHistory(project, text)} />}
      {installDataOpen && <InstallDataDialog rootPath={root.kind === "ready" ? root.value.path : null} installPrompt={installPrompt} onInstallHandled={() => setInstallPrompt(null)} onClose={() => setInstallDataOpen(false)} />}
    </div>
  );
}
