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
