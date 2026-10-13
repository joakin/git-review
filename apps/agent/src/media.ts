import { projectApiUrl } from "@git-review/shared/project-path";
import { basename } from "node:path";
import type { ChangeEntry, DiffResult, MediaSide, Project } from "@git-review/shared/api";
import type {
  CommitDetail,
  CommitFileChange,
  CommitFileSide,
  CommitDiff,
} from "@git-review/shared/git";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { inspectGitBlob, readGitBlob, resolveGitBlob } from "./git-objects.ts";
import { validImageHeader } from "./image-types.ts";
import {
  imageMimeType,
  maxImageBytes,
  audioVideoType,
  maxAudioVideoBytes,
  mediaTypeForPath,
  type MediaType,
  type ImageMimeType,
} from "@git-review/shared/media-types";
import {
  inspectWorkingMedia,
  openWorkingAudioVideo,
  readWorkingImageBytes,
} from "./project-files.ts";
import { validateProjectFilePath } from "./working-files.ts";
import { audioVideoResponse, type StreamableMedia } from "./media-stream.ts";

type MediaSource =
  | { kind: "absent" }
  | { kind: "worktree"; path: string }
  | { kind: "index" | "head"; path: string }
  | { kind: "commit"; path: string; oid: string };

function sourceForSide(entry: ChangeEntry, side: "old" | "new"): MediaSource {
  if (entry.layer === "untracked")
    return side === "old" ? { kind: "absent" } : { kind: "worktree", path: entry.path };
  if (entry.layer === "conflict") return { kind: "absent" };
  if (side === "old") {
    if (entry.kind === "added") return { kind: "absent" };
    return { kind: entry.layer === "staged" ? "head" : "index", path: entry.oldPath ?? entry.path };
  }
  if (entry.kind === "deleted") return { kind: "absent" };
  return { kind: entry.layer === "staged" ? "index" : "worktree", path: entry.path };
}

async function oidForSource(
  project: Project,
  source: Exclude<MediaSource, { kind: "absent" }>,
): Promise<string | null> {
  if (source.kind === "worktree") return null;
  return resolveGitBlob(
    project.absolutePath,
    source.kind === "commit" ? { kind: "object", oid: source.oid } : source,
  );
}

type GitImageInfo =
  | { kind: "ready"; oid: string; mimeType: ImageMimeType; byteLength: number }
  | { kind: "unavailable"; reason: "unsupported" | "too_large" | "missing" };

async function gitImageInfo(
  project: Project,
  source: Exclude<MediaSource, { kind: "absent" }>,
): Promise<GitImageInfo> {
  const mimeType = imageMimeType(source.path);
  if (mimeType === null) return { kind: "unavailable", reason: "unsupported" };
  const oid = await oidForSource(project, source);
  if (oid === null) return { kind: "unavailable", reason: "missing" };
  try {
    const info = await inspectGitBlob(project.absolutePath, oid);
    if (info.kind === "other") return { kind: "unavailable", reason: "unsupported" };
    const size = info.byteLength;
    if (size > maxImageBytes) return { kind: "unavailable", reason: "too_large" };
    const bytes = await readGitBlob(project.absolutePath, oid, maxImageBytes + 4096);
    if (
      bytes.length !== size ||
      !validImageHeader(bytes.subarray(0, Math.min(size, 4096)), mimeType)
    )
      return { kind: "unavailable", reason: "unsupported" };
    return { kind: "ready", oid, mimeType, byteLength: size };
  } catch {
    return { kind: "unavailable", reason: "missing" };
  }
}

type GitAudioVideoInfo =
  | { kind: "ready"; oid: string; byteLength: number }
  | { kind: "unavailable"; reason: "unsupported" | "too_large" | "missing" };

