import * as storage from "./storage.ts";
import type { Project } from "@git-review/shared/api";
import type { readCommentStore, saveCommentStore } from "./comments.ts";

/** Endpoint-owned browser state supplied by the application data owner. */
export type ProjectState = {
  rememberProject: (project: Project, rootPath: string | null) => void;
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
