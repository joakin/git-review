import { basename } from "node:path";
import type { ChangeEntry, DiffResult, MediaSide, Project } from "../shared/api.ts";
import type { CommitDetail, CommitFileChange, CommitFileSide, CommitDiff } from "../shared/git.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { runGit } from "./git-status.ts";
import { diffImageResource, imageMimeType, maxImageBytes, validImageHeader } from "./image-types.ts";
import { audioVideoType, diffAudioVideoResource, maxAudioVideoBytes } from "./audio-video-types.ts";
import { inspectWorkingImage, inspectWorkingAudioVideo, openWorkingAudioVideo, readWorkingImageBytes, validateProjectFilePath } from "./project-files.ts";
import { audioVideoResponse, type StreamableMedia } from "./media-stream.ts";

type ImageSource = { kind: "absent" } | { kind: "worktree" | "index" | "head"; path: string } | { kind: "commit"; path: string; oid: string };

function sourceForSide(entry: ChangeEntry, side: "old" | "new"): ImageSource {
  if (entry.layer === "untracked") return side === "old" ? { kind: "absent" } : { kind: "worktree", path: entry.path };
  if (entry.layer === "conflict") return { kind: "absent" };
  if (side === "old") {
    if (entry.kind === "added") return { kind: "absent" };
    return { kind: entry.layer === "staged" ? "head" : "index", path: entry.oldPath ?? entry.path };
  }
  if (entry.kind === "deleted") return { kind: "absent" };
  return { kind: entry.layer === "staged" ? "index" : "worktree", path: entry.path };
}

function gitOid(output: Buffer): string | null {
  const oid = output.toString("utf8").trim();
  return /^[0-9a-f]{40,64}$/.test(oid) ? oid : null;
}

async function oidForSource(project: Project, source: Exclude<ImageSource, { kind: "absent" }>): Promise<string | null> {
  if (source.kind === "worktree") return null;
  if (source.kind === "commit") return source.oid;
  if (source.kind === "head") {
    try { return gitOid(await runGit(project.absolutePath, ["rev-parse", "--verify", "--end-of-options", `HEAD:${source.path}`], 4096)); }
    catch { return null; }
  }
  let output: Buffer;
  try { output = await runGit(project.absolutePath, ["ls-files", "--stage", "-z", "--", source.path], 16 * 1024); }
  catch { return null; }
  for (const record of output.toString("utf8").split("\0")) {
    const match = /^(100644|100755) ([0-9a-f]{40,64}) 0\t([^]*)$/.exec(record);
    if (match !== null && match[3] === source.path) return match[2] ?? null;
  }
  return null;
}

type GitImageInfo = { kind: "ready"; oid: string; mimeType: string; byteLength: number } | { kind: "unavailable"; reason: "unsupported" | "too_large" | "missing" };

async function gitImageInfo(project: Project, source: Exclude<ImageSource, { kind: "absent" }>): Promise<GitImageInfo> {
  const mimeType = imageMimeType(source.path);
  if (mimeType === null) return { kind: "unavailable", reason: "unsupported" };
  const oid = await oidForSource(project, source);
  if (oid === null) return { kind: "unavailable", reason: "missing" };
  try {
    if ((await runGit(project.absolutePath, ["cat-file", "-t", oid], 4096)).toString("utf8").trim() !== "blob") return { kind: "unavailable", reason: "unsupported" };
    const size = Number((await runGit(project.absolutePath, ["cat-file", "-s", oid], 4096)).toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size < 0) return { kind: "unavailable", reason: "missing" };
    if (size > maxImageBytes) return { kind: "unavailable", reason: "too_large" };
    const bytes = await runGit(project.absolutePath, ["cat-file", "blob", oid], maxImageBytes + 4096);
    if (bytes.length !== size || !validImageHeader(bytes.subarray(0, Math.min(size, 4096)), mimeType)) return { kind: "unavailable", reason: "unsupported" };
    return { kind: "ready", oid, mimeType, byteLength: size };
  } catch { return { kind: "unavailable", reason: "missing" }; }
}

type GitAudioVideoInfo = { kind: "ready"; oid: string; byteLength: number } | { kind: "unavailable"; reason: "unsupported" | "too_large" | "missing" };

