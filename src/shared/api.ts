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

export type DiffLine = {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  noNewlineAtEnd: boolean;
};

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffResult =
  | { kind: "text"; hunks: DiffHunk[] }
  | { kind: "binary"; reason: "binary" | "symlink" | "submodule" }
  | { kind: "too_large" }
  | { kind: "conflict" }
  | { kind: "stale" };

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
  const id = expectString(project["id"], "project.id");
  if (!/^[0-9a-f]{20}$/.test(id)) throw new Error("Expected a valid project ID");
  return {
    id,
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

export function parseDiffResponse(value: unknown): DiffResult {
  const outer = expectRecord(value, "diff response");
  switch (outer["kind"]) {
    case "stale": return { kind: "stale" };
    case "too_large": return { kind: "too_large" };
    case "conflict": return { kind: "conflict" };
    case "binary": {
      const reason = outer["reason"];
      if (reason !== "binary" && reason !== "symlink" && reason !== "submodule") throw new Error("Expected a binary file reason");
      return { kind: "binary", reason };
    }
    case "text": {
      const rawHunks = outer["hunks"];
      if (!Array.isArray(rawHunks) || rawHunks.length > 2000) throw new Error("Expected bounded diff hunks");
      let totalLines = 0;
      const hunks: DiffHunk[] = rawHunks.map((rawHunk: unknown) => {
        const hunk = expectRecord(rawHunk, "diff hunk");
        const rawLines = hunk["lines"];
        if (!Array.isArray(rawLines) || rawLines.length > 20_000) throw new Error("Expected bounded diff lines");
        totalLines += rawLines.length;
        if (totalLines > 20_000) throw new Error("Expected bounded diff lines");
        const lines: DiffLine[] = rawLines.map((rawLine: unknown) => {
          const line = expectRecord(rawLine, "diff line");
          const kind = line["kind"];
          if (kind !== "context" && kind !== "added" && kind !== "removed") throw new Error("Expected a diff line kind");
          const oldLine = line["oldLine"] === null ? null : expectNonNegativeInteger(line["oldLine"], "old line number");
          const newLine = line["newLine"] === null ? null : expectNonNegativeInteger(line["newLine"], "new line number");
          if (oldLine === 0 || newLine === 0) throw new Error("Expected positive diff line numbers");
          if ((kind === "added" && (oldLine !== null || newLine === null)) ||
              (kind === "removed" && (newLine !== null || oldLine === null)) ||
              (kind === "context" && (oldLine === null || newLine === null))) {
            throw new Error("Expected line numbers matching the diff line kind");
          }
          if (typeof line["noNewlineAtEnd"] !== "boolean") throw new Error("Expected a newline marker");
          return {
            kind,
            oldLine,
            newLine,
            text: expectString(line["text"], "diff line text"),
            noNewlineAtEnd: line["noNewlineAtEnd"],
          };
        });
        const oldStart = expectNonNegativeInteger(hunk["oldStart"], "old hunk start");
        const oldCount = expectNonNegativeInteger(hunk["oldCount"], "old hunk count");
        const newStart = expectNonNegativeInteger(hunk["newStart"], "new hunk start");
        const newCount = expectNonNegativeInteger(hunk["newCount"], "new hunk count");
        if (lines.filter((line) => line.kind !== "added").length !== oldCount ||
            lines.filter((line) => line.kind !== "removed").length !== newCount) {
          throw new Error("Diff hunk counts do not match its lines");
        }
        return {
          oldStart,
          oldCount,
          newStart,
          newCount,
          lines,
        };
      });
      return { kind: "text", hunks };
    }
    default: throw new Error("Expected a diff response kind");
  }
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
import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";
