import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type {
  FileReadResult,
  FileTree,
  FileTreeEntry,
  Project,
  SyntaxState,
  SyntaxToken,
} from "../shared/api.ts";
import { hasErrorCode } from "../shared/validation.ts";
import { AppError, isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { detectLanguage, highlightSource } from "./syntax.ts";
import {
  fileImageResource,
  imageMimeType,
  maxImageBytes,
  validImageHeader,
  workingVersion,
} from "./image-types.ts";
import {
  audioVideoType,
  fileAudioVideoResource,
  maxAudioVideoBytes,
  validAudioVideoHeader,
} from "./audio-video-types.ts";

const maxEntries = 1000;
const maxTextBytes = 1024 * 1024;
const maxLines = 20_000;

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

function accessError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR"))
    throw new AppError("not_found", 404, "File or folder was not found. Refresh the listing.");
  if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM"))
    throw new AppError("forbidden", 403, "The file or folder cannot be read");
  if (hasErrorCode(error, "ELOOP"))
    throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
  throw error;
}

async function checkedPath(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<{
  path: string;
  absolutePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  size: number;
}> {
  const path = validateProjectFilePath(rawPath);
  const segments = path === "" ? [] : path.split("/");
  let candidate = project.absolutePath;
  try {
    for (const [index, segment] of segments.entries()) {
      candidate = resolve(candidate, segment);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) {
        if (index === segments.length - 1)
          return { path, absolutePath: candidate, kind: "symlink", size: metadata.size };
        throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
      }
      if (index < segments.length - 1 && !metadata.isDirectory())
        throw new AppError("not_found", 404, "Folder was not found");
    }
    // Bun's realpath currently rejects literal backslashes in macOS filenames.
    const absolutePath = path.includes("\\") ? candidate : await realpath(candidate);
    if (
      !isWithinRoot(root.realPath, absolutePath) ||
      !isWithinRoot(project.absolutePath, absolutePath)
    ) {
      throw new AppError("forbidden", 403, "Path is outside the selected project");
    }
    const metadata = await lstat(absolutePath);
    return {
      path,
      absolutePath,
      kind: metadata.isDirectory()
        ? "directory"
        : metadata.isFile()
          ? "file"
          : metadata.isSymbolicLink()
            ? "symlink"
            : "other",
      size: metadata.size,
    };
  } catch (error: unknown) {
    return accessError(error);
  }
}

