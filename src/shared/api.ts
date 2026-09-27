export type RootInfo = {
  label: string;
  path: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type DirectoryListing = {
  path: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
};

export type Project = {
  id: string;
  name: string;
  path: string;
  absolutePath: string;
};

export type ChangeLayer = "staged" | "unstaged" | "untracked" | "conflict";
export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "conflicted";

export type ChangeEntry = {
  layer: ChangeLayer;
  kind: ChangeKind;
  path: string;
  oldPath: string | null;
  isSubmodule: boolean;
};

export type ProjectStatus =
  | { kind: "not_git" }
  | { kind: "git"; revision: string; entries: ChangeEntry[] };

export type ApiErrorCode = "invalid_request" | "forbidden" | "not_found" | "internal_error";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
};

export function parseRootResponse(value: unknown): RootInfo {
  const outer = expectRecord(value, "server response");
  const root = expectRecord(outer["root"], "root");
  return {
    label: expectString(root["label"], "root.label"),
    path: expectString(root["path"], "root.path"),
  };
}

export function parseDirectoryResponse(value: unknown): DirectoryListing {
  const outer = expectRecord(value, "server response");
  const path = expectString(outer["path"], "path");
  const parent = outer["parentPath"];
  if (parent !== null && typeof parent !== "string") {
    throw new Error("Expected parentPath to be a string or null");
  }
  const rawEntries = outer["entries"];
  if (!Array.isArray(rawEntries)) throw new Error("Expected entries to be an array");
  const entries: DirectoryEntry[] = rawEntries.map((rawEntry: unknown) => {
    const entry = expectRecord(rawEntry, "directory entry");
    return {
      name: expectString(entry["name"], "entry.name"),
      path: expectString(entry["path"], "entry.path"),
    };
  });
  return { path, parentPath: parent, entries };
}

export function parseProjectResponse(value: unknown): Project {
  const outer = expectRecord(value, "server response");
  const project = expectRecord(outer["project"], "project");
  return {
    id: expectString(project["id"], "project.id"),
    name: expectString(project["name"], "project.name"),
    path: expectString(project["path"], "project.path"),
    absolutePath: expectString(project["absolutePath"], "project.absolutePath"),
  };
}

export function parseStatusResponse(value: unknown): ProjectStatus {
  const outer = expectRecord(value, "server response");
  if (outer["kind"] === "not_git") return { kind: "not_git" };
  if (outer["kind"] !== "git") throw new Error("Expected a Git status response");
  const revision = expectString(outer["revision"], "revision");
  if (!/^[0-9a-f]{20}$/.test(revision)) throw new Error("Expected a valid status revision");
  const rawEntries = outer["entries"];
  if (!Array.isArray(rawEntries)) throw new Error("Expected status entries to be an array");
  const entries: ChangeEntry[] = rawEntries.map((raw: unknown) => {
    const entry = expectRecord(raw, "status entry");
    const layer = entry["layer"];
    const kind = entry["kind"];
    const oldPath = entry["oldPath"];
    if (layer !== "staged" && layer !== "unstaged" && layer !== "untracked" && layer !== "conflict") {
      throw new Error("Expected a valid change layer");
    }
    if (kind !== "added" && kind !== "modified" && kind !== "deleted" && kind !== "renamed" && kind !== "copied" && kind !== "type_changed" && kind !== "conflicted") {
      throw new Error("Expected a valid change kind");
    }
    if (oldPath !== null && typeof oldPath !== "string") throw new Error("Expected an old path or null");
    if (typeof entry["isSubmodule"] !== "boolean") throw new Error("Expected a submodule flag");
    const path = expectString(entry["path"], "entry.path");
    if (path.length === 0 || (oldPath !== null && oldPath.length === 0)) throw new Error("Expected a nonempty change path");
    if ((layer === "conflict") !== (kind === "conflicted")) throw new Error("Expected a matching conflict state");
    if (layer === "untracked" && kind !== "added") throw new Error("Expected an added untracked file");
    return {
      layer,
      kind,
      path,
      oldPath,
      isSubmodule: entry["isSubmodule"],
    };
  });
  return { kind: "git", revision, entries };
}

export function parseApiError(value: unknown): ApiError | null {
  try {
    const outer = expectRecord(value, "server response");
    const error = expectRecord(outer["error"], "error");
    const code = error["code"];
    const message = error["message"];
    if (
      (code === "invalid_request" || code === "forbidden" || code === "not_found" || code === "internal_error") &&
      typeof message === "string"
    ) {
      return { code, message };
    }
  } catch {
    return null;
  }
  return null;
}
import { expectRecord, expectString } from "./validation.ts";
