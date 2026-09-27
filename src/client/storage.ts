const key = "git-review:workspace:v2";
const maxRecent = 8;

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
import { isRecord } from "../shared/validation.ts";
