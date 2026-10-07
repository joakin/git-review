import { useEffect, useRef, useState } from "preact/hooks";
import type { ChangeEntry, Project, ProjectStatus } from "../shared/api.ts";
import { fetchProjectChangeCheck, fetchProjectStatus } from "./api.ts";
import { diffCardKey } from "./DiffCard.tsx";
import { routeProjectPath, type Route } from "./navigation.ts";
import { readOpenCards, saveOpenCards } from "./storage.ts";
import type { LoadState } from "./load-state.ts";

type ReviewState = {
  project: Project | null;
  status: LoadState<ProjectStatus>;
  refreshing: boolean;
  pendingUpdate: boolean;
  checkError: boolean;
  refreshKey: number;
  expandedKeys: ReadonlySet<string>;
};
type ReviewPosition = {
  project: Project;
  route: Extract<Route, { section: "changes" }>;
  refreshKey: number;
  cardId: string | null;
  cardIndex: number;
  top: number;
  scrollY: number;
};
type ReviewInputs = {
  project: Project | null;
  route: Route | null;
  readCurrentRoute: () => Route | null;
  pollingAllowed: boolean;
  onNotice: (message: string) => void;
  onNonGit: (project: Project) => void;
};
type WorkingCopyReview = {
  model: {
    status: LoadState<ProjectStatus>;
    refreshing: boolean;
    pendingUpdate: boolean;
    checkError: boolean;
    refreshKey: number;
    expandedKeys: ReadonlySet<string>;
  };
  actions: {
    beginProjectOpen: () => void;
    loadProject: (project: Project) => void;
    refresh: () => void;
    notifyStale: (revision: string, changeToken: string, refreshKey: number) => void;
    toggleEntry: (entry: ChangeEntry) => void;
    expandEntry: (entry: ChangeEntry) => void;
    expandAll: () => void;
    collapseAll: () => void;
  };
};

const loading: LoadState<ProjectStatus> = { kind: "loading" };
const emptyCards: ReadonlySet<string> = new Set();
const pollIntervalMs = 10_000;

