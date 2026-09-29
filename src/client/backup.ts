import { commentStoragePrefix, validateCommentStore, type CommentStore } from "./comments.ts";
import { codeTypographyStorageKey, isLanguageOverride, languageStoragePrefix, openCardsStoragePrefix, readCodeTypography, readSavedWorkspace, readWrapPreference, validateCodeTypography, validateOpenCards, validateSavedWorkspace, workspaceStorageKey, wrapStorageKey, type CodeTypography, type SavedWorkspace } from "./storage.ts";
import { isRecord } from "../shared/validation.ts";

export const maxBackupBytes = 25 * 1024 * 1024;
const maxProjects = 32;
const maxLanguages = 1000;
const projectIdPattern = /^[0-9a-f]{20}$/;

type SavedCards = { projectId: string; keys: string[] };
type SavedLanguage = { projectId: string; path: string; language: string };

type ReviewBackupData = {
  rootPath: string;
  workspace: SavedWorkspace;
  wrap: boolean;
  comments: CommentStore[];
  openCards: SavedCards[];
  languages: SavedLanguage[];
};
export type ReviewBackup =
  | (ReviewBackupData & { version: 1 })
  | (ReviewBackupData & { version: 2; codeTypography: CodeTypography });

function safePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}

function uniqueProjectId(value: unknown, seen: Set<string>): value is string {
  if (typeof value !== "string" || !projectIdPattern.test(value) || seen.has(value)) return false;
  seen.add(value);
  return true;
}

export function parseReviewBackup(value: unknown, rootPath: string): ReviewBackup {
  if (!isRecord(value) || (value["version"] !== 1 && value["version"] !== 2) || value["rootPath"] !== rootPath) throw new Error("This backup belongs to a different host root or uses an unsupported format.");
  const typography = value["version"] === 2 ? validateCodeTypography(value["codeTypography"]) : null;
  if (value["version"] === 2 && typography === null) throw new Error("Backup code typography is invalid.");
  const workspace = validateSavedWorkspace(value["workspace"], rootPath);
  if (workspace === null || typeof value["wrap"] !== "boolean") throw new Error("Backup preferences are invalid.");
  const rawWorkspace = value["workspace"];
  if (!isRecord(rawWorkspace) || !Array.isArray(rawWorkspace["recentPaths"]) || rawWorkspace["recentPaths"].length !== workspace.recentPaths.length) throw new Error("Backup recent folders are invalid or too numerous.");
  const rawComments = value["comments"];
  const rawCards = value["openCards"];
  const rawLanguages = value["languages"];
  if (!Array.isArray(rawComments) || rawComments.length > maxProjects || !Array.isArray(rawCards) || rawCards.length > maxProjects || !Array.isArray(rawLanguages) || rawLanguages.length > maxLanguages) {
    throw new Error("Backup review data is missing or too large.");
  }

  const comments: CommentStore[] = [];
  const commentIds = new Set<string>();
  for (const item of rawComments) {
    if (!isRecord(item) || !uniqueProjectId(item["projectId"], commentIds)) throw new Error("Backup contains an invalid or duplicate project comment record.");
    const store = validateCommentStore(item, item["projectId"]);
    if (store === null) throw new Error("Backup contains invalid comments or copy history.");
    comments.push(store);
  }

  const openCards: SavedCards[] = [];
  const cardIds = new Set<string>();
  for (const item of rawCards) {
    if (!isRecord(item) || !uniqueProjectId(item["projectId"], cardIds)) throw new Error("Backup contains an invalid or duplicate open-card record.");
    const keys = validateOpenCards({ version: 1, keys: item["keys"] });
    if (keys === null || !Array.isArray(item["keys"]) || item["keys"].length !== keys.length) throw new Error("Backup contains invalid open-card state.");
    openCards.push({ projectId: item["projectId"], keys });
  }

  const languages: SavedLanguage[] = [];
  const languageKeys = new Set<string>();
  for (const item of rawLanguages) {
    if (!isRecord(item) || typeof item["projectId"] !== "string" || !projectIdPattern.test(item["projectId"]) || !safePath(item["path"]) || !isLanguageOverride(item["language"])) {
      throw new Error("Backup contains an invalid language override.");
    }
    const identity = `${item["projectId"]}:${encodeURIComponent(item["path"])}`;
    if (languageKeys.has(identity)) throw new Error("Backup contains duplicate language overrides.");
    languageKeys.add(identity);
    languages.push({ projectId: item["projectId"], path: item["path"], language: item["language"] });
  }

  const data = { rootPath, workspace, wrap: value["wrap"], comments, openCards, languages };
  if (value["version"] === 1) return { version: 1, ...data };
  if (typography === null) throw new Error("Backup code typography is invalid.");
  return { version: 2, ...data, codeTypography: typography };
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
      const projectId = key.slice(commentStoragePrefix.length);
      if (!projectIdPattern.test(projectId)) throw new Error("Stored comment key is invalid; export stopped.");
      const store = validateCommentStore(JSON.parse(value) as unknown, projectId);
      if (store === null) throw new Error(`Stored comments for ${projectId} are invalid; export stopped.`);
      comments.push(store);
    } else if (key.startsWith(openCardsStoragePrefix)) {
      const projectId = key.slice(openCardsStoragePrefix.length);
      if (!projectIdPattern.test(projectId)) throw new Error("Stored open-card key is invalid; export stopped.");
      const keys = validateOpenCards(JSON.parse(value) as unknown);
      if (keys === null) throw new Error(`Stored open cards for ${projectId} are invalid; export stopped.`);
      openCards.push({ projectId, keys });
    } else if (key.startsWith(languageStoragePrefix)) {
      const match = /^([0-9a-f]{20}):(.*)$/.exec(key.slice(languageStoragePrefix.length));
      if (match === null || match[1] === undefined || match[2] === undefined || !isLanguageOverride(value)) throw new Error("Stored language override is invalid; export stopped.");
      const path = decodeURIComponent(match[2]);
      if (!safePath(path)) throw new Error("Stored language override path is invalid; export stopped.");
      languages.push({ projectId: match[1], path, language: value });
    }
  }
  const backup = parseReviewBackup({ version: 2, rootPath, workspace, wrap: readWrapPreference(), codeTypography: readCodeTypography(), comments, openCards, languages }, rootPath);
  if (new Blob([JSON.stringify(backup)]).size > maxBackupBytes) throw new Error("Review data exceeds the 25 MiB backup limit.");
  return backup;
}

export function applyReviewBackup(backup: ReviewBackup): void {
  const writes = new Map<string, string>([
    [workspaceStorageKey, JSON.stringify(backup.workspace)],
    [wrapStorageKey, JSON.stringify(backup.wrap)],
  ]);
  if (backup.version === 2) writes.set(codeTypographyStorageKey, JSON.stringify(backup.codeTypography));
  for (const store of backup.comments) writes.set(`${commentStoragePrefix}${store.projectId}`, JSON.stringify(store));
  for (const cards of backup.openCards) writes.set(`${openCardsStoragePrefix}${cards.projectId}`, JSON.stringify({ version: 1, keys: cards.keys }));
  for (const language of backup.languages) writes.set(`${languageStoragePrefix}${language.projectId}:${encodeURIComponent(language.path)}`, language.language);

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
      } catch { /* Browser storage can also reject rollback. */ }
    }
    throw new Error("The browser could not save this backup. Existing data was restored where possible.");
  }
}
