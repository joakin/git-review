import { isProjectPath } from "../shared/project-path.ts";
import { commentStoragePrefix, validateCommentStore, type CommentStore } from "./comments.ts";
import {
  appearanceStorageKey,
  codeTypographyStorageKey,
  isLanguageOverride,
  languageStoragePrefix,
  openCardsStoragePrefix,
  readAppearance,
  readCodeTypography,
  readSavedWorkspace,
  readWrapPreference,
  validateAppearance,
  validateCodeTypography,
  validateOpenCards,
  validateSavedWorkspace,
  workspaceStorageKey,
  wrapStorageKey,
  type Appearance,
  type CodeTypography,
  type SavedWorkspace,
} from "./storage.ts";
import { isRecord } from "../shared/validation.ts";

export const maxBackupBytes = 25 * 1024 * 1024;
const maxProjects = 32;
const maxLanguages = 1000;

type SavedCards = { projectPath: string; keys: string[] };
type SavedLanguage = { projectPath: string; path: string; language: string };

type ReviewBackupData = {
  rootPath: string;
  workspace: SavedWorkspace;
  wrap: boolean;
  comments: CommentStore[];
  openCards: SavedCards[];
  languages: SavedLanguage[];
};
export type ReviewBackup = ReviewBackupData & {
  version: 6;
  codeTypography: CodeTypography;
  appearance: Appearance;
};

function projectInRoot(value: unknown, rootPath: string): value is string {
  return (
    isProjectPath(value) &&
    (value === rootPath || value.startsWith(rootPath === "/" ? "/" : `${rootPath}/`))
  );
}

function safePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\0")
  )
    return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function uniqueProjectPath(value: unknown, seen: Set<string>, rootPath: string): value is string {
  if (!projectInRoot(value, rootPath) || seen.has(value)) return false;
  seen.add(value);
  return true;
}

export function parseReviewBackup(value: unknown, rootPath: string): ReviewBackup {
  if (
    !isRecord(value) ||
    value["version"] !== 6 ||
    !isProjectPath(rootPath) ||
    value["rootPath"] !== rootPath
  )
    throw new Error("This backup belongs to a different host root or uses an unsupported format.");
  const typography = validateCodeTypography(value["codeTypography"]);
  if (typography === null) throw new Error("Backup code typography is invalid.");
  const appearance = validateAppearance(value["appearance"]);
  if (appearance === null) throw new Error("Backup appearance is invalid.");
  const workspace = validateSavedWorkspace(value["workspace"], rootPath);
  if (workspace === null || typeof value["wrap"] !== "boolean")
    throw new Error("Backup preferences are invalid.");
  const rawWorkspace = value["workspace"];
  if (
    !isRecord(rawWorkspace) ||
    !Array.isArray(rawWorkspace["recentPaths"]) ||
    rawWorkspace["recentPaths"].length !== workspace.recentPaths.length
  )
    throw new Error("Backup recent folders are invalid or too numerous.");
  const rawComments = value["comments"];
  const rawCards = value["openCards"];
  const rawLanguages = value["languages"];
  if (
    !Array.isArray(rawComments) ||
    rawComments.length > maxProjects ||
    !Array.isArray(rawCards) ||
    rawCards.length > maxProjects ||
    !Array.isArray(rawLanguages) ||
    rawLanguages.length > maxLanguages
  ) {
    throw new Error("Backup review data is missing or too large.");
  }

  const comments: CommentStore[] = [];
  const commentIds = new Set<string>();
  for (const item of rawComments) {
    if (!isRecord(item) || !uniqueProjectPath(item["projectPath"], commentIds, rootPath))
      throw new Error("Backup contains an invalid or duplicate project comment record.");
    const store = validateCommentStore(item, item["projectPath"]);
    if (store === null) throw new Error("Backup contains invalid comments or copy history.");
    comments.push(store);
  }

  const openCards: SavedCards[] = [];
  const cardIds = new Set<string>();
  for (const item of rawCards) {
    if (!isRecord(item) || !uniqueProjectPath(item["projectPath"], cardIds, rootPath))
      throw new Error("Backup contains an invalid or duplicate open-card record.");
    const keys = validateOpenCards({ version: 1, keys: item["keys"] });
    if (keys === null || !Array.isArray(item["keys"]) || item["keys"].length !== keys.length)
      throw new Error("Backup contains invalid open-card state.");
    openCards.push({ projectPath: item["projectPath"], keys });
  }

  const languages: SavedLanguage[] = [];
  const languageKeys = new Set<string>();
  for (const item of rawLanguages) {
    if (
      !isRecord(item) ||
      typeof item["projectPath"] !== "string" ||
      !projectInRoot(item["projectPath"], rootPath) ||
      !safePath(item["path"]) ||
      !isLanguageOverride(item["language"])
    ) {
      throw new Error("Backup contains an invalid language override.");
    }
    const identity = JSON.stringify([item["projectPath"], item["path"]]);
    if (languageKeys.has(identity))
      throw new Error("Backup contains duplicate language overrides.");
    languageKeys.add(identity);
    languages.push({
      projectPath: item["projectPath"],
      path: item["path"],
      language: item["language"],
    });
  }

  return {
    version: 6,
    rootPath,
    workspace,
    wrap: value["wrap"],
    comments,
    openCards,
    languages,
    codeTypography: typography,
    appearance,
  };
}

