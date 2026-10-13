import type { Project } from "@git-review/shared/api";
import { createAgentDataRepository, agentCatalogStorageKey } from "./agent-data.ts";
import {
  emptyAgentCatalog,
  defaultAgentLabel,
  reconcileAgentProjects,
  parseAgentBackup,
  type AgentBackup,
  type AgentGlobalPreferences,
  type SavedAgentReview,
} from "./agent-data-format.ts";
import { projectResourceKey } from "./agent-project.ts";
import { emptyCommentStore, type CommentStore } from "./comments.ts";
import {
  readLegacyData,
  readLegacyGlobal,
  hasLegacyProjects,
  assignLegacyData,
  type LegacySnapshot,
} from "./legacy-data.ts";
import { readAgentTabSelection, saveAgentTabSelection } from "./agent-tab-state.ts";
import {
  emptyWorkspace,
  parseActiveProject,
  maxOpenCards,
  type SavedWorkspace,
} from "./storage.ts";
import type { ProjectState } from "./project-state.ts";

export type BrowserStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type DataStartup =
  | { kind: "ready" }
  | { kind: "legacy"; snapshot: LegacySnapshot }
  | { kind: "error"; message: string };
type LoadedReview =
  { kind: "ready"; value: SavedAgentReview } | { kind: "unavailable"; value: SavedAgentReview };
export function memoryDataStorage(): BrowserStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Local review data could not be saved.";
}