async function gitAudioVideoInfo(project: Project, source: Exclude<ImageSource, { kind: "absent" }>): Promise<GitAudioVideoInfo> {
  if (audioVideoType(source.path) === null) return { kind: "unavailable", reason: "unsupported" };
  const oid = await oidForSource(project, source);
  if (oid === null) return { kind: "unavailable", reason: "missing" };
  try {
    if ((await runGit(project.absolutePath, ["cat-file", "-t", oid], 4096)).toString("utf8").trim() !== "blob") return { kind: "unavailable", reason: "unsupported" };
    const size = Number((await runGit(project.absolutePath, ["cat-file", "-s", oid], 4096)).toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size <= 0) return { kind: "unavailable", reason: "missing" };
    if (size > maxAudioVideoBytes) return { kind: "unavailable", reason: "too_large" };
    return { kind: "ready", oid, byteLength: size };
  } catch { return { kind: "unavailable", reason: "missing" }; }
}

async function describeSide(root: ApprovedRoot, project: Project, entry: ChangeEntry, revision: string, side: "old" | "new"): Promise<MediaSide> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") return { kind: "absent" };
  const path = validateProjectFilePath(source.path);
  if (imageMimeType(path) === null) {
    const type = audioVideoType(path);
    if (type === null) return { kind: "unavailable", path, reason: "unsupported" };
    if (source.kind === "worktree") {
      try {
        const media = await inspectWorkingAudioVideo(root, project, path);
        if (media.kind === "ready") return { kind: "ready", path, resource: diffAudioVideoResource(project.id, entry.layer, entry.path, revision, side, media.version, type, media.resource.byteLength) };
        return { kind: "unavailable", path, reason: media.kind === "too_large" ? "too_large" : "unsupported" };
      } catch (error: unknown) {
        if (error instanceof AppError && error.status === 404) return { kind: "unavailable", path, reason: "missing" };
        throw error;
      }
    }
    const media = await gitAudioVideoInfo(project, source);
    if (media.kind === "unavailable") return { kind: "unavailable", path, reason: media.reason };
    return { kind: "ready", path, resource: diffAudioVideoResource(project.id, entry.layer, entry.path, revision, side, media.oid, type, media.byteLength) };
  }
  if (source.kind === "worktree") {
    try {
      const image = await inspectWorkingImage(root, project, path);
      if (image.kind === "ready") return { kind: "ready", path, resource: diffImageResource(project.id, entry.layer, entry.path, revision, side, image.version, image.resource.mimeType, image.resource.byteLength) };
      return { kind: "unavailable", path, reason: image.kind === "too_large" ? "too_large" : "unsupported" };
    } catch (error: unknown) {
      if (error instanceof AppError && error.status === 404) return { kind: "unavailable", path, reason: "missing" };
      throw error;
    }
  }
  const image = await gitImageInfo(project, source);
  if (image.kind === "unavailable") return { kind: "unavailable", path, reason: image.reason };
  return { kind: "ready", path, resource: diffImageResource(project.id, entry.layer, entry.path, revision, side, image.oid, image.mimeType, image.byteLength) };
}

export async function describeDiffMedia(root: ApprovedRoot, project: Project, entry: ChangeEntry, revision: string): Promise<DiffResult | null> {
  if (entry.layer === "conflict" || entry.isSubmodule || (imageMimeType(entry.path) === null && imageMimeType(entry.oldPath ?? entry.path) === null && audioVideoType(entry.path) === null && audioVideoType(entry.oldPath ?? entry.path) === null)) return null;
  const old = await describeSide(root, project, entry, revision, "old");
  const next = await describeSide(root, project, entry, revision, "new");
  return { kind: "media", old, new: next };
}

export function diffMediaType(entry: ChangeEntry, side: "old" | "new"): "image" | "audio-video" | null {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") return null;
  if (imageMimeType(source.path) !== null) return "image";
  return audioVideoType(source.path) === null ? null : "audio-video";
}

export async function openDiffAudioVideo(root: ApprovedRoot, project: Project, entry: ChangeEntry, side: "old" | "new", version: string): Promise<StreamableMedia> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") throw new AppError("not_found", 404, "This change has no media on that side");
  const path = validateProjectFilePath(source.path);
  const type = audioVideoType(path);
  if (type === null) throw new AppError("not_found", 404, "This side is not a previewable audio or video file");
  if (source.kind === "worktree") {
    const opened = await openWorkingAudioVideo(root, project, path, version);
    return { source: { kind: "file", file: opened.file, version }, byteLength: opened.byteLength, mimeType: opened.mimeType, path };
  }
  const info = await gitAudioVideoInfo(project, source);
  if (info.kind !== "ready" || info.oid !== version) throw new AppError("not_found", 409, "This media file changed. Refresh its preview.");
  return { source: { kind: "git", project, oid: info.oid }, byteLength: info.byteLength, mimeType: type.mimeType, path };
}