export async function readProjectTree(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<FileTree> {
  const location = await checkedPath(root, project, rawPath);
  if (location.kind !== "directory") throw new AppError("not_found", 404, "Folder was not found");
  const entries: FileTreeEntry[] = [];
  try {
    const directory = await opendir(location.absolutePath);
    for await (const entry of directory) {
      if (entry.name === ".git") continue;
      if (entries.length === maxEntries)
        throw new AppError("invalid_request", 413, "This folder has too many entries to browse");
      entries.push({
        name: entry.name,
        path: location.path === "" ? entry.name : `${location.path}/${entry.name}`,
        kind: entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : entry.isSymbolicLink()
              ? "symlink"
              : "other",
      });
    }
  } catch (error: unknown) {
    accessError(error);
  }
  entries.sort((left, right) => {
    if (left.kind === "directory" && right.kind !== "directory") return -1;
    if (right.kind === "directory" && left.kind !== "directory") return 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  const lastSlash = location.path.lastIndexOf("/");
  const parentPath =
    location.path === "" ? null : lastSlash === -1 ? "" : location.path.slice(0, lastSlash);
  return { path: location.path, parentPath, entries };
}

type WorkingImage =
  | {
      kind: "ready";
      version: string;
      resource: Extract<FileReadResult, { kind: "media" }>["resource"];
    }
  | { kind: "too_large" | "unsupported"; byteLength: number };

export async function openCheckedMedia(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<{ file: FileHandle; path: string; metadata: Stats }> {
  const location = await checkedPath(root, project, rawPath);
  if (location.path === "" || location.kind !== "file")
    throw new AppError("not_found", 404, "Previewable media file was not found");
  let file: FileHandle;
  try {
    file = await open(
      location.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error: unknown) {
    return accessError(error);
  }
  try {
    const metadata = await file.stat();
    const currentRealPath = await realpath(location.absolutePath);
    const current = await stat(currentRealPath);
    if (
      !metadata.isFile() ||
      !isWithinRoot(root.realPath, currentRealPath) ||
      !isWithinRoot(project.absolutePath, currentRealPath) ||
      metadata.dev !== current.dev ||
      metadata.ino !== current.ino
    ) {
      throw new AppError("forbidden", 403, "Image is no longer inside the selected project");
    }
    return { file, path: location.path, metadata };
  } catch (error: unknown) {
    await file.close();
    return accessError(error);
  }
}

export async function inspectWorkingImage(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<WorkingImage> {
  const opened = await openCheckedMedia(root, project, rawPath);
  try {
    const { metadata, file, path } = opened;
    const mimeType = imageMimeType(path);
    if (mimeType === null) throw new AppError("not_found", 404, "Previewable image was not found");
    if (metadata.size > maxImageBytes) return { kind: "too_large", byteLength: metadata.size };
    const prefix = Buffer.alloc(Math.min(metadata.size, 4096));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    if (!validImageHeader(prefix.subarray(0, bytesRead), mimeType))
      return { kind: "unsupported", byteLength: metadata.size };
    const version = workingVersion(metadata);
    return {
      kind: "ready",
      version,
      resource: fileImageResource(project.id, path, version, mimeType, metadata.size),
    };
  } finally {
    await opened.file.close();
  }
}

export async function readWorkingImageBytes(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  version: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const opened = await openCheckedMedia(root, project, rawPath);
  try {
    const { file, metadata } = opened;
    const mimeType = imageMimeType(opened.path);
    if (mimeType === null) throw new AppError("not_found", 404, "Previewable image was not found");
    if (metadata.size > maxImageBytes)
      throw new AppError("invalid_request", 413, "Image exceeds the 25 MiB preview limit");
    if (workingVersion(metadata) !== version)
      throw new AppError("not_found", 409, "This image changed. Refresh its preview.");
    const bytes = Buffer.alloc(metadata.size);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    const after = await file.stat();
    if (
      size !== bytes.length ||
      workingVersion(after) !== version ||
      !validImageHeader(bytes.subarray(0, Math.min(bytes.length, 4096)), mimeType)
    ) {
      throw new AppError("not_found", 409, "This image changed. Refresh its preview.");
    }
    return { bytes, mimeType };
  } finally {
    await opened.file.close();
  }
}

export async function inspectWorkingAudioVideo(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<WorkingImage> {
  const opened = await openCheckedMedia(root, project, rawPath);
  try {
    const type = audioVideoType(opened.path);
    if (type === null) throw new AppError("not_found", 404, "Previewable media file was not found");
    if (opened.metadata.size > maxAudioVideoBytes)
      return { kind: "too_large", byteLength: opened.metadata.size };
    const prefix = Buffer.alloc(Math.min(opened.metadata.size, 64));
    const { bytesRead } = await opened.file.read(prefix, 0, prefix.length, 0);
    if (!validAudioVideoHeader(prefix.subarray(0, bytesRead), type.mimeType))
      return { kind: "unsupported", byteLength: opened.metadata.size };
    const version = workingVersion(opened.metadata);
    return {
      kind: "ready",
      version,
      resource: fileAudioVideoResource(
        project.id,
        opened.path,
        version,
        type,
        opened.metadata.size,
      ),
    };
  } finally {
    await opened.file.close();
  }
}

export async function openWorkingAudioVideo(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  version: string,
): Promise<{ file: FileHandle; byteLength: number; mimeType: string; path: string }> {
  const opened = await openCheckedMedia(root, project, rawPath);
  try {
    const type = audioVideoType(opened.path);
    if (type === null) throw new AppError("not_found", 404, "Previewable media file was not found");
    if (opened.metadata.size > maxAudioVideoBytes)
      throw new AppError("invalid_request", 413, "Media exceeds the 200 MiB preview limit");
    if (workingVersion(opened.metadata) !== version)
      throw new AppError("not_found", 409, "This media file changed. Refresh its preview.");
    const prefix = Buffer.alloc(Math.min(opened.metadata.size, 64));
    const { bytesRead } = await opened.file.read(prefix, 0, prefix.length, 0);
    if (!validAudioVideoHeader(prefix.subarray(0, bytesRead), type.mimeType))
      throw new AppError(
        "not_found",
        409,
        "This media file cannot be previewed. Refresh its preview.",
      );
    return {
      file: opened.file,
      byteLength: opened.metadata.size,
      mimeType: type.mimeType,
      path: opened.path,
    };
  } catch (error: unknown) {
    await opened.file.close();
    throw error;
  }
}

export async function readProjectFile(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  requestedLanguage: string | null,
): Promise<FileReadResult> {
  const location = await checkedPath(root, project, rawPath);
  if (location.path === "" || location.kind === "directory")
    throw new AppError("not_found", 404, "File was not found");
  if (location.kind === "symlink" || location.kind === "other")
    return {
      kind: location.kind === "symlink" ? "symlink" : "unsupported",
      path: location.path,
      byteLength: location.size,
    };
  if (imageMimeType(location.path) !== null) {
    const image = await inspectWorkingImage(root, project, location.path);
    if (image.kind === "ready")
      return {
        kind: "media",
        path: location.path,
        byteLength: image.resource.byteLength,
        resource: image.resource,
      };
    return {
      kind: image.kind === "too_large" ? "too_large" : "binary",
      path: location.path,
      byteLength: image.byteLength,
    };
  }
  if (audioVideoType(location.path) !== null) {
    const media = await inspectWorkingAudioVideo(root, project, location.path);
    if (media.kind === "ready")
      return {
        kind: "media",
        path: location.path,
        byteLength: media.resource.byteLength,
        resource: media.resource,
      };
    return {
      kind: media.kind === "too_large" ? "too_large" : "binary",
      path: location.path,
      byteLength: media.byteLength,
    };
  }
  if (location.size > maxTextBytes)
    return { kind: "too_large", path: location.path, byteLength: location.size };
  const bytes = Buffer.allocUnsafe(maxTextBytes + 1);
  let size = 0;
  try {
    const file = await open(
      location.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const metadata = await file.stat();
      if (!metadata.isFile())
        return { kind: "unsupported", path: location.path, byteLength: metadata.size };
      while (size <= maxTextBytes) {
        const { bytesRead } = await file.read(bytes, size, maxTextBytes + 1 - size, null);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
    } finally {
      await file.close();
    }
  } catch (error: unknown) {
    return accessError(error);
  }
  if (size > maxTextBytes) return { kind: "too_large", path: location.path, byteLength: size };
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } catch {
    return { kind: "binary", path: location.path, byteLength: size };
  }
  if (source.includes("\0")) return { kind: "binary", path: location.path, byteLength: size };
  source = source.replaceAll("\r\n", "\n");
  const parts = source === "" ? [] : source.split("\n");
  if (source.endsWith("\n")) parts.pop();
  if (parts.length > maxLines) return { kind: "too_large", path: location.path, byteLength: size };
  const language = requestedLanguage ?? detectLanguage(location.path);
  let syntax: SyntaxState = {
    kind: "plain",
    reason: requestedLanguage === "text" ? "selected" : "unknown_language",
  };
  let highlighted: SyntaxToken[][] | null = null;
  if (language !== null && language !== "text") {
    try {
      highlighted = await highlightSource(parts.join("\n"), language);
      if (
        highlighted !== null &&
        (highlighted.length !== parts.length ||
          highlighted.some(
            (tokens, index) => tokens.map((token) => token.text).join("") !== parts[index],
          ))
      )
        highlighted = null;
      syntax =
        highlighted === null
          ? { kind: "plain", reason: "unavailable" }
          : { kind: "highlighted", language };
    } catch {
      syntax = { kind: "plain", reason: "unavailable" };
    }
  }
  const lines = parts.map((text, index) => ({
    number: index + 1,
    text,
    tokens:
      highlighted?.[index]?.map((token) => ({ ...token })) ??
      (text === "" ? [] : [{ text, role: "plain" as const }]),
  }));
  return { kind: "text", path: location.path, byteLength: size, syntax, lines };
}