async function gitAudioVideoInfo(
  project: Project,
  source: Exclude<MediaSource, { kind: "absent" }>,
): Promise<GitAudioVideoInfo> {
  if (audioVideoType(source.path) === null) return { kind: "unavailable", reason: "unsupported" };
  const oid = await oidForSource(project, source);
  if (oid === null) return { kind: "unavailable", reason: "missing" };
  try {
    const info = await inspectGitBlob(project.absolutePath, oid);
    if (info.kind === "other") return { kind: "unavailable", reason: "unsupported" };
    const size = info.byteLength;
    if (size === 0) return { kind: "unavailable", reason: "missing" };
    if (size > maxAudioVideoBytes) return { kind: "unavailable", reason: "too_large" };
    return { kind: "ready", oid, byteLength: size };
  } catch {
    return { kind: "unavailable", reason: "missing" };
  }
}

type MediaInfo =
  | { kind: "ready"; type: MediaType; version: string; byteLength: number }
  | { kind: "unavailable"; reason: "unsupported" | "too_large" | "missing" };

async function gitMediaInfo(
  project: Project,
  source: Exclude<MediaSource, { kind: "absent" | "worktree" }>,
): Promise<MediaInfo> {
  const type = mediaTypeForPath(source.path);
  if (type === null) return { kind: "unavailable", reason: "unsupported" };
  const info =
    type.kind === "image"
      ? await gitImageInfo(project, source)
      : await gitAudioVideoInfo(project, source);
  return info.kind === "unavailable"
    ? info
    : { kind: "ready", type, version: info.oid, byteLength: info.byteLength };
}

async function workingMediaInfo(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<MediaInfo> {
  if (mediaTypeForPath(path) === null) return { kind: "unavailable", reason: "unsupported" };
  try {
    const media = await inspectWorkingMedia(root, project, path);
    return media.kind === "ready" ? media : { kind: "unavailable", reason: media.kind };
  } catch (error: unknown) {
    if (error instanceof AppError && error.status === 404)
      return { kind: "unavailable", reason: "missing" };
    throw error;
  }
}

function mediaSide(path: string, info: MediaInfo, rawUrl: (version: string) => string): MediaSide {
  return info.kind === "unavailable"
    ? { kind: "unavailable", path, reason: info.reason }
    : {
        kind: "ready",
        path,
        resource: { ...info.type, byteLength: info.byteLength, url: rawUrl(info.version) },
      };
}

async function describeSide(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  revision: string,
  side: "old" | "new",
): Promise<MediaSide> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") return { kind: "absent" };
  const path = validateProjectFilePath(source.path);
  const info =
    source.kind === "worktree"
      ? await workingMediaInfo(root, project, path)
      : await gitMediaInfo(project, source);
  return mediaSide(path, info, (version) =>
    projectApiUrl("/raw/diff", project.absolutePath, {
      layer: entry.layer,
      path: entry.path,
      revision,
      side,
      version,
    }),
  );
}

export async function describeDiffMedia(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  revision: string,
): Promise<DiffResult | null> {
  if (
    entry.layer === "conflict" ||
    entry.isSubmodule ||
    (mediaTypeForPath(entry.path) === null &&
      mediaTypeForPath(entry.oldPath ?? entry.path) === null)
  )
    return null;
  const old = await describeSide(root, project, entry, revision, "old");
  const next = await describeSide(root, project, entry, revision, "new");
  return { kind: "media", old, new: next };
}

export function diffMediaType(
  entry: ChangeEntry,
  side: "old" | "new",
): "image" | "audio-video" | null {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") return null;
  if (imageMimeType(source.path) !== null) return "image";
  return audioVideoType(source.path) === null ? null : "audio-video";
}

export async function openDiffAudioVideo(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  side: "old" | "new",
  version: string,
): Promise<StreamableMedia> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent")
    throw new AppError("not_found", 404, "This change has no media on that side");
  const path = validateProjectFilePath(source.path);
  const type = audioVideoType(path);
  if (type === null)
    throw new AppError("not_found", 404, "This side is not a previewable audio or video file");
  if (source.kind === "worktree") {
    const opened = await openWorkingAudioVideo(root, project, path, version);
    return {
      source: { kind: "file", file: opened.file, version },
      byteLength: opened.byteLength,
      mimeType: opened.mimeType,
      path,
    };
  }
  const info = await gitAudioVideoInfo(project, source);
  if (info.kind !== "ready" || info.oid !== version)
    throw new AppError("not_found", 409, "This media file changed. Refresh its preview.");
  return {
    source: { kind: "git", project, oid: info.oid },
    byteLength: info.byteLength,
    mimeType: type.mimeType,
    path,
  };
}

