import { isRecord } from "../shared/validation.ts";
import { isCodeFontFamily, type CodeFontFamily } from "./code-fonts.ts";

export const workspaceStorageKey = "git-review:workspace:v3";
const legacyKey = "git-review:workspace:v2";
const activeProjectKey = "git-review:active-project:v1";
export const wrapStorageKey = "git-review:wrap:v1";
export const codeTypographyStorageKey = "git-review:code-typography:v1";
export const openCardsStoragePrefix = "git-review:open-cards:v1:";
export const languageStoragePrefix = "git-review:language:v1:";
const maxRecent = 8;
const maxOpenCards = 100;

export type CodeTypography = { version: 1; fontSize: number; fontFamily: CodeFontFamily };
export const defaultCodeTypography: CodeTypography = { version: 1, fontSize: 12, fontFamily: "system" };

export function validateCodeTypography(value: unknown): CodeTypography | null {
  if (!isRecord(value) || value["version"] !== 1) return null;
  const fontSize = value["fontSize"];
  const fontFamily = value["fontFamily"];
  if (typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 11 || fontSize > 20) return null;
  if (!isCodeFontFamily(fontFamily)) return null;
  return { version: 1, fontSize, fontFamily };
}

export function readCodeTypography(): CodeTypography {
  try {
    const raw = localStorage.getItem(codeTypographyStorageKey);
    return raw === null ? defaultCodeTypography : validateCodeTypography(JSON.parse(raw) as unknown) ?? defaultCodeTypography;
  } catch {
    return defaultCodeTypography;
  }
}

export function saveCodeTypography(value: CodeTypography): void {
  try {
    localStorage.setItem(codeTypographyStorageKey, JSON.stringify(value));
  } catch {
    // The selected typography remains usable in memory when storage is unavailable.
  }
}

export type SavedWorkspace = {
  version: 3;
  rootPath: string;
  recentPaths: string[];
};

export function emptyWorkspace(rootPath: string): SavedWorkspace {
  return { version: 3, rootPath, recentPaths: [] };
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && !value.includes("\0");
}

export function validateSavedWorkspace(value: unknown, rootPath: string): SavedWorkspace | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== 3) return null;
  if (value["rootPath"] !== rootPath) return null;
  const recentPaths = value["recentPaths"];
  if (!Array.isArray(recentPaths) || !recentPaths.every(validPath)) return null;
  return {
    version: 3,
    rootPath,
    recentPaths: [...new Set(recentPaths)].slice(0, maxRecent),
  };
}

export function parseSavedWorkspace(value: unknown, rootPath: string): SavedWorkspace {
  return validateSavedWorkspace(value, rootPath) ?? emptyWorkspace(rootPath);
}

export function parseActiveProject(value: unknown, rootPath: string): string | null {
  if (!isRecord(value) || value["version"] !== 1 || value["rootPath"] !== rootPath) return null;
  return validPath(value["activePath"]) ? value["activePath"] : null;
}

export function parseLegacyWorkspace(value: unknown, rootPath: string): { activePath: string | null; recentPaths: string[] } | null {
  if (!isRecord(value) || value["version"] !== 2 || value["rootPath"] !== rootPath) return null;
  const activePath = value["activePath"];
  const recentPaths = value["recentPaths"];
  if (!(activePath === null || validPath(activePath))) return null;
  if (!Array.isArray(recentPaths) || !recentPaths.every(validPath)) return null;
  return { activePath, recentPaths: [...new Set(recentPaths)].slice(0, maxRecent) };
}

export function readSavedWorkspace(rootPath: string): SavedWorkspace {
  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    if (raw !== null) return parseSavedWorkspace(JSON.parse(raw) as unknown, rootPath);
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw === null) return emptyWorkspace(rootPath);
    const legacy = parseLegacyWorkspace(JSON.parse(legacyRaw) as unknown, rootPath);
    if (legacy === null) return emptyWorkspace(rootPath);
    const migrated: SavedWorkspace = { version: 3, rootPath, recentPaths: legacy.recentPaths };
    localStorage.setItem(workspaceStorageKey, JSON.stringify(migrated));
    if (legacy.activePath !== null && readActiveProject(rootPath) === null) saveActiveProject(rootPath, legacy.activePath);
    localStorage.removeItem(legacyKey);
    return migrated;
  } catch {
    return emptyWorkspace(rootPath);
  }
}

export function readActiveProject(rootPath: string): string | null {
  try {
    const raw = sessionStorage.getItem(activeProjectKey);
    return raw === null ? null : parseActiveProject(JSON.parse(raw) as unknown, rootPath);
  } catch {
    return null;
  }
}

export function saveActiveProject(rootPath: string, activePath: string | null): void {
  try {
    if (activePath === null) sessionStorage.removeItem(activeProjectKey);
    else if (validPath(activePath)) sessionStorage.setItem(activeProjectKey, JSON.stringify({ version: 1, rootPath, activePath }));
  } catch {
    // Selection remains usable in memory when session storage is unavailable.
  }
}

export function saveWorkspace(value: SavedWorkspace): void {
  try {
    localStorage.setItem(workspaceStorageKey, JSON.stringify(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function withSelectedPath(current: SavedWorkspace, path: string): SavedWorkspace {
  return {
    version: 3,
    rootPath: current.rootPath,
    recentPaths: [path, ...current.recentPaths.filter((previous) => previous !== path)].slice(0, maxRecent),
  };
}

export function parseWrapPreference(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

export function readWrapPreference(): boolean {
  try {
    const raw = localStorage.getItem(wrapStorageKey);
    return raw === null ? true : parseWrapPreference(JSON.parse(raw) as unknown);
  } catch {
    return true;
  }
}

export function saveWrapPreference(value: boolean): void {
  try {
    localStorage.setItem(wrapStorageKey, JSON.stringify(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function validateOpenCards(value: unknown): string[] | null {
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["keys"]) || value["keys"].length > maxOpenCards) return null;
  const keys: unknown[] = value["keys"];
  const parsed: string[] = [];
  for (const item of keys) {
    if (typeof item !== "string" || item.length === 0 || item.length > 4096 || item.includes("\0")) return null;
    parsed.push(item);
  }
  return [...new Set(parsed)];
}

export function parseOpenCards(value: unknown): string[] {
  return validateOpenCards(value) ?? [];
}

export function readOpenCards(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${openCardsStoragePrefix}${projectId}`);
    return new Set(raw === null ? [] : parseOpenCards(JSON.parse(raw) as unknown));
  } catch {
    return new Set();
  }
}

export function saveOpenCards(projectId: string, keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(`${openCardsStoragePrefix}${projectId}`, JSON.stringify({ version: 1, keys: [...keys].slice(0, maxOpenCards) }));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function readLanguageOverride(projectId: string, path: string): string | null {
  try {
    const value = localStorage.getItem(`${languageStoragePrefix}${projectId}:${encodeURIComponent(path)}`);
    return value !== null && isLanguageOverride(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLanguageOverride(projectId: string, path: string, language: string | null): void {
  try {
    const storageKey = `${languageStoragePrefix}${projectId}:${encodeURIComponent(path)}`;
    if (language === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, language);
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function isLanguageOverride(value: unknown): value is string {
  return typeof value === "string" && (value === "text" || /^[a-z0-9][a-z0-9-]{0,79}$/.test(value));
}