export function createBrowserData(local: BrowserStorage | null, tab: BrowserStorage | null) {
  let repository = createAgentDataRepository(local ?? memoryDataStorage());
  let temporary = local === null;
  const problems = new Map<string, string>();
  const listeners = new Set<() => void>();
  const records = new Map<string, LoadedReview>();
  const unsaved = new Map<string, SavedAgentReview>();
  let global = emptyAgentCatalog().global;
  let globalChanges: Partial<AgentGlobalPreferences> = {};
  function report(error: unknown, topic = "data"): void {
    problems.set(topic, message(error));
    for (const listener of listeners) listener();
  }
  function resolveProblem(topic: string): void {
    if (problems.delete(topic)) for (const listener of listeners) listener();
  }
  function initialize(): DataStartup {
    try {
      if (local === null)
        throw new Error("Browser storage is unavailable. Existing local reviews cannot be read.");
      const conversion = repository.readLegacyConversion();
      if (conversion.kind === "pending") {
        const snapshot = readLegacyData(local);
        global = snapshot.data.global;
        if (hasLegacyProjects(snapshot.data)) return { kind: "legacy", snapshot };
      }
      if (local.getItem(agentCatalogStorageKey) === null)
        repository.saveCatalog({ ...emptyAgentCatalog(), global: readLegacyGlobal(local) });
      global = repository.readCatalog().global;
      return { kind: "ready" };
    } catch (error) {
      return { kind: "error", message: message(error) };
    }
  }
  const startup = initialize();
  const importNoticeKey = "git-review:agents:v1:import-notice";
  try {
    if (tab?.getItem(importNoticeKey) === "cleanup-incomplete") {
      tab.removeItem(importNoticeKey);
      report(
        "Reviews were saved, but older saved copies could not be removed from browser storage.",
        "import-cleanup",
      );
    }
  } catch {
    /* A transient notice cannot prevent access to saved reviews. */
  }
  function noteCleanup(result: { cleanup: "complete" | "incomplete" }): void {
    if (result.cleanup === "incomplete") {
      try {
        tab?.setItem(importNoticeKey, "cleanup-incomplete");
      } catch {
        report(
          "Reviews were saved, but older saved copies could not be removed from browser storage.",
          "import-cleanup",
        );
      }
    }
  }

  function load(endpoint: string, path: string): LoadedReview {
    const key = projectResourceKey({ endpoint, projectPath: path });
    const cached = records.get(key);
    if (cached !== undefined) return cached;
    const name =
      path
        .split("/")
        .at(-1)
        ?.replace(/[\x00-\x1f\x7f]/g, " ")
        .trim() || "Root folder";
    const fallback: SavedAgentReview = {
      version: 1,
      project: { endpoint, projectPath: path, name, location: { kind: "unknown-root" } },
      comments: emptyCommentStore(path),
      preferences: { openCards: [], languages: [] },
    };
    let loaded: LoadedReview;
    try {
      loaded = { kind: "ready", value: repository.readReview(fallback.project) ?? fallback };
    } catch (error) {
      report(
        "Could not read saved review for " + path + " at " + endpoint + ". " + message(error),
        "read:" + key,
      );
      loaded = { kind: "unavailable", value: fallback };
    }
    records.set(key, loaded);
    return loaded;
  }
  function change(
    endpoint: string,
    path: string,
    update: (value: SavedAgentReview) => SavedAgentReview,
  ): boolean {
    const loaded = load(endpoint, path);
    const value = update(loaded.value);
    const topic = "write:" + projectResourceKey(value.project);
    records.set(projectResourceKey(value.project), { ...loaded, value });
    unsaved.set(projectResourceKey(value.project), value);
    if (loaded.kind === "unavailable") {
      report(
        "Saved data for this project could not be read. This tab's edits are temporary; the original saved record has not been replaced.",
      );
      return false;
    }
    try {
      repository.saveReview(value);
      unsaved.delete(projectResourceKey(value.project));
      resolveProblem(topic);
      return !temporary;
    } catch (error) {
      report(
        "Could not save review for " + path + " at " + endpoint + ". " + message(error),
        topic,
      );
      return false;
    }
  }

  function projectState(endpoint: string): ProjectState {
    const active = new Map<string, string | null>();
    const workspaces = new Map<string, SavedWorkspace>();
    return {
      rememberProject(project: Project, rootPath: string | null) {
        change(endpoint, project.absolutePath, (current) => ({
          ...current,
          project: {
            endpoint,
            projectPath: project.absolutePath,
            name: project.name.replace(/[\x00-\x1f\x7f]/g, " ").trim() || current.project.name,
            location:
              rootPath === null ||
              (project.relativePath === ""
                ? rootPath
                : (rootPath === "/" ? "" : rootPath) + "/" + project.relativePath) !==
                project.absolutePath
                ? { kind: "unknown-root" }
                : { kind: "known-root", rootPath, relativePath: project.relativePath },
          },
        }));
        if (tab !== null) {
          try {
            saveAgentTabSelection(tab, {
              version: 1,
              kind: "canonical",
              endpoint,
              projectPath: project.absolutePath,
            });
          } catch (error) {
            report(error);
          }
        }
        try {
          const catalog = repository.readCatalog();
          if (!catalog.connections.some((record) => record.endpoint === endpoint))
            repository.saveCatalog({
              ...catalog,
              connections: [
                ...catalog.connections,
                { endpoint, label: defaultAgentLabel(endpoint) },
              ],
            });
        } catch (error) {
          report(error);
        }
      },
      readComments: (path) => load(endpoint, path).value.comments,
      saveComments: (value: CommentStore) =>
        change(endpoint, value.projectPath, (current) => ({ ...current, comments: value })),
      readOpenCards: (path) => new Set(load(endpoint, path).value.preferences.openCards),
      saveOpenCards: (path, keys) => {
        change(endpoint, path, (current) => ({
          ...current,
          preferences: { ...current.preferences, openCards: [...keys].slice(0, maxOpenCards) },
        }));
      },
      readLanguageOverride: (path, file) =>
        load(endpoint, path).value.preferences.languages.find((record) => record.path === file)
          ?.language ?? null,
      saveLanguageOverride: (path, file, language) => {
        change(endpoint, path, (current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            languages: [
              ...current.preferences.languages.filter((record) => record.path !== file),
              ...(language === null ? [] : [{ path: file, language }]),
            ],
          },
        }));
      },
      readWorkspace(rootPath) {
        if (workspaces.has(rootPath)) return workspaces.get(rootPath) ?? emptyWorkspace(rootPath);
        try {
          const saved = repository
            .readCatalog()
            .workspaces.find(
              (record) => record.endpoint === endpoint && record.rootPath === rootPath,
            );
          const value =
            saved === undefined
              ? emptyWorkspace(rootPath)
              : { version: 4 as const, rootPath, recentPaths: saved.recentPaths };
          workspaces.set(rootPath, value);
          return value;
        } catch (error) {
          report(error);
          return emptyWorkspace(rootPath);
        }
      },
      saveWorkspace(value) {
        workspaces.set(value.rootPath, value);
        try {
          const catalog = repository.readCatalog();
          repository.saveCatalog({
            ...catalog,
            workspaces: [
              ...catalog.workspaces.filter(
                (record) => record.endpoint !== endpoint || record.rootPath !== value.rootPath,
              ),
              { endpoint, rootPath: value.rootPath, recentPaths: value.recentPaths },
            ],
          });
        } catch (error) {
          report(error);
        }
      },
      readActiveProject(rootPath) {
        if (active.has(rootPath)) return active.get(rootPath) ?? null;
        const selected = tab === null ? null : readAgentTabSelection(tab);
        return selected?.kind === "scoped" &&
          selected.endpoint === endpoint &&
          selected.rootPath === rootPath
          ? selected.relativePath
          : null;
      },
      saveActiveProject(rootPath, relativePath) {
        active.set(rootPath, relativePath);
        try {
          if (tab === null)
            throw new Error(
              "Tab storage is unavailable; the current project may not restore after reload.",
            );
          if (relativePath === null) {
            const previous = readAgentTabSelection(tab);
            if (
              previous?.kind === "scoped" &&
              previous.endpoint === endpoint &&
              previous.rootPath === rootPath
            )
              saveAgentTabSelection(tab, null);
          } else
            saveAgentTabSelection(tab, {
              version: 1,
              kind: "scoped",
              endpoint,
              rootPath,
              relativePath,
              projectPath:
                relativePath === ""
                  ? rootPath
                  : (rootPath === "/" ? "" : rootPath) + "/" + relativePath,
            });
        } catch (error) {
          report(error);
        }
      },
    };
  }
  return {
    startup,
    projectState,
    readProblem: () => [...problems.values()].join("\n") || null,
    subscribeProblem(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isTemporary: () => temporary,
    continueTemporarily() {
      repository = createAgentDataRepository(memoryDataStorage());
      repository.saveCatalog({ ...emptyAgentCatalog(), global });
      temporary = true;
      report(
        "Reviews in this tab are temporary. Export them before closing or reloading; existing browser data is untouched.",
      );
    },
    readCatalog: () => repository.readCatalog(),
    readLastSelection: () => (tab === null ? null : readAgentTabSelection(tab)),
    readGlobal(refresh = true) {
      if (refresh) {
        try {
          global = { ...repository.readCatalog().global, ...globalChanges };
          resolveProblem("global-read");
        } catch (error) {
          report(error, "global-read");
        }
      }
      return global;
    },
    saveGlobal(update: Partial<AgentGlobalPreferences>) {
      globalChanges = { ...globalChanges, ...update };
      global = { ...global, ...update };
      try {
        const catalog = repository.readCatalog();
        global = { ...catalog.global, ...globalChanges };
        repository.saveCatalog({ ...catalog, global });
        globalChanges = {};
        resolveProblem("global-save");
      } catch (error) {
        report(error, "global-save");
      }
    },
    exportBackup() {
      const backup = repository.exportBackup();
      // Include the current tab's edits when a project save failed, without hiding unreadable records.
      const reviews = [
        ...new Map(
          [...backup.reviews, ...unsaved.values()].map((review) => [
            projectResourceKey(review.project),
            review,
          ]),
        ).values(),
      ];
      return parseAgentBackup({
        ...backup,
        catalog: {
          ...reconcileAgentProjects(backup.catalog, reviews),
          global: { ...backup.catalog.global, ...globalChanges },
        },
        reviews,
      });
    },
    applyBackup(backup: AgentBackup) {
      if (temporary)
        throw new Error(
          "Import needs browser storage access. Export temporary reviews before reloading to retry.",
        );
      const result = repository.applyBackup(backup);
      noteCleanup(result);
      records.clear();
      unsaved.clear();
      globalChanges = {};
      global = repository.readCatalog().global;
      return result;
    },
    convertLegacy(snapshot: LegacySnapshot, endpoint: string) {
      if (local === null || temporary)
        throw new Error("Browser storage is unavailable; conversion cannot be saved.");
      if (repository.readLegacyConversion().kind === "complete")
        throw new Error(
          "Existing reviews were already converted in another tab. Reload before continuing.",
        );
      if (readLegacyData(local).fingerprint !== snapshot.fingerprint)
        throw new Error(
          "Existing data changed in another tab. Reload to review a fresh conversion preview.",
        );
      const backup = assignLegacyData(snapshot.data, endpoint);
      const result = repository.applyBackup(backup, { kind: "complete", endpoint });
      noteCleanup(result);
      // Preserve legacy source keys. The marker prevents later old-tab writes being reimported.
      records.clear();
      unsaved.clear();
      globalChanges = {};
      global = repository.readCatalog().global;
      if (tab !== null && snapshot.data.workspace !== null) {
        try {
          const workspace = snapshot.data.workspace;
          const raw = tab.getItem("git-review:active-project:v2");
          const path =
            raw === null
              ? null
              : parseActiveProject(JSON.parse(raw) as unknown, workspace.rootPath);
          if (path !== null)
            saveAgentTabSelection(tab, {
              version: 1,
              kind: "scoped",
              endpoint: backup.catalog.connections[0]?.endpoint ?? endpoint,
              rootPath: workspace.rootPath,
              relativePath: path,
              projectPath:
                path === ""
                  ? workspace.rootPath
                  : (workspace.rootPath === "/" ? "" : workspace.rootPath) + "/" + path,
            });
        } catch (error) {
          report(error);
        }
      }
      return result;
    },
  };
}
export type BrowserData = ReturnType<typeof createBrowserData>;

export function openBrowserData(): BrowserData {
  let local: Storage | null = null;
  let tab: Storage | null = null;
  try {
    local = localStorage;
  } catch {
    /* Reported by the startup gate. */
  }
  try {
    tab = sessionStorage;
  } catch {
    /* Review can continue without tab restoration. */
  }
  return createBrowserData(local, tab);
}

export function readBootstrapAppearance() {
  try {
    const repository = createAgentDataRepository(localStorage);
    return localStorage.getItem(agentCatalogStorageKey) === null
      ? readLegacyGlobal(localStorage).appearance
      : repository.readCatalog().global.appearance;
  } catch {
    return emptyAgentCatalog().global.appearance;
  }
}
