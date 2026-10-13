import { isRecord } from "@git-review/shared/validation";
import { isCodeFontFamily, type CodeFontFamily } from "./code-fonts.ts";
import { isNavigationPath } from "./navigation-path.ts";

export const workspaceStorageKey = "git-review:workspace:v4";
const activeProjectKey = "git-review:active-project:v2";
export const wrapStorageKey = "git-review:wrap:v1";
export const codeTypographyStorageKey = "git-review:code-typography:v1";
export const appearanceStorageKey = "git-review:appearance:v1";
export const openCardsStoragePrefix = "git-review:open-cards:v2:";
export const languageStoragePrefix = "git-review:language:v2:";
const maxRecent = 8;
const maxOpenCards = 100;

export type CodeTypography = { version: 1; fontSize: number; fontFamily: CodeFontFamily };
export const defaultCodeTypography: CodeTypography = {
  version: 1,
  fontSize: 12,
  fontFamily: "system",
};
export type Appearance = {
  version: 1;
  appTheme: "light" | "dark" | "system";
  codeTheme: "match" | "light" | "dark";
};
export const defaultAppearance: Appearance = { version: 1, appTheme: "light", codeTheme: "match" };

export function resolveAppearance(
  value: Appearance,
  systemDark: boolean,
): { appTheme: "light" | "dark"; codeTheme: "light" | "dark" } {
  const appTheme = value.appTheme === "system" ? (systemDark ? "dark" : "light") : value.appTheme;
  return { appTheme, codeTheme: value.codeTheme === "match" ? appTheme : value.codeTheme };
}

export function validateAppearance(value: unknown): Appearance | null {
  if (!isRecord(value) || value["version"] !== 1) return null;
  const appTheme = value["appTheme"];
  const codeTheme = value["codeTheme"];
  if (appTheme !== "light" && appTheme !== "dark" && appTheme !== "system") return null;
  if (codeTheme !== "match" && codeTheme !== "light" && codeTheme !== "dark") return null;
  return { version: 1, appTheme, codeTheme };
}

export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(appearanceStorageKey);
    return raw === null
      ? defaultAppearance
      : (validateAppearance(JSON.parse(raw) as unknown) ?? defaultAppearance);
  } catch {
    return defaultAppearance;
  }
}

export function saveAppearance(value: Appearance): void {
  try {
    localStorage.setItem(appearanceStorageKey, JSON.stringify(value));
  } catch {
    // The selected appearance remains usable in memory when storage is unavailable.
  }
}

export function validateCodeTypography(value: unknown): CodeTypography | null {
  if (!isRecord(value) || value["version"] !== 1) return null;
  const fontSize = value["fontSize"];
  const fontFamily = value["fontFamily"];
  if (typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 11 || fontSize > 20)
    return null;
  if (!isCodeFontFamily(fontFamily)) return null;
  return { version: 1, fontSize, fontFamily };
}

export function readCodeTypography(): CodeTypography {
  try {
    const raw = localStorage.getItem(codeTypographyStorageKey);
    return raw === null
      ? defaultCodeTypography
      : (validateCodeTypography(JSON.parse(raw) as unknown) ?? defaultCodeTypography);
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
  version: 4;
  rootPath: string;
  recentPaths: string[];
};

export function emptyWorkspace(rootPath: string): SavedWorkspace {
  return { version: 4, rootPath, recentPaths: [] };
}

export function validateSavedWorkspace(value: unknown, rootPath: string): SavedWorkspace | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== 4) return null;
  if (value["rootPath"] !== rootPath) return null;
  const recentPaths = value["recentPaths"];
  if (
    !Array.isArray(recentPaths) ||
    !recentPaths.every((path: unknown) => isNavigationPath(path, true))
  )
    return null;
  return {
    version: 4,
    rootPath,
    recentPaths: [...new Set(recentPaths)].slice(0, maxRecent),
  };
}

export function parseSavedWorkspace(value: unknown, rootPath: string): SavedWorkspace {
  return validateSavedWorkspace(value, rootPath) ?? emptyWorkspace(rootPath);
}

export function parseActiveProject(value: unknown, rootPath: string): string | null {
  if (!isRecord(value) || value["version"] !== 2 || value["rootPath"] !== rootPath) return null;
  return isNavigationPath(value["activePath"], true) ? value["activePath"] : null;
}

/** Explicitly retired project data; no values are read or migrated. */
export function discardObsoleteProjectData(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key !== null &&
        (key === "git-review:workspace:v2" ||
          key === "git-review:workspace:v3" ||
          ["git-review:comments:v1:", "git-review:open-cards:v1:", "git-review:language:v1:"].some(
            (prefix) => key.startsWith(prefix),
          ))
      )
        keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    sessionStorage.removeItem("git-review:active-project:v1");
  } catch {
    // Storage denial leaves the new in-memory session usable.
  }
}

export function readSavedWorkspace(rootPath: string): SavedWorkspace {
  discardObsoleteProjectData();
  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    return raw === null
      ? emptyWorkspace(rootPath)
      : parseSavedWorkspace(JSON.parse(raw) as unknown, rootPath);
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
    else if (isNavigationPath(activePath, true))
      sessionStorage.setItem(
        activeProjectKey,
        JSON.stringify({ version: 2, rootPath, activePath }),
      );
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
    version: 4,
    rootPath: current.rootPath,
    recentPaths: [path, ...current.recentPaths.filter((previous) => previous !== path)].slice(
      0,
      maxRecent,
    ),
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
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !Array.isArray(value["keys"]) ||
    value["keys"].length > maxOpenCards
  )
    return null;
  const keys: unknown[] = value["keys"];
  const parsed: string[] = [];
  for (const item of keys) {
    if (typeof item !== "string" || item.length === 0 || item.length > 4096 || item.includes("\0"))
      return null;
    parsed.push(item);
  }
  return [...new Set(parsed)];
}

export function parseOpenCards(value: unknown): string[] {
  return validateOpenCards(value) ?? [];
}

export function readOpenCards(projectPath: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${openCardsStoragePrefix}${encodeURIComponent(projectPath)}`);
    return new Set(raw === null ? [] : parseOpenCards(JSON.parse(raw) as unknown));
  } catch {
    return new Set();
  }
}

export function saveOpenCards(projectPath: string, keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(
      `${openCardsStoragePrefix}${encodeURIComponent(projectPath)}`,
      JSON.stringify({ version: 1, keys: [...keys].slice(0, maxOpenCards) }),
    );
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function readLanguageOverride(projectPath: string, path: string): string | null {
  try {
    const value = localStorage.getItem(
      `${languageStoragePrefix}${encodeURIComponent(projectPath)}:${encodeURIComponent(path)}`,
    );
    return value !== null && isLanguageOverride(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLanguageOverride(
  projectPath: string,
  path: string,
  language: string | null,
): void {
  try {
    const storageKey = `${languageStoragePrefix}${encodeURIComponent(projectPath)}:${encodeURIComponent(path)}`;
    if (language === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, language);
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function isLanguageOverride(value: unknown): value is string {
  return typeof value === "string" && (value === "text" || /^[a-z0-9][a-z0-9-]{0,79}$/.test(value));
}