export function createReviewBackup(rootPath: string): ReviewBackup {
  const workspace = readSavedWorkspace(rootPath);
  const comments: CommentStore[] = [];
  const openCards: SavedCards[] = [];
  const languages: SavedLanguage[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (key.startsWith(commentStoragePrefix)) {
      const projectPath = decodeURIComponent(key.slice(commentStoragePrefix.length));
      if (!isProjectPath(projectPath))
        throw new Error("Stored comment key is invalid; export stopped.");
      if (!projectInRoot(projectPath, rootPath)) continue;
      const store = validateCommentStore(JSON.parse(value) as unknown, projectPath);
      if (store === null)
        throw new Error(`Stored comments for ${projectPath} are invalid; export stopped.`);
      comments.push(store);
    } else if (key.startsWith(openCardsStoragePrefix)) {
      const projectPath = decodeURIComponent(key.slice(openCardsStoragePrefix.length));
      if (!isProjectPath(projectPath))
        throw new Error("Stored open-card key is invalid; export stopped.");
      if (!projectInRoot(projectPath, rootPath)) continue;
      const keys = validateOpenCards(JSON.parse(value) as unknown);
      if (keys === null)
        throw new Error(`Stored open cards for ${projectPath} are invalid; export stopped.`);
      openCards.push({ projectPath, keys });
    } else if (key.startsWith(languageStoragePrefix)) {
      const match = /^([^:]+):(.*)$/.exec(key.slice(languageStoragePrefix.length));
      if (match === null || match[1] === undefined || match[2] === undefined)
        throw new Error("Stored language override is invalid; export stopped.");
      const projectPath = decodeURIComponent(match[1]);
      if (!isProjectPath(projectPath))
        throw new Error("Stored language project is invalid; export stopped.");
      if (!projectInRoot(projectPath, rootPath)) continue;
      const path = decodeURIComponent(match[2]);
      if (!safePath(path))
        throw new Error("Stored language override path is invalid; export stopped.");
      if (!isLanguageOverride(value))
        throw new Error("Stored language override is invalid; export stopped.");
      languages.push({ projectPath, path, language: value });
    }
  }
  const backup = parseReviewBackup(
    {
      version: 6,
      rootPath,
      workspace,
      wrap: readWrapPreference(),
      codeTypography: readCodeTypography(),
      appearance: readAppearance(),
      comments,
      openCards,
      languages,
    },
    rootPath,
  );
  if (new Blob([JSON.stringify(backup)]).size > maxBackupBytes)
    throw new Error("Review data exceeds the 25 MiB backup limit.");
  return backup;
}

export function applyReviewBackup(backup: ReviewBackup): void {
  const writes = new Map<string, string>([
    [workspaceStorageKey, JSON.stringify(backup.workspace)],
    [wrapStorageKey, JSON.stringify(backup.wrap)],
  ]);
  writes.set(codeTypographyStorageKey, JSON.stringify(backup.codeTypography));
  writes.set(appearanceStorageKey, JSON.stringify(backup.appearance));
  for (const store of backup.comments)
    writes.set(
      `${commentStoragePrefix}${encodeURIComponent(store.projectPath)}`,
      JSON.stringify(store),
    );
  for (const cards of backup.openCards)
    writes.set(
      `${openCardsStoragePrefix}${encodeURIComponent(cards.projectPath)}`,
      JSON.stringify({ version: 1, keys: cards.keys }),
    );
  for (const language of backup.languages)
    writes.set(
      `${languageStoragePrefix}${encodeURIComponent(language.projectPath)}:${encodeURIComponent(language.path)}`,
      language.language,
    );

  const previous = new Map<string, string | null>();
  try {
    for (const [key, value] of writes) {
      previous.set(key, localStorage.getItem(key));
      localStorage.setItem(key, value);
    }
  } catch {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        /* Browser storage can also reject rollback. */
      }
    }
    throw new Error(
      "The browser could not save this backup. Existing data was restored where possible.",
    );
  }
}