export async function readDiffImageBytes(root: ApprovedRoot, project: Project, entry: ChangeEntry, side: "old" | "new", version: string): Promise<{ bytes: Buffer; mimeType: string; path: string }> {
  const source = sourceForSide(entry, side);
  if (source.kind === "absent") throw new AppError("not_found", 404, "This change has no image on that side");
  const path = validateProjectFilePath(source.path);
  if (imageMimeType(path) === null) throw new AppError("not_found", 404, "This side is not a previewable image");
  if (source.kind === "worktree") return { ...await readWorkingImageBytes(root, project, path, version), path };
  const image = await gitImageInfo(project, source);
  if (image.kind !== "ready" || image.oid !== version) throw new AppError("not_found", 409, "This image changed. Refresh its preview.");
  const bytes = await runGit(project.absolutePath, ["cat-file", "blob", image.oid], maxImageBytes + 4096);
  return { bytes, mimeType: image.mimeType, path };
}

function commitSource(side: CommitFileSide): ImageSource {
  return side.kind === "absent" ? side : { kind: "commit", path: side.path, oid: side.oid };
}

async function describeCommitSide(project: Project, detail: CommitDetail, file: CommitFileChange, side: "old" | "new"): Promise<MediaSide> {
  const source = commitSource(file[side]);
  if (source.kind === "absent") return source;
  const query = (version: string) => new URLSearchParams({ commit: detail.oid, path: file.path, side, version });
  const imageMime = imageMimeType(source.path);
  if (imageMime !== null) {
    const info = await gitImageInfo(project, source);
    if (info.kind === "unavailable") return { kind: "unavailable", path: source.path, reason: info.reason };
    return { kind: "ready", path: source.path, resource: { kind: "image", mimeType: info.mimeType, byteLength: info.byteLength, url: `/api/projects/${project.id}/raw/commit?${query(info.oid)}` } };
  }
  const type = audioVideoType(source.path);
  if (type === null) return { kind: "unavailable", path: source.path, reason: "unsupported" };
  const info = await gitAudioVideoInfo(project, source);
  if (info.kind === "unavailable") return { kind: "unavailable", path: source.path, reason: info.reason };
  return { kind: "ready", path: source.path, resource: { ...type, byteLength: info.byteLength, url: `/api/projects/${project.id}/raw/commit?${query(info.oid)}` } };
}

export async function describeCommitMedia(project: Project, detail: CommitDetail, file: CommitFileChange): Promise<CommitDiff | null> {
  const sides = [file.old, file.new];
  if (sides.some((side) => side.kind === "present" && side.mode !== "100644" && side.mode !== "100755") || !sides.some((side) => side.kind === "present" && (imageMimeType(side.path) !== null || audioVideoType(side.path) !== null))) return null;
  const [old, next] = await Promise.all([describeCommitSide(project, detail, file, "old"), describeCommitSide(project, detail, file, "new")]);
  return { kind: "media", old, new: next };
}

export async function commitMediaResponse(request: Request, project: Project, file: CommitFileChange, side: "old" | "new", version: string): Promise<Response> {
  const selected = file[side];
  if (selected.kind !== "present" || (selected.mode !== "100644" && selected.mode !== "100755") || selected.oid !== version) throw new AppError("not_found", 404, "This commit has no matching media on that side");
  const source = commitSource(selected);
  if (source.kind === "absent") throw new Error("Missing committed media source");
  if (imageMimeType(source.path) !== null) {
    const image = await gitImageInfo(project, source);
    if (image.kind !== "ready") throw new AppError("not_found", 404, "This committed image is unavailable");
    const bytes = await runGit(project.absolutePath, ["cat-file", "blob", image.oid], maxImageBytes + 4096);
    return imageResponse(bytes, image.mimeType, source.path, request.method === "HEAD");
  }
  const type = audioVideoType(source.path);
  const info = await gitAudioVideoInfo(project, source);
  if (type === null || info.kind !== "ready") throw new AppError("not_found", 404, "This committed media is unavailable");
  return audioVideoResponse(request, { source: { kind: "git", project, oid: info.oid }, byteLength: info.byteLength, mimeType: type.mimeType, path: source.path });
}

export function imageResponse(bytes: Buffer, mimeType: string, path: string, head: boolean): Response {
  const filename = encodeURIComponent(basename(path));
  return new Response(head ? null : new Uint8Array(bytes), { headers: {
    "content-type": mimeType,
    "content-length": String(bytes.length),
    "content-disposition": `inline; filename*=UTF-8''${filename}`,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'none'; sandbox",
  } });
}
