import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { Project } from "@git-review/shared/api";
import { hasErrorCode } from "@git-review/shared/validation";
import { AppError, isWithinRoot, type ApprovedRoot } from "./paths.ts";

type ProjectPath = {
  path: string;
  absolutePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  metadata: Stats;
};

type PathSnapshot = ProjectPath & { components: Stats[] };
type CheckedWorkingFile = { path: string; file: FileHandle; metadata: Stats };

export function validateProjectFilePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\0") ||
    isAbsolute(value) ||
    (sep === "\\" && value.includes("\\")) ||
    (value !== "" &&
      value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
  ) {
    throw new AppError("invalid_request", 400, "Invalid project-relative path");
  }
  if (value.split("/").includes(".git"))
    throw new AppError("forbidden", 403, "Git control files are not browsable");
  return value;
}

export function projectFileAccessError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR"))
    throw new AppError("not_found", 404, "File or folder was not found. Refresh the listing.");
  if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM"))
    throw new AppError("forbidden", 403, "The file or folder cannot be read");
  if (hasErrorCode(error, "ELOOP"))
    throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
  throw error;
}

function kind(metadata: Stats): ProjectPath["kind"] {
  return metadata.isDirectory()
    ? "directory"
    : metadata.isFile()
      ? "file"
      : metadata.isSymbolicLink()
        ? "symlink"
        : "other";
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function changedFile(): AppError {
  return new AppError("not_found", 409, "This file changed. Refresh its preview.");
}

async function inspectPath(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<PathSnapshot> {
  const path = validateProjectFilePath(rawPath);
  const segments = path === "" ? [] : path.split("/");
  let candidate = project.absolutePath;
  try {
    if (!isWithinRoot(root.realPath, candidate))
      throw new AppError("forbidden", 403, "Path is outside the approved root");
    const projectMetadata = await lstat(candidate);
    if (projectMetadata.isSymbolicLink())
      throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
    if (!projectMetadata.isDirectory())
      throw new AppError("not_found", 404, "Folder was not found");
    const projectRealPath = await realpath(candidate);
    if (
      !isWithinRoot(root.realPath, projectRealPath) ||
      !isWithinRoot(project.absolutePath, projectRealPath)
    )
      throw new AppError("forbidden", 403, "Path is outside the selected project");
    const components = [projectMetadata];
    let metadata = projectMetadata;
    for (const [index, segment] of segments.entries()) {
      candidate = resolve(candidate, segment);
      metadata = await lstat(candidate);
      components.push(metadata);
      if (index < segments.length - 1) {
        if (metadata.isSymbolicLink())
          throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
        if (!metadata.isDirectory()) throw new AppError("not_found", 404, "Folder was not found");
      }
    }
    // The project is canonical and every relative component has been inspected without
    // following links. Keep the literal path for O_NOFOLLOW: Bun's realpath rejects
    // backslash filenames and can wait on FIFOs, including a replaced regular file.
    const absolutePath = candidate;
    if (
      !isWithinRoot(root.realPath, absolutePath) ||
      !isWithinRoot(project.absolutePath, absolutePath)
    )
      throw new AppError("forbidden", 403, "Path is outside the selected project");
    return { path, absolutePath, kind: kind(metadata), metadata, components };
  } catch (error: unknown) {
    return projectFileAccessError(error);
  }
}

export async function checkedProjectPath(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<ProjectPath> {
  const { components: _components, ...location } = await inspectPath(root, project, rawPath);
  return location;
}

async function recheckFile(
  root: ApprovedRoot,
  project: Project,
  location: PathSnapshot,
  file: FileHandle,
): Promise<Stats> {
  const metadata = await file.stat();
  const current = await inspectPath(root, project, location.path);
  if (
    !metadata.isFile() ||
    current.kind !== "file" ||
    !sameIdentity(location.metadata, metadata) ||
    !sameIdentity(current.metadata, metadata) ||
    current.components.length !== location.components.length ||
    current.components.some((component, index) => {
      const previous = location.components[index];
      return previous === undefined || !sameIdentity(previous, component);
    })
  )
    throw changedFile();
  return metadata;
}

async function openFile(root: ApprovedRoot, project: Project, rawPath: unknown) {
  const location = await inspectPath(root, project, rawPath);
  if (location.path === "" || location.kind !== "file")
    throw new AppError("not_found", 404, "File was not found");
  let file: FileHandle;
  try {
    file = await open(
      location.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error: unknown) {
    if (hasErrorCode(error, "ELOOP")) throw changedFile();
    return projectFileAccessError(error);
  }
  try {
    const metadata = await recheckFile(root, project, location, file);
    return { location, opened: { path: location.path, file, metadata } };
  } catch (error: unknown) {
    await file.close();
    return projectFileAccessError(error);
  }
}

/** Transfers the checked descriptor to a streaming caller, which must close it. */
export async function openCheckedWorkingFile(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<CheckedWorkingFile> {
  return (await openFile(root, project, rawPath)).opened;
}

/** Bounded readers keep descriptor cleanup and post-read identity checking in this owner. */
export async function withCheckedWorkingFile<T>(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  read: (opened: CheckedWorkingFile) => Promise<T>,
): Promise<T> {
  const { location, opened } = await openFile(root, project, rawPath);
  try {
    const result = await read(opened);
    await recheckFile(root, project, location, opened.file);
    return result;
  } catch (error: unknown) {
    return projectFileAccessError(error);
  } finally {
    await opened.file.close();
  }
}
