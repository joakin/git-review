import { opendir, type FileHandle } from "node:fs/promises";
import { projectApiUrl } from "@git-review/shared/project-path";
import type {
  FileReadResult,
  FileTree,
  FileTreeEntry,
  Project,
  SyntaxState,
  SyntaxToken,
} from "@git-review/shared/api";
import { AppError, type ApprovedRoot } from "./paths.ts";
import {
  checkedProjectPath,
  openCheckedWorkingFile,
  projectFileAccessError,
  withCheckedWorkingFile,
} from "./working-files.ts";
import { detectLanguage, highlightSource } from "./syntax.ts";
import { maxSourceTextBytes, parseSourceText } from "./source-text.ts";
import { validImageHeader, workingVersion } from "./image-types.ts";
import { validAudioVideoHeader } from "./audio-video-types.ts";
import {
  imageMimeType,
  maxImageBytes,
  audioVideoType,
  maxAudioVideoBytes,
  mediaTypeForPath,
  mediaByteLimits,
  type AudioVideoType,
  type ImageMimeType,
  type MediaType,
} from "@git-review/shared/media-types";

const maxEntries = 1000;

export async function readProjectTree(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<FileTree> {
  const location = await checkedProjectPath(root, project, rawPath);
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
    projectFileAccessError(error);
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

type WorkingMedia =
  | {
      kind: "ready";
      version: string;
      type: MediaType;
      byteLength: number;
    }
  | { kind: "too_large" | "unsupported"; byteLength: number };

export async function inspectWorkingMedia(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
): Promise<WorkingMedia> {
  return withCheckedWorkingFile(root, project, rawPath, async (opened) => {
    const { metadata, file, path } = opened;
    const type = mediaTypeForPath(path);
    if (type === null) throw new AppError("not_found", 404, "Previewable media file was not found");
    if (metadata.size > mediaByteLimits[type.kind])
      return { kind: "too_large", byteLength: metadata.size };
    const prefix = Buffer.alloc(Math.min(metadata.size, type.kind === "image" ? 4096 : 64));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    const bytes = prefix.subarray(0, bytesRead);
    const valid =
      type.kind === "image"
        ? validImageHeader(bytes, type.mimeType)
        : validAudioVideoHeader(bytes, type.mimeType);
    if (!valid) return { kind: "unsupported", byteLength: metadata.size };
    const version = workingVersion(metadata);
    return {
      kind: "ready",
      version,
      type,
      byteLength: metadata.size,
    };
  });
}

export async function readWorkingImageBytes(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  version: string,
): Promise<{ bytes: Buffer; mimeType: ImageMimeType }> {
  return withCheckedWorkingFile(root, project, rawPath, async (opened) => {
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
  });
}

export async function openWorkingAudioVideo(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  version: string,
): Promise<{
  file: FileHandle;
  byteLength: number;
  mimeType: AudioVideoType["mimeType"];
  path: string;
}> {
  const opened = await openCheckedWorkingFile(root, project, rawPath);
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

async function readFile(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  requestedLanguage: string | null,
): Promise<FileReadResult> {
  const location = await checkedProjectPath(root, project, rawPath);
  if (location.path === "" || location.kind === "directory")
    throw new AppError("not_found", 404, "File was not found");
  if (location.kind === "symlink" || location.kind === "other")
    return {
      kind: location.kind === "symlink" ? "symlink" : "unsupported",
      path: location.path,
      byteLength: location.metadata.size,
    };
  if (mediaTypeForPath(location.path) !== null) {
    const media = await inspectWorkingMedia(root, project, location.path);
    if (media.kind === "ready")
      return {
        kind: "media",
        path: location.path,
        byteLength: media.byteLength,
        resource: {
          ...media.type,
          byteLength: media.byteLength,
          url: projectApiUrl("/raw/file", project.absolutePath, {
            path: location.path,
            version: media.version,
          }),
        },
      };
    return {
      kind: media.kind === "too_large" ? "too_large" : "binary",
      path: location.path,
      byteLength: media.byteLength,
    };
  }
  if (location.metadata.size > maxSourceTextBytes)
    return { kind: "too_large", path: location.path, byteLength: location.metadata.size };
  const content = await withCheckedWorkingFile(
    root,
    project,
    location.path,
    async ({ file, metadata }) => {
      if (metadata.size > maxSourceTextBytes)
        return { kind: "too_large" as const, byteLength: metadata.size };
      const bytes = Buffer.allocUnsafe(maxSourceTextBytes + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      return { kind: "content" as const, bytes: bytes.subarray(0, size) };
    },
  );
  if (content.kind === "too_large")
    return { kind: "too_large", path: location.path, byteLength: content.byteLength };
  const bytes = content.bytes;
  const size = bytes.length;
  const parsed = parseSourceText(bytes);
  if (parsed.kind !== "text") return { kind: parsed.kind, path: location.path, byteLength: size };
  const source = parsed.text.replaceAll("\r\n", "\n");
  const parts = source === "" ? [] : source.split("\n");
  if (source.endsWith("\n")) parts.pop();
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

/** Only file-level absence is a stale anchor; project/API failures retain drafts for retry. */
export async function readProjectFile(
  root: ApprovedRoot,
  project: Project,
  rawPath: unknown,
  requestedLanguage: string | null,
): Promise<FileReadResult> {
  try {
    return await readFile(root, project, rawPath, requestedLanguage);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "not_found" && error.status === 404)
      throw new AppError("file_not_found", 404, "File was not found. Refresh its folder.");
    throw error;
  }
}
