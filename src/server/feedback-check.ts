import type { ChangeEntry, DiffResult, Project } from "../shared/api.ts";
import {
  feedbackAnchorKey,
  type CommentAnchor,
  type DiffCommentAnchor,
  type FeedbackCheckRequest,
  type FeedbackCheckResponse,
} from "../shared/feedback-check.ts";
import { mediaTypeForPath } from "../shared/media-types.ts";
import { readGitInventory, readWorkingPathVersions } from "./git-status.ts";
import { parseGitPatchHunks } from "./diff-content.ts";
import { readProjectPatch } from "./git-diff.ts";
import { readGitPath } from "./git-objects.ts";
import { repositoryPath } from "./git-context.ts";
import { GitCommandError } from "./git-execution.ts";
import { AppError, isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { checkedProjectPath } from "./working-files.ts";
import { readWorkingContent } from "./working-text.ts";
import { decodedText, maxSourceTextBytes, parseSourceText } from "./source-text.ts";
import { sourceLines } from "./diff-context-content.ts";
import { resolve } from "node:path";

type Source = { kind: "text"; text: string } | { kind: "missing" | "source" | "limit" | "stale" };
const maxCheckReadBytes = 64 * 1024 * 1024;
const defaultReads = {
  inventory: readGitInventory,
  versions: readWorkingPathVersions,
  patch: readProjectPatch,
  working: readWorkingContent,
  blob: readGitPath,
};

function sourceMatches(lines: readonly string[], anchor: CommentAnchor): boolean {
  return (
    lines[anchor.line - 1] === anchor.sourceText &&
    (lines[anchor.line - 2] ?? null) === anchor.before &&
    (lines[anchor.line] ?? null) === anchor.after
  );
}

/** Saved ordinary-hunk neighbors refer to adjacent displayed rows on the chosen side. */
function patchMatches(diff: DiffResult, anchors: readonly DiffCommentAnchor[]): Set<string> {
  const matched = new Set<string>();
  if (diff.kind !== "text") return matched;
  const wanted = new Map<string, DiffCommentAnchor[]>();
  for (const anchor of anchors) {
    const coordinate = `${anchor.side}:${anchor.line}`;
    const group = wanted.get(coordinate) ?? [];
    group.push(anchor);
    wanted.set(coordinate, group);
  }
  for (const hunk of diff.hunks)
    for (const [index, line] of hunk.lines.entries()) {
      for (const side of ["old", "new"] as const) {
        const number = side === "old" ? line.oldLine : line.newLine;
        if (number === null) continue;
        const neighbor = (offset: number): string | null => {
          const row = hunk.lines[index + offset];
          return row !== undefined && (side === "old" ? row.oldLine : row.newLine) !== null
            ? row.text
            : null;
        };
        for (const anchor of wanted.get(`${side}:${number}`) ?? [])
          if (
            line.text === anchor.sourceText &&
            neighbor(-1) === anchor.before &&
            neighbor(1) === anchor.after
          )
            matched.add(feedbackAnchorKey(anchor));
      }
    }
  return matched;
}

/** One bounded, read-only check; injected reads let tests guard work and mutation boundaries. */
export async function checkFeedbackAnchors(
  root: ApprovedRoot,
  project: Project,
  request: FeedbackCheckRequest,
  signal: AbortSignal,
  reads: typeof defaultReads = defaultReads,
): Promise<FeedbackCheckResponse> {
  let readBytes = 0;
  const deadline = Date.now() + 30_000;
  function ensureActive(): void {
    signal.throwIfAborted();
    if (Date.now() > deadline)
      throw new AppError(
        "invalid_request",
        413,
        "Feedback checking exceeded its time budget. Retry with a smaller batch.",
      );
  }
  function reserve(bytes: number): boolean {
    readBytes += bytes;
    if (readBytes > maxCheckReadBytes)
      throw new AppError(
        "invalid_request",
        413,
        "Feedback source checks exceeded the read budget. Check a smaller batch.",
      );
    return true;
  }
  ensureActive();
  const hasDiff = request.anchors.some((anchor) => anchor.kind === "diff");
  const inventory = hasDiff ? await reads.inventory(project.absolutePath) : null;
  ensureActive();
  const entries = inventory?.kind === "git" ? inventory.entries : [];
  const mutablePaths = request.anchors
    .filter(
      (anchor) =>
        anchor.kind === "file" ||
        (anchor.kind === "diff" &&
          anchor.layer !== "staged" &&
          entries.some((entry) => entry.layer === anchor.layer && entry.path === anchor.path)),
    )
    .map((anchor) => anchor.path);
  const before = await reads.versions(project.absolutePath, mutablePaths);
  ensureActive();
  const working = new Map<string, Promise<Source>>();
  function workingSource(path: string): Promise<Source> {
    const existing = working.get(path);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<Source> => {
      ensureActive();
      try {
        await checkedProjectPath(root, project, path);
      } catch (error: unknown) {
        if (error instanceof AppError && error.code === "not_found" && error.status === 404)
          return { kind: "missing" };
        throw error;
      }
      ensureActive();
      const content = await reads.working(root, project, path, maxSourceTextBytes, reserve);
      ensureActive();
      if (content.kind === "stale") return { kind: "stale" };
      if (content.kind === "too_large") return { kind: "limit" };
      if (content.kind !== "content") return { kind: "source" };
      const text = decodedText(content.content);
      return text === null ? { kind: "source" } : { kind: "text", text };
    })();
    working.set(path, pending);
    return pending;
  }
  const objects = new Map<string, Promise<Source>>();
  function objectSource(kind: "head" | "index", path: string): Promise<Source> {
    const key = JSON.stringify([kind, path]);
    const existing = objects.get(key);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<Source> => {
      ensureActive();
      try {
        const bytes = await reads.blob(
          project.absolutePath,
          { kind, path },
          maxSourceTextBytes + 1,
        );
        reserve(bytes.byteLength);
        ensureActive();
        if (bytes.byteLength > maxSourceTextBytes) return { kind: "limit" };
        const text = decodedText(bytes);
        return text === null ? { kind: "source" } : { kind: "text", text };
      } catch (error: unknown) {
        if (
          error instanceof GitCommandError &&
          error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ) {
          reserve(maxSourceTextBytes + 1);
          return { kind: "limit" };
        }
        if (
          error instanceof GitCommandError &&
          error.code === 128 &&
          /^fatal: (?:path [\s\S]+ (?:does not exist|exists on disk, but not)|invalid object name 'HEAD')/.test(
            error.stderr,
          )
        )
          return { kind: "source" };
        throw error;
      }
    })();
    objects.set(key, pending);
    return pending;
  }
  async function diffSource(entry: ChangeEntry, side: "old" | "new"): Promise<Source> {
    if (inventory?.kind !== "git") return { kind: "source" };
    if (
      (side === "old" && (entry.kind === "added" || entry.layer === "untracked")) ||
      (side === "new" && entry.kind === "deleted")
    )
      return { kind: "text", text: "" };
    const path = side === "old" ? (entry.oldPath ?? entry.path) : entry.path;
    const gitPath = repositoryPath(inventory.prefix, path);
    if (gitPath === null || !isWithinRoot(root.realPath, resolve(project.absolutePath, path)))
      return { kind: "source" };
    return side === "new" && entry.layer !== "staged"
      ? workingSource(path)
      : objectSource(side === "old" && entry.layer === "staged" ? "head" : "index", gitPath);
  }
  const groups = new Map<string, CommentAnchor[]>();
  for (const anchor of request.anchors) {
    const key = JSON.stringify([
      anchor.kind,
      anchor.kind === "diff" ? anchor.layer : "worktree",
      anchor.path,
    ]);
    const group = groups.get(key) ?? [];
    group.push(anchor);
    groups.set(key, group);
  }
  const matches = new Set<string>();
  let stale = false;
  const tasks = [...groups.values()];
  let next = 0;
  async function check(group: CommentAnchor[]): Promise<void> {
    const first = group[0];
    if (first === undefined) return;
    if (first.kind === "file") {
      if (mediaTypeForPath(first.path) !== null) return;
      const source = await workingSource(first.path);
      if (source.kind === "stale") stale = true;
      if (source.kind !== "text") return;
      if (parseSourceText(Buffer.from(source.text)).kind !== "text") return;
      const lines = sourceLines(source.text.replaceAll("\r\n", "\n"));
      for (const anchor of group)
        if (sourceMatches(lines, anchor)) matches.add(feedbackAnchorKey(anchor));
      return;
    }
    const entry = entries.find((entry) => entry.layer === first.layer && entry.path === first.path);
    if (entry === undefined || entry.isSubmodule) return;
    const anchors = group.filter((anchor): anchor is DiffCommentAnchor => anchor.kind === "diff");
    if (
      entry.layer !== "untracked" &&
      mediaTypeForPath(entry.path) === null &&
      mediaTypeForPath(entry.oldPath ?? entry.path) === null
    ) {
      let patchReserved = false;
      const patch = await reads.patch(root, project, entry, (bytes) => {
        patchReserved = true;
        reserve(bytes.byteLength);
        return parseGitPatchHunks(bytes);
      });
      ensureActive();
      if (patch.kind === "too_large" && !patchReserved) reserve(2 * 1024 * 1024 + 1024);
      if (patch.kind === "stale") stale = true;
      for (const key of patchMatches(patch, anchors)) matches.add(key);
    }
    const missing = anchors.filter((anchor) => !matches.has(feedbackAnchorKey(anchor)));
    for (const side of ["old", "new"] as const) {
      const onSide = missing.filter((anchor) => anchor.side === side);
      if (onSide.length === 0) continue;
      const source = await diffSource(entry, side);
      if (source.kind === "stale" || source.kind === "missing") stale = true;
      if (source.kind === "limit")
        throw new AppError(
          "invalid_request",
          413,
          `Could not check ${JSON.stringify(first.path)}. Its source exceeds the check limit. Retry before copying.`,
        );
      if (source.kind !== "text") continue;
      const lines = sourceLines(source.text);
      for (const anchor of onSide)
        if (sourceMatches(lines, anchor)) matches.add(feedbackAnchorKey(anchor));
    }
  }
  let failed = false;
  async function worker(): Promise<void> {
    while (!signal.aborted && !failed) {
      const group = tasks[next++];
      if (group === undefined) return;
      try {
        ensureActive();
        await check(group);
      } catch (error: unknown) {
        failed = true;
        if (error instanceof AppError)
          throw new AppError(
            error.code,
            error.status,
            `Could not check ${JSON.stringify(group[0]?.path)}. ${error.message}`,
          );
        throw error;
      }
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(3, tasks.length) }, () => worker()),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;
  ensureActive();
  const afterInventory = hasDiff ? await reads.inventory(project.absolutePath) : null;
  ensureActive();
  const after = await reads.versions(project.absolutePath, mutablePaths);
  ensureActive();
  if (
    stale ||
    before !== after ||
    inventory?.kind !== afterInventory?.kind ||
    (inventory?.kind === "git" &&
      afterInventory?.kind === "git" &&
      inventory.revision !== afterInventory.revision)
  )
    return { kind: "stale" };
  return {
    kind: "checked",
    matches: request.anchors.map((anchor) => matches.has(feedbackAnchorKey(anchor))),
  };
}
