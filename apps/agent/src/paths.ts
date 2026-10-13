import { realpath, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { DirectoryListing, Project, RootInfo, ApiErrorCode } from "@git-review/shared/api";
import { hasErrorCode } from "@git-review/shared/validation";
import { isProjectPath } from "@git-review/shared/project-path";

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

/** Resolve each request independently; selection alone may canonicalize an allowed alias. */
export async function resolveProject(
  root: ApprovedRoot,
  rawPath: unknown,
  canonicalOnly = true,
): Promise<Project> {
  if (!isProjectPath(rawPath))
    throw new AppError("invalid_request", 400, "Specify a canonical absolute project path");
  if (!isWithinRoot(root.realPath, rawPath))
    throw new AppError("forbidden", 403, "Project is outside the approved root");
  let absolutePath: string;
  try {
    absolutePath = await realpath(rawPath);
    if (!isWithinRoot(root.realPath, absolutePath))
      throw new AppError("forbidden", 403, "Project is outside the approved root");
    if (!(await stat(absolutePath)).isDirectory())
      throw new AppError("project_not_found", 404, "Project folder was not found");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR"))
      throw new AppError("project_not_found", 404, "Project folder was not found");
    if (
      hasErrorCode(error, "EACCES") ||
      hasErrorCode(error, "EPERM") ||
      hasErrorCode(error, "ELOOP")
    )
      throw new AppError("forbidden", 403, "Project folder cannot be accessed");
    throw error;
  }
  if (canonicalOnly && absolutePath !== rawPath)
    throw new AppError(
      "project_changed",
      409,
      "Project folder location has changed. Choose it again.",
    );
  return {
    name: basename(absolutePath) || absolutePath,
    relativePath: relative(root.realPath, absolutePath).split(sep).join("/"),
    absolutePath,
  };
}

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

export function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

export async function resolveDirectory(
  root: ApprovedRoot,
  rawPath: unknown,
): Promise<{ realPath: string; path: string }> {
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

export async function listDirectory(
  root: ApprovedRoot,
  rawPath: unknown,
): Promise<DirectoryListing> {
  const directory = await resolveDirectory(root, rawPath);
  const entries = (await readdir(directory.realPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: directory.path === "" ? entry.name : `${directory.path}/${entry.name}`,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  const lastSlash = directory.path.lastIndexOf("/");
  const parentPath =
    directory.path === "" ? null : lastSlash === -1 ? "" : directory.path.slice(0, lastSlash);
  return { path: directory.path, parentPath, entries };
}
