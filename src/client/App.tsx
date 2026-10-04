import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { fetchDirectory, fetchLanguages, fetchProjectSearch, fetchProjectTree } from "./api.ts";
import { diffCardId } from "./DiffCard.tsx";
import { ChangesSidebar, ChangesView } from "./ChangesView.tsx";
import { FilesSidebar } from "./FilesSidebar.tsx";
import { ProjectPicker, ProjectWelcome } from "./ProjectPicker.tsx";
import { folderName } from "./folder-name.ts";
import type { LoadState } from "./load-state.ts";
import { FileViewer } from "./FileViewer.tsx";
import { CommitViewer } from "./CommitViewer.tsx";
import { GitSidebar } from "./GitSidebar.tsx";
import { useGitBrowser } from "./git-browser.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { Icon } from "./Icons.tsx";
import { CodeSelectionSearch } from "./CodeSelectionSearch.tsx";
import { SearchView, type SearchState } from "./SearchView.tsx";
import { useProjectSession } from "./project-session.ts";
import { useReviewFeedback } from "./review-feedback.ts";
import { useWorkingCopyReview } from "./working-copy-review.ts";
import { CommentEditor, FeedbackDialog } from "./ReviewDialogs.tsx";
import { InstallDataDialog, isInstallPromptEvent, type InstallPromptEvent } from "./InstallDataDialog.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { useAppearancePreferences } from "./appearance-preferences.ts";
import { parentDirectory, parseNavigationSearch, routeProjectPath, routeSection, routeUrl, type Route, type RouteState } from "./navigation.ts";
import { readWrapPreference, saveWrapPreference } from "./storage.ts";
import type { ChangeEntry, DirectoryListing, FileTree, LanguageOption, SearchMatch } from "../shared/api.ts";

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function App() {
  const [listingLoad, setListingLoad] = useState<{ key: string; state: LoadState<DirectoryListing> }>({ key: "", state: { kind: "loading" } });
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
  const viewMode = route === null ? null : routeSection(route);
  const gitRoute = route?.section === "git" ? route : null;
  const path = route?.section === "projects" ? route.directory : "";
  const listing = listingLoad.key === path ? listingLoad.state : { kind: "loading" } as const;
  const treePath = route?.section === "files" ? route.directory : route?.section === "search" && route.target.kind === "file" ? parentDirectory(route.target.path) : "";
  const selectedFile = route?.section === "files" && route.target.kind === "file" || route?.section === "search" && route.target.kind === "file" ? route.target.path : null;
  const submittedQuery = route?.section === "search" ? route.query : null;
  const searchTarget = route?.section === "search" && route.target.kind === "file" && route.query !== null ? { path: route.target.path, line: route.target.line, query: route.query } : route?.section === "files" && route.target.kind === "file" && route.target.line !== null ? { path: route.target.path, line: route.target.line, query: null } : null;
  const [wrapCode, setWrapCode] = useState(readWrapPreference);
  const preferences = useAppearancePreferences();
  const settingsOpen = route?.section === "settings";
  const settingsBackRoute = useRef<Route | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [installDataOpen, setInstallDataOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const session = useProjectSession({
    projectPath: routeProject,
    readCurrentProjectPath: () => routeRef.current === null ? null : routeProjectPath(routeRef.current),
    onRestoreProject: (path) => navigate(path === null ? { section: "projects", directory: "" } : { section: "changes", projectPath: path, target: { kind: "all" } }, "replace"),
    onSelectProject: (path) => navigate({ section: "changes", projectPath: path, target: { kind: "all" } }),
    onNotice: setNotice,
    onOpening: () => {
      review.actions.beginProjectOpen();
      feedback.actions.beginProjectOpen();
    },
    onOpened: (project) => {
      feedback.actions.loadProject(project);
      review.actions.loadProject(project);
    },
  });
  const { root, project, opening, openError: projectOpenError, recentPaths } = session.model;
  const treeKey = project === null ? null : `${project.id}\0${treePath}`;
  const tree = treeKey !== null && treeLoad?.key === treeKey ? treeLoad.state : { kind: "loading" } as const;
  const searchKey = project === null ? null : `${project.id}\0${submittedQuery ?? ""}`;
  const searchState = searchKey === null ? { kind: "idle" } as const : searchLoad?.key === searchKey ? searchLoad.state : submittedQuery === null ? { kind: "idle" } as const : { kind: "loading" } as const;
  const git = useGitBrowser(project, gitRoute);
  const lastGitRefs = useRef(new Map<string, string>());
  const feedback = useReviewFeedback({
    project,
    onNotice: setNotice,
    onRevealAnchor: (anchor) => {
      if (project !== null) navigate({ section: "changes", projectPath: project.path, target: { kind: "file", layer: anchor.layer, path: anchor.path } });
    },
  });
  const { editor, preview, reattachment, drafts } = feedback.model;
  const review = useWorkingCopyReview({
    project,
    route,
    readCurrentRoute: () => routeRef.current,
    pollingAllowed: viewMode === "changes" && editor === null && preview === null && !installDataOpen,
    onNotice: setNotice,
    onNonGit: (project) => {
      const current = routeRef.current;
      if (current?.section === "changes" && current.projectPath === project.path) navigate({ section: "files", projectPath: project.path, directory: "", target: { kind: "list" } }, "replace");
    },
  });
  const { status } = review.model;

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
    feedback.actions.prepareNavigation();
    const previous = routeRef.current;
    if (previous !== null) scrollPositions.current.set(routeUrl(previous), window.scrollY);
    routeRef.current = next;
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
      feedback.actions.prepareNavigation();
      const previous = routeRef.current;
      if (previous !== null) scrollPositions.current.set(routeUrl(previous), window.scrollY);
      const parsed = parseNavigationSearch(window.location.search);
      if (parsed.kind === "empty" && root.kind === "ready") {
        session.actions.restoreDefaultRoute();
      } else {
        routeRef.current = parsed.kind === "ready" ? parsed.route : null;
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
    if (route?.section !== "changes" || route.target.kind !== "file" || focusedChangesRoute.current === route || project?.path !== route.projectPath || status.kind !== "ready" || status.value.kind !== "git") return;
    const target = route.target;
    const entry = status.value.entries.find((candidate) => candidate.layer === target.layer && candidate.path === target.path);
    if (entry === undefined) {
      setNotice("This changed file is no longer in the current Git inventory. Refresh or choose another file.");
      return;
    }
    review.actions.expandEntry(entry);
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

  function chooseView(mode: "changes" | "files" | "search" | "git"): void {
    if (project === null) return;
    if (mode === "changes") navigate({ section: "changes", projectPath: project.path, target: { kind: window.matchMedia("(max-width: 600px)").matches ? "list" : "all" } });
    else if (mode === "files") navigate({ section: "files", projectPath: project.path, directory: "", target: { kind: "list" } });
    else if (mode === "git") navigate({ section: "git", projectPath: project.path, ref: lastGitRefs.current.get(project.id) ?? null, target: { kind: "list" } });
    else navigate({ section: "search", projectPath: project.path, query: lastSubmittedQuery, target: { kind: "results" } });
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

  const listSection = route?.section === "settings" ? project === null ? "projects" : "changes" : route?.section ?? "projects";
  const mobilePane = route?.section === "projects" || route?.section === "changes" && route.target.kind === "list" || route?.section === "files" && route.target.kind === "list" || route?.section === "search" && route.target.kind === "results" || route?.section === "git" && route.target.kind === "list" ? "list" : "content";

  return (
    <div class="app" data-code-font={preferences.typography.fontFamily} style={`--code-font-size: ${preferences.typography.fontSize}px`}>
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
          <span class="switch-label">{project?.name ?? (routeProject === null ? "Choose folder" : folderName(routeProject))}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </header>

      <div class="workspace" data-section={routeState.kind === "invalid" ? "invalid" : route?.section ?? "projects"} data-mobile-pane={mobilePane}>
        {menuOpen && <button class="menu-scrim" type="button" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />}
        <aside class={`workspace-menu${menuOpen ? " workspace-menu-open" : ""}`} aria-label="Workspace menu">
          <div class="workspace-menu-head"><button class="icon-button close-menu" type="button" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)}>×</button></div>
          <button class="menu-project" type="button" onClick={() => navigate({ section: "projects", directory: "" })}>Choose a project <span aria-hidden="true">→</span></button>
          {recentPaths.length > 0 && <div class="menu-recents"><span class="section-label">RECENT PROJECTS</span>{recentPaths.map((recentPath) => <button type="button" key={recentPath} onClick={() => session.actions.selectFolder(recentPath)}><strong>{folderName(recentPath)}</strong><small>{recentPath === "" ? "/" : `/${recentPath}`}</small></button>)}</div>}
          <button class="sidebar-settings" type="button" aria-current={settingsOpen ? "page" : undefined} onClick={openSettings}>Settings <span aria-hidden="true">⚙</span></button>
        </aside>
        {drawerOpen && <button class="drawer-scrim" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)} />}
        <aside class={`sidebar${drawerOpen ? " sidebar-open" : ""}`} aria-label={listSection === "changes" ? "Changed files" : listSection === "files" ? "Project files" : listSection === "search" ? "Search results" : listSection === "git" ? "Git history" : "Folder picker"}>
          <div class="sidebar-head">
            {listSection === "projects" ? <h2>Folders</h2> : project === null ? <h2>{routeProject === null ? "Folders" : folderName(routeProject)}</h2> : <div class="sidebar-project-identity">
              <h2 class="sidebar-project-title">{project.name}</h2>
              <p class="sidebar-project-path" title={project.absolutePath}>{project.absolutePath}</p>
            </div>}
            <button class="icon-button close-drawer" type="button" aria-label="Close sidebar" onClick={() => setDrawerOpen(false)}>×</button>
          </div>
          {listSection !== "projects" && project !== null && <nav class="sidebar-project-tabs" aria-label="Project views">
            <button type="button" aria-current={viewMode === "changes" ? "page" : undefined} disabled={status.kind === "ready" && status.value.kind === "not_git"} onClick={() => chooseView("changes")}>Changes</button>
            <button type="button" aria-current={viewMode === "files" ? "page" : undefined} onClick={() => chooseView("files")}>Files</button>
            <button type="button" aria-current={viewMode === "search" ? "page" : undefined} onClick={() => chooseView("search")}>Search</button>
            <button type="button" aria-current={viewMode === "git" ? "page" : undefined} disabled={status.kind === "ready" && status.value.kind === "not_git"} onClick={() => chooseView("git")}>Git</button>
          </nav>}

          {listSection === "git" && project !== null && gitRoute !== null ? <GitSidebar model={git} commands={git} route={gitRoute} onBranch={(ref) => navigate({ ...gitRoute, ref, target: { kind: "list" } })} onCommit={(oid) => navigate({ ...gitRoute, target: { kind: "commit", oid } })} /> : listSection === "search" && project !== null ? <SearchView query={searchQuery} state={searchState} onQuery={setSearchQuery} onSubmit={submitSearch} onRefresh={() => setSearchRefresh((value) => value + 1)} canRefresh={submittedQuery !== null} onOpen={openSearchMatch} /> : listSection === "files" && project !== null ? <FilesSidebar directory={treePath} selectedPath={selectedFile} state={tree} loadingKey={treeKey ?? "files"} onParent={() => navigate({ section: "files", projectPath: project.path, directory: parentDirectory(treePath), target: { kind: "list" } })} onSelect={(entry) => {
            if (entry.kind === "directory") navigate({ section: "files", projectPath: project.path, directory: entry.path, target: { kind: "list" } });
            else navigate({ section: "files", projectPath: project.path, directory: treePath, target: { kind: "file", path: entry.path, line: null } });
          }} onRetry={() => setFileRefresh((value) => value + 1)} /> : listSection === "changes" && project !== null ? <ChangesSidebar status={status} onSelect={selectEntry} /> : listSection !== "projects" && project === null ? <DelayedLoading key={routeProject ?? "project"} className="sidebar-message" message="Opening project…" /> :
          <ProjectPicker root={root} listing={listing} path={path} opening={opening} recentPaths={recentPaths} onBrowseDirectory={(directory) => navigate({ section: "projects", directory })} onSelectFolder={session.actions.selectFolder} />}
        </aside>

        <main class="main-content">
          {notice !== null && <div class="notice" role="alert">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
          {root.kind === "error" && <div class="notice" role="alert">{root.message}</div>}

          <div hidden={settingsOpen}>
          {routeState.kind === "invalid" ? <div class="welcome"><h1>That link cannot be opened.</h1><p class="welcome-copy">{routeState.message}</p><button class="primary-action" type="button" onClick={() => navigate({ section: "projects", directory: "" }, "replace")}>Choose a project <span aria-hidden="true">→</span></button></div> : route === null ? null : route.section === "projects" ? (
            <ProjectWelcome onBrowseFolders={() => navigate({ section: "projects", directory: "" })} />
          ) : project === null ? projectOpenError?.path === routeProject ? <div class="status-message" role="alert">This project could not be opened: {projectOpenError.message} <button type="button" onClick={() => navigate({ section: "projects", directory: "" }, "replace")}>Choose another project</button>.</div> : <DelayedLoading key={routeProject ?? "project"} className="status-message" message="Opening project…" /> : (
            <div class="project-view">
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
              </> : <ChangesView
                model={{ projectId: project.id, ...review.model, wrap: wrapCode, languages, drafts, reattachSide: reattachment?.side ?? null }}
                commands={{ back: showList, toggleWrap, refresh: review.actions.refresh, toggleEntry: review.actions.toggleEntry, comment: feedback.actions.chooseLine }}
              />}
            </div>
          )}
          </div>
          {settingsOpen && <SettingsView typography={preferences.typography} onTypography={preferences.changeTypography} onResetTypography={preferences.resetTypography} appearance={preferences.appearance} onAppearance={preferences.changeAppearance} onResetAppearance={preferences.resetAppearance} onBack={closeSettings} onInstallData={() => setInstallDataOpen(true)} />}
        </main>
      </div>
      {!settingsOpen && project !== null && (viewMode === "changes" || viewMode === "files" || viewMode === "search" && selectedFile !== null) && <CodeSelectionSearch key={project.id} onSearch={searchSelectedCode} wrap={wrapCode} />}
      {!settingsOpen && project !== null && viewMode !== null && <button class="feedback-launch" type="button" onClick={feedback.actions.openPreview}>Feedback <span>{drafts.length}</span></button>}
      {reattachment !== null && <div class="reattach-banner" role="status">Tap a new line number to reattach this comment. <button type="button" onClick={feedback.actions.cancelReattachment}>Cancel</button></div>}
      {editor !== null && <CommentEditor editor={editor} onBody={feedback.actions.changeBody} onClose={feedback.actions.closeEditor} onDelete={feedback.actions.deleteEditor} />}
      {preview !== null && <FeedbackDialog store={preview.store} projectPath={preview.projectPath} state={preview.state} undoError={preview.undoError} onClose={feedback.actions.closePreview} onCheck={feedback.actions.check} onCopy={feedback.actions.copy} onEdit={feedback.actions.editDraft} onReattach={feedback.actions.reattachDraft} onUndo={feedback.actions.undo} canUndo={preview.canUndo} onCopyHistory={feedback.actions.copyHistory} />}
      {installDataOpen && <InstallDataDialog rootPath={root.kind === "ready" ? root.value.path : null} installPrompt={installPrompt} onInstallHandled={() => setInstallPrompt(null)} onClose={() => setInstallDataOpen(false)} />}
    </div>
  );
}
