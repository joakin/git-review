const key = "git-review:workspace:v2";
const wrapKey = "git-review:wrap:v1";
const openCardsKey = "git-review:open-cards:v1:";
const maxRecent = 8;
const maxOpenCards = 100;

export type SavedWorkspace = {
  version: 2;
  rootPath: string;
  activePath: string | null;
  recentPaths: string[];
};

export function emptyWorkspace(rootPath: string): SavedWorkspace {
  return { version: 2, rootPath, activePath: null, recentPaths: [] };
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && !value.includes("\0");
}

export function parseSavedWorkspace(value: unknown, rootPath: string): SavedWorkspace {
  const empty = emptyWorkspace(rootPath);
  if (!isRecord(value)) return empty;
  if (value["version"] !== 2) return empty;
  if (value["rootPath"] !== rootPath) return empty;
  const activePath = value["activePath"];
  if (!(activePath === null || validPath(activePath))) return empty;
  const recentPaths = value["recentPaths"];
  if (!Array.isArray(recentPaths) || !recentPaths.every(validPath)) return empty;
  return {
    version: 2,
    rootPath,
    activePath,
    recentPaths: [...new Set(recentPaths)].slice(0, maxRecent),
  };
}

export function readSavedWorkspace(rootPath: string): SavedWorkspace {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? emptyWorkspace(rootPath) : parseSavedWorkspace(JSON.parse(raw) as unknown, rootPath);
  } catch {
    return emptyWorkspace(rootPath);
  }
}

export function saveWorkspace(value: SavedWorkspace): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function withSelectedPath(current: SavedWorkspace, path: string): SavedWorkspace {
  return {
    version: 2,
    rootPath: current.rootPath,
    activePath: path,
    recentPaths: [path, ...current.recentPaths.filter((previous) => previous !== path)].slice(0, maxRecent),
  };
}

export function parseWrapPreference(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

export function readWrapPreference(): boolean {
  try {
    const raw = localStorage.getItem(wrapKey);
    return raw === null ? true : parseWrapPreference(JSON.parse(raw) as unknown);
  } catch {
    return true;
  }
}

export function saveWrapPreference(value: boolean): void {
  try {
    localStorage.setItem(wrapKey, JSON.stringify(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

export function parseOpenCards(value: unknown): string[] {
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["keys"])) return [];
  const keys: unknown[] = value["keys"];
  const parsed: string[] = [];
  for (const item of keys) {
    if (typeof item !== "string" || item.length === 0 || item.length > 4096 || item.includes("\0")) return [];
    parsed.push(item);
  }
  return [...new Set(parsed)].slice(0, maxOpenCards);
}

export function readOpenCards(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${openCardsKey}${projectId}`);
    return new Set(raw === null ? [] : parseOpenCards(JSON.parse(raw) as unknown));
  } catch {
    return new Set();
  }
}

export function saveOpenCards(projectId: string, keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(`${openCardsKey}${projectId}`, JSON.stringify({ version: 1, keys: [...keys].slice(0, maxOpenCards) }));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}
import { isRecord } from "../shared/validation.ts";
