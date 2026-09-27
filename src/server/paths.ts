import { createHash } from "node:crypto";
import { realpath, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { DirectoryListing, Project, RootInfo, ApiErrorCode } from "../shared/api.ts";
import { hasErrorCode } from "../shared/validation.ts";

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ApprovedRoot = {
  realPath: string;
  info: RootInfo;
};

export async function approveRoot(input: string): Promise<ApprovedRoot> {
  const realPath = await realpath(resolve(input));
  const metadata = await stat(realPath);
  if (!metadata.isDirectory()) throw new Error("The approved root must be a directory");
  return {
    realPath,
    info: { label: basename(realPath) || realPath, path: realPath },
  };
}

export function validateRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) {
    throw new AppError("invalid_request", 400, "Invalid folder path");
  }
  if (value === "") return value;
  if (isAbsolute(value) || value.includes("\\")) {
    throw new AppError("invalid_request", 400, "Folder path must be relative to the approved root");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new AppError("invalid_request", 400, "Folder path contains an invalid segment");
  }
  return value;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

export async function resolveDirectory(root: ApprovedRoot, rawPath: unknown): Promise<{ realPath: string; path: string }> {
  const path = validateRelativePath(rawPath);
  let realPath: string;
  try {
    realPath = await realpath(resolve(root.realPath, path));
    const metadata = await stat(realPath);
    if (!metadata.isDirectory()) throw new AppError("not_found", 404, "Folder was not found");
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) {
      throw new AppError("not_found", 404, "Folder was not found");
    }
    throw error;
  }
  if (!isWithinRoot(root.realPath, realPath)) {
    throw new AppError("forbidden", 403, "Folder is outside the approved root");
  }
  const canonicalPath = relative(root.realPath, realPath).split(sep).join("/");
  return { realPath, path: canonicalPath };
}

export async function listDirectory(root: ApprovedRoot, rawPath: unknown): Promise<DirectoryListing> {
  const directory = await resolveDirectory(root, rawPath);
  const entries = (await readdir(directory.realPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: directory.path === "" ? entry.name : `${directory.path}/${entry.name}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const lastSlash = directory.path.lastIndexOf("/");
  const parentPath = directory.path === "" ? null : lastSlash === -1 ? "" : directory.path.slice(0, lastSlash);
  return { path: directory.path, parentPath, entries };
}

export async function openProject(root: ApprovedRoot, rawPath: unknown): Promise<Project> {
  const directory = await resolveDirectory(root, rawPath);
  return {
    id: createHash("sha256").update(directory.realPath).digest("hex").slice(0, 20),
    name: basename(directory.realPath) || directory.realPath,
    path: directory.path,
    absolutePath: directory.realPath,
  };
}
