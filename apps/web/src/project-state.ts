import * as storage from "./storage.ts";
import {
  emptyCommentStore,
  readCommentStore,
  saveCommentStore,
  type CommentStore,
} from "./comments.ts";

/** Temporary port: only the explicitly configured legacy agent touches the old formats. */
export type ProjectState = {
  kind: "legacy" | "memory";
  readComments: typeof readCommentStore;
  saveComments: typeof saveCommentStore;
  readOpenCards: typeof storage.readOpenCards;
  saveOpenCards: typeof storage.saveOpenCards;
  readLanguageOverride: typeof storage.readLanguageOverride;
  saveLanguageOverride: typeof storage.saveLanguageOverride;
  readWorkspace: typeof storage.readSavedWorkspace;
  saveWorkspace: typeof storage.saveWorkspace;
  readActiveProject: typeof storage.readActiveProject;
  saveActiveProject: typeof storage.saveActiveProject;
};

export function createProjectState(kind: "legacy" | "memory"): ProjectState {
  if (kind === "legacy")
    return {
      kind,
      readComments: readCommentStore,
      saveComments: saveCommentStore,
      readOpenCards: storage.readOpenCards,
      saveOpenCards: storage.saveOpenCards,
      readLanguageOverride: storage.readLanguageOverride,
      saveLanguageOverride: storage.saveLanguageOverride,
      readWorkspace: storage.readSavedWorkspace,
      saveWorkspace: storage.saveWorkspace,
      readActiveProject: storage.readActiveProject,
      saveActiveProject: storage.saveActiveProject,
    };
  const comments = new Map<string, CommentStore>();
  const cards = new Map<string, ReadonlySet<string>>();
  const languages = new Map<string, string | null>();
  const workspaces = new Map<string, storage.SavedWorkspace>();
  const active = new Map<string, string | null>();
  return {
    kind,
    readComments: (path) => comments.get(path) ?? emptyCommentStore(path),
    saveComments: (value) => {
      comments.set(value.projectPath, value);
      return true;
    },
    readOpenCards: (path) => new Set(cards.get(path)),
    saveOpenCards: (path, value) => {
      cards.set(path, new Set(value));
    },
    readLanguageOverride: (project, path) => languages.get(JSON.stringify([project, path])) ?? null,
    saveLanguageOverride: (project, path, value) => {
      languages.set(JSON.stringify([project, path]), value);
    },
    readWorkspace: (root) => workspaces.get(root) ?? storage.emptyWorkspace(root),
    saveWorkspace: (value) => {
      workspaces.set(value.rootPath, value);
    },
    readActiveProject: (root) => active.get(root) ?? null,
    saveActiveProject: (root, value) => {
      active.set(root, value);
    },
  };
}