export async function readDiffImageBytes(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  side: "old" | "new",
  version: string,
): Promise<{ bytes: Buffer; mimeType: ImageMimeType; path: string }> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent")
    throw new AppError("not_found", 404, "This change has no image on that side");
  const path = validateProjectFilePath(source.path);
  if (imageMimeType(path) === null)
    throw new AppError("not_found", 404, "This side is not a previewable image");
  if (source.kind === "worktree")
    return { ...(await readWorkingImageBytes(root, project, path, version)), path };
  const image = await gitImageInfo(project, source);
  if (image.kind !== "ready" || image.oid !== version)
    throw new AppError("not_found", 409, "This image changed. Refresh its preview.");
  const bytes = await readGitBlob(project.absolutePath, image.oid, maxImageBytes + 4096);
  return { bytes, mimeType: image.mimeType, path };
}

function commitSource(side: CommitFileSide): Extract<MediaSource, { kind: "absent" | "commit" }> {
  return side.kind === "absent" ? side : { kind: "commit", path: side.path, oid: side.oid };
}

async function describeCommitSide(
  project: Project,
  detail: CommitDetail,
  file: CommitFileChange,
  side: "old" | "new",
): Promise<MediaSide> {
  const source = commitSource(file[side]);
  if (source.kind === "absent") return source;
  const info = await gitMediaInfo(project, source);
  return mediaSide(source.path, info, (version) =>
    projectApiUrl("/raw/commit", project.absolutePath, {
      commit: detail.oid,
      path: file.path,
      side,
      version,
    }),
  );
}

export async function describeCommitMedia(
  project: Project,
  detail: CommitDetail,
  file: CommitFileChange,
): Promise<CommitDiff | null> {
  const sides = [file.old, file.new];
  if (
    sides.some(
      (side) => side.kind === "present" && side.mode !== "100644" && side.mode !== "100755",
    ) ||
    !sides.some((side) => side.kind === "present" && mediaTypeForPath(side.path) !== null)
  )
    return null;
  const [old, next] = await Promise.all([
    describeCommitSide(project, detail, file, "old"),
    describeCommitSide(project, detail, file, "new"),
  ]);
  return { kind: "media", old, new: next };
}

export async function commitMediaResponse(
  request: Request,
  project: Project,
  file: CommitFileChange,
  side: "old" | "new",
  version: string,
): Promise<Response> {
  const selected = file[side];
  if (
    selected.kind !== "present" ||
    (selected.mode !== "100644" && selected.mode !== "100755") ||
    selected.oid !== version
  )
    throw new AppError("not_found", 404, "This commit has no matching media on that side");
  const source = commitSource(selected);
  if (source.kind === "absent") throw new Error("Missing committed media source");
  if (imageMimeType(source.path) !== null) {
    const image = await gitImageInfo(project, source);
    if (image.kind !== "ready")
      throw new AppError("not_found", 404, "This committed image is unavailable");
    const bytes = await readGitBlob(project.absolutePath, image.oid, maxImageBytes + 4096);
    return imageResponse(bytes, image.mimeType, source.path, request.method === "HEAD");
  }
  const type = audioVideoType(source.path);
  const info = await gitAudioVideoInfo(project, source);
  if (type === null || info.kind !== "ready")
    throw new AppError("not_found", 404, "This committed media is unavailable");
  return audioVideoResponse(request, {
    source: { kind: "git", project, oid: info.oid },
    byteLength: info.byteLength,
    mimeType: type.mimeType,
    path: source.path,
  });
}

export function imageResponse(
  bytes: Buffer,
  mimeType: ImageMimeType,
  path: string,
  head: boolean,
): Response {
  const filename = encodeURIComponent(basename(path));
  return new Response(head ? null : new Uint8Array(bytes), {
    headers: {
      "content-type": mimeType,
      "content-length": String(bytes.length),
      "content-disposition": `inline; filename*=UTF-8''${filename}`,
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'none'; sandbox",
    },
  });
}
