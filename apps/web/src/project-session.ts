import { useEffect, useRef, useState } from "preact/hooks";
import type { Project, RootInfo } from "@git-review/shared/api";
import { fetchRoot, lookupProject } from "./api.ts";
import { parseNavigationSearch } from "./navigation.ts";
import type { LoadState } from "./load-state.ts";
import {
  emptyWorkspace,
  readActiveProject,
  readSavedWorkspace,
  saveActiveProject,
  saveWorkspace,
  withSelectedPath,
  type SavedWorkspace,
} from "./storage.ts";

type ProjectOpening =
  | { kind: "idle" }
  | { kind: "opening"; path: string }
  | { kind: "error"; path: string; message: string };
type SessionState = {
  root: LoadState<RootInfo>;
  workspace: SavedWorkspace;
  resolved: Project | null;
  opening: ProjectOpening;
};
type ProjectSession = {
  model: {
    root: LoadState<RootInfo>;
    project: Project | null;
    opening: boolean;
    openError: { path: string; message: string } | null;
    recentPaths: readonly string[];
  };
  actions: { selectFolder: (path: string) => void; restoreDefaultRoute: () => void };
};
type SessionInputs = {
  projectPath: string | null;
  readCurrentProjectPath: () => string | null;
  onRestoreProject: (path: string | null) => void;
  onSelectProject: (path: string) => void;
  onNotice: (message: string | null) => void;
  onOpening: () => void;
  onOpened: (project: Project) => void;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Owns root connection, resolved project metadata, and root-scoped persistence. */
export function useProjectSession(inputs: SessionInputs): ProjectSession {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const [session, setSession] = useState<SessionState>(() => ({
    root: { kind: "loading" },
    workspace: emptyWorkspace(""),
    resolved: null,
    opening: { kind: "idle" },
  }));
  const sessionRef = useRef(session);
  const openRequest = useRef<AbortController | null>(null);

  function updateSession(change: (current: SessionState) => SessionState): void {
    const next = change(sessionRef.current);
    sessionRef.current = next;
    setSession(next);
  }

  function restoreDefaultRoute(): void {
    const root = sessionRef.current.root;
    if (root.kind === "ready")
      inputsRef.current.onRestoreProject(readActiveProject(root.value.path));
  }

  function selectFolder(path: string): void {
    const current = sessionRef.current;
    if (current.opening.kind === "opening") return;
    if (current.root.kind !== "ready") {
      inputsRef.current.onNotice("The host folder root is not available yet.");
      return;
    }
    inputsRef.current.onNotice(null);
    // Explicit selection resolves metadata again after returning through the picker.
    if (
      inputsRef.current.readCurrentProjectPath() !== path &&
      current.resolved?.relativePath === path
    )
      updateSession((value) => ({ ...value, resolved: null }));
    inputsRef.current.onSelectProject(path);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function connect(): Promise<void> {
      try {
        const root = await fetchRoot(controller.signal);
        if (controller.signal.aborted) return;
        const workspace = readSavedWorkspace(root.path);
        updateSession((current) => ({
          ...current,
          root: { kind: "ready", value: root },
          workspace,
        }));
        // An explicit destination may have arrived while the root was loading.
        if (parseNavigationSearch(window.location.search).kind === "empty") restoreDefaultRoute();
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          updateSession((current) => ({
            ...current,
            root: { kind: "error", message: messageFor(error) },
          }));
      }
    }
    void connect();
    return () => controller.abort();
  }, []);

  const root = session.root;
  useEffect(() => {
    const path = inputs.projectPath;
    if (
      root.kind !== "ready" ||
      path === null ||
      sessionRef.current.resolved?.relativePath === path
    ) {
      updateSession((current) =>
        current.opening.kind === "opening" ? { ...current, opening: { kind: "idle" } } : current,
      );
      return;
    }
    const controller = new AbortController();
    openRequest.current = controller;
    updateSession((current) => ({
      ...current,
      resolved: null,
      opening: { kind: "opening", path },
    }));
    inputsRef.current.onOpening();
    // App updates its route ref synchronously, before effect cleanup can abort.
    const isCurrentOpen = (): boolean =>
      !controller.signal.aborted &&
      openRequest.current === controller &&
      sessionRef.current.root === root &&
      inputsRef.current.readCurrentProjectPath() === path;
    lookupProject(
      path === "" ? root.value.path : `${root.value.path === "/" ? "" : root.value.path}/${path}`,
      controller.signal,
    ).then(
      (selected) => {
        if (!isCurrentOpen()) return;
        updateSession((current) => ({ ...current, resolved: selected }));
        inputsRef.current.onOpened(selected);
        saveActiveProject(root.value.path, selected.relativePath);
        const current = sessionRef.current;
        const scoped =
          current.workspace.rootPath === root.value.path
            ? current.workspace
            : emptyWorkspace(root.value.path);
        const workspace = withSelectedPath(scoped, selected.relativePath);
        saveWorkspace(workspace);
        updateSession((value) => ({ ...value, workspace, opening: { kind: "idle" } }));
      },
      (error: unknown) => {
        if (!isCurrentOpen()) return;
        updateSession((current) => ({
          ...current,
          opening: { kind: "error", path, message: messageFor(error) },
        }));
      },
    );
    return () => {
      controller.abort();
      if (openRequest.current === controller) openRequest.current = null;
    };
  }, [root, inputs.projectPath]);

  return {
    model: {
      root,
      project: session.resolved?.relativePath === inputs.projectPath ? session.resolved : null,
      opening: session.opening.kind === "opening",
      openError:
        session.opening.kind === "error"
          ? { path: session.opening.path, message: session.opening.message }
          : null,
      recentPaths: session.workspace.recentPaths,
    },
    actions: { selectFolder, restoreDefaultRoute },
  };
}