/** Owns the accepted review snapshot; background checks only announce changes. */
export function useWorkingCopyReview(inputs: ReviewInputs): WorkingCopyReview {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const [state, setState] = useState<ReviewState>(() => ({
    project: null,
    status: loading,
    refreshing: false,
    pendingUpdate: false,
    checkError: false,
    refreshKey: 0,
    expandedKeys: emptyCards,
  }));
  const stateRef = useRef(state);
  const statusRequest = useRef<AbortController | null>(null);
  const reviewPosition = useRef<ReviewPosition | null>(null);

  function update(change: (current: ReviewState) => ReviewState): void {
    const next = change(stateRef.current);
    stateRef.current = next;
    setState(next);
  }

  function beginProjectOpen(): void {
    statusRequest.current?.abort();
    reviewPosition.current = null;
    update((current) => ({
      ...current,
      project: null,
      status: loading,
      refreshing: false,
      pendingUpdate: false,
      checkError: false,
      expandedKeys: emptyCards,
    }));
  }

  function loadProject(project: Project): void {
    update((current) => ({
      ...current,
      project,
      status: loading,
      refreshing: false,
      pendingUpdate: false,
      checkError: false,
      expandedKeys: readOpenCards(project.absolutePath),
    }));
  }

  function hasCurrentProject(project: Project): boolean {
    const route = inputsRef.current.readCurrentRoute();
    return (
      stateRef.current.project === project &&
      inputsRef.current.project === project &&
      route !== null &&
      routeProjectPath(route) === project.relativePath
    );
  }

  function changeExpansion(entry: ChangeEntry, toggle: boolean): void {
    const project = inputsRef.current.project;
    if (project === null || !hasCurrentProject(project)) return;
    const key = diffCardKey(entry);
    update((current) => {
      if (!toggle && current.expandedKeys.has(key)) return current;
      const next = new Set(current.expandedKeys);
      if (toggle && next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, expandedKeys: next };
    });
  }

  function changeAllExpansion(expanded: boolean): void {
    const project = inputsRef.current.project;
    if (project === null || !hasCurrentProject(project)) return;
    update((current) => {
      if (current.status.kind !== "ready" || current.status.value.kind !== "git") return current;
      const next = new Set<string>();
      if (expanded) {
        for (const entry of current.status.value.entries) {
          next.add(diffCardKey(entry));
        }
      }
      return { ...current, expandedKeys: next };
    });
  }

  function refresh(): void {
    const project = inputsRef.current.project;
    const route = inputsRef.current.readCurrentRoute();
    if (
      project === null ||
      !hasCurrentProject(project) ||
      stateRef.current.refreshing ||
      route?.section !== "changes"
    )
      return;
    const cards = [...document.querySelectorAll<HTMLElement>("main .diff-card")];
    const topbarBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    const cardIndex = cards.findIndex(
      (card) => card.getBoundingClientRect().bottom > topbarBottom + 8,
    );
    const card = cardIndex < 0 ? null : (cards[cardIndex] ?? null);
    reviewPosition.current = {
      project,
      route,
      refreshKey: stateRef.current.refreshKey + 1,
      cardId: card?.id ?? null,
      cardIndex: Math.max(0, cardIndex),
      top: card?.getBoundingClientRect().top ?? topbarBottom,
      scrollY: window.scrollY,
    };
    // This generation also renews expanded diff requests, including failed status reads.
    update((current) => ({ ...current, refreshing: true, refreshKey: current.refreshKey + 1 }));
  }

  function notifyStale(revision: string, changeToken: string, refreshKey: number): void {
    const current = stateRef.current;
    const project = inputsRef.current.project;
    if (
      project === null ||
      !hasCurrentProject(project) ||
      current.refreshing ||
      current.pendingUpdate ||
      current.refreshKey !== refreshKey ||
      current.status.kind !== "ready" ||
      current.status.value.kind !== "git" ||
      current.status.value.revision !== revision ||
      current.status.value.changeToken !== changeToken
    )
      return;
    update((current) => ({ ...current, pendingUpdate: true }));
  }

  const project = inputs.project;
  useEffect(() => {
    if (project === null || stateRef.current.project !== project) return;
    const controller = new AbortController();
    const generation = state.refreshKey;
    statusRequest.current = controller;
    update((current) => ({ ...current, refreshing: true }));
    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      statusRequest.current === controller &&
      stateRef.current.refreshKey === generation &&
      hasCurrentProject(project);
    fetchProjectStatus(project.absolutePath, controller.signal).then(
      (value) => {
        if (!isCurrent()) return;
        update((current) => ({
          ...current,
          status: { kind: "ready", value },
          refreshing: false,
          pendingUpdate: false,
          checkError: false,
        }));
        if (value.kind === "not_git") inputsRef.current.onNonGit(project);
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : "Something went wrong";
        update((current) => ({
          ...current,
          status: current.status.kind === "ready" ? current.status : { kind: "error", message },
          refreshing: false,
        }));
        inputsRef.current.onNotice(message);
      },
    );
    return () => {
      controller.abort();
      if (statusRequest.current === controller) statusRequest.current = null;
    };
  }, [project, state.refreshKey]);

  useEffect(() => {
    const displayed = state.status;
    if (
      project === null ||
      state.project !== project ||
      displayed.kind !== "ready" ||
      displayed.value.kind !== "git" ||
      !inputs.pollingAllowed ||
      state.refreshing
    )
      return;
    const displayedToken = displayed.value.changeToken;
    let timer: number | null = null;
    let request: AbortController | null = null;
    let disposed = false;
    let checkOnResume = false;
    let failures = 0;
    const clearTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const isCurrent = (): boolean =>
      !disposed &&
      hasCurrentProject(project) &&
      inputsRef.current.pollingAllowed &&
      stateRef.current.status === displayed &&
      !stateRef.current.refreshing;
    const check = async (): Promise<void> => {
      if (!isCurrent() || document.visibilityState !== "visible" || request !== null) return;
      clearTimer();
      const controller = new AbortController();
      request = controller;
      try {
        const latest = await fetchProjectChangeCheck(project.absolutePath, controller.signal);
        if (!isCurrent() || controller.signal.aborted) return;
        update((current) => ({
          ...current,
          pendingUpdate:
            current.pendingUpdate || latest.kind !== "git" || latest.changeToken !== displayedToken,
          checkError: false,
        }));
        failures = 0;
      } catch {
        if (!isCurrent() || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 2) update((current) => ({ ...current, checkError: true }));
      } finally {
        if (request === controller) request = null;
        if (isCurrent() && document.visibilityState === "visible") {
          if (checkOnResume) {
            checkOnResume = false;
            void check();
          } else timer = window.setTimeout(() => void check(), pollIntervalMs);
        }
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") {
        clearTimer();
        request?.abort();
        return;
      }
      if (request !== null) checkOnResume = true;
      else void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void check();
    return () => {
      disposed = true;
      clearTimer();
      request?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [project, state.project, state.status, state.refreshing, inputs.pollingAllowed]);

  useEffect(() => {
    const position = reviewPosition.current;
    if (position === null) return;
    if (project !== position.project || inputs.route !== position.route) {
      reviewPosition.current = null;
      return;
    }
    if (state.status.kind !== "ready" || state.refreshing) return;
    const main = document.querySelector("main");
    if (main === null) return;
    let frame: number | null = null;
    const isCurrent = (): boolean =>
      hasCurrentProject(position.project) &&
      inputsRef.current.readCurrentRoute() === position.route &&
      stateRef.current.refreshKey === position.refreshKey &&
      !stateRef.current.refreshing;
    const restore = (): void => {
      frame = null;
      if (!isCurrent() || main.querySelector('.diff-card[data-diff-state="loading"]') !== null)
        return;
      observer.disconnect();
      reviewPosition.current = null;
      const cards = [...document.querySelectorAll<HTMLElement>("main .diff-card")];
      const target =
        (position.cardId === null ? null : document.getElementById(position.cardId)) ??
        cards[Math.min(position.cardIndex, cards.length - 1)] ??
        document.querySelector<HTMLElement>(".changes-heading");
      if (target === null) {
        window.scrollTo({ top: position.scrollY, behavior: "instant" });
        return;
      }
      window.scrollBy({
        top: target.getBoundingClientRect().top - position.top,
        behavior: "instant",
      });
    };
    const schedule = (): void => {
      if (
        frame === null &&
        isCurrent() &&
        main.querySelector('.diff-card[data-diff-state="loading"]') === null
      )
        frame = requestAnimationFrame(restore);
    };
    // Status acceptance precedes fresh diff bodies. Their temporary loading
    // heights can clamp scroll; restore only once the rendered review settles.
    const observer = new MutationObserver(schedule);
    observer.observe(main, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-diff-state"],
    });
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [project, inputs.route, state.status, state.refreshing, state.refreshKey]);

  useEffect(() => {
    if (project !== null && state.project === project)
      saveOpenCards(project.absolutePath, state.expandedKeys);
  }, [project, state.project, state.expandedKeys]);

  const current = project !== null && state.project === project;
  return {
    model: {
      status: current ? state.status : loading,
      refreshing: current && state.refreshing,
      pendingUpdate: current && state.pendingUpdate,
      checkError: current && state.checkError,
      refreshKey: state.refreshKey,
      expandedKeys: current ? state.expandedKeys : emptyCards,
    },
    actions: {
      beginProjectOpen,
      loadProject,
      refresh,
      notifyStale,
      toggleEntry: (entry) => changeExpansion(entry, true),
      expandEntry: (entry) => changeExpansion(entry, false),
      expandAll: () => changeAllExpansion(true),
      collapseAll: () => changeAllExpansion(false),
    },
  };
}
