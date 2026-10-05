import { resolve } from "node:path";
import type { ChangeEntry, DiffHunk, DiffLine, DiffResult, Project } from "../shared/api.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import { readGitPrefix, repositoryPath } from "./git-context.ts";
import { readGitPath } from "./git-objects.ts";
import { AppError, isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { withDiffSyntax } from "./diff-syntax.ts";
import { withWordDetails } from "./diff-words.ts";
import { checkedProjectPath, withCheckedWorkingFile } from "./working-files.ts";

const maxTextBytes = 1024 * 1024;
const maxPatchBytes = 2 * 1024 * 1024;
const maxDiffLines = 20_000;
const noNewlineMarker = "\\ No newline at end of file";

type OpenHunk = DiffHunk & {
  remainingOld: number;
  remainingNew: number;
  nextOld: number;
  nextNew: number;
};
type ParsedDiff = Extract<DiffResult, { kind: "text" | "binary" | "too_large" }>;

function hunkNumber(value: string | undefined): number {
  const number = Number(value);
  if (value === undefined || !Number.isSafeInteger(number) || number < 0) {
    throw new Error("Git returned an invalid hunk line number");
  }
  return number;
}

export function parseGitPatch(output: Buffer): ParsedDiff {
  if (output.byteLength > maxPatchBytes) return { kind: "too_large" };
  let patch: string;
  try {
    patch = new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return { kind: "binary", reason: "binary" };
  }
  if (patch.includes("\0")) return { kind: "binary", reason: "binary" };
  const rows = patch.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  const hunks: DiffHunk[] = [];
  let current: OpenHunk | null = null;
  let totalLines = 0;
  let binary = false;
  let symlink = false;

  for (const row of rows) {
    if (row === noNewlineMarker) {
      const lastLine = current?.lines[current.lines.length - 1];
      if (lastLine === undefined) throw new Error("Git returned an orphaned newline marker");
      lastLine.noNewlineAtEnd = true;
      continue;
    }
    if (current !== null && current.remainingOld === 0 && current.remainingNew === 0) {
      hunks.push({
        oldStart: current.oldStart,
        oldCount: current.oldCount,
        newStart: current.newStart,
        newCount: current.newCount,
        lines: current.lines,
      });
      current = null;
    }
    if (row.startsWith("@@ ")) {
      if (current !== null) throw new Error("Git returned an incomplete hunk");
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(row);
      if (match === null) throw new Error("Git returned an invalid hunk header");
      const oldStart = hunkNumber(match[1]);
      const oldCount = hunkNumber(match[2] ?? "1");
      const newStart = hunkNumber(match[3]);
      const newCount = hunkNumber(match[4] ?? "1");
      current = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
        remainingOld: oldCount,
        remainingNew: newCount,
        nextOld: oldStart,
        nextNew: newStart,
      };
      continue;
    }
    if (current !== null) {
      const prefix = row[0];
      let line: DiffLine;
      if (prefix === " ") {
        line = {
          kind: "context",
          oldLine: current.nextOld,
          newLine: current.nextNew,
          text: row.slice(1),
          tokens: [{ text: row.slice(1), role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        };
        current.nextOld += 1;
        current.nextNew += 1;
        current.remainingOld -= 1;
        current.remainingNew -= 1;
      } else if (prefix === "-") {
        line = {
          kind: "removed",
          oldLine: current.nextOld,
          newLine: null,
          text: row.slice(1),
          tokens: [{ text: row.slice(1), role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        };
        current.nextOld += 1;
        current.remainingOld -= 1;
      } else if (prefix === "+") {
        line = {
          kind: "added",
          oldLine: null,
          newLine: current.nextNew,
          text: row.slice(1),
          tokens: [{ text: row.slice(1), role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        };
        current.nextNew += 1;
        current.remainingNew -= 1;
      } else {
        throw new Error("Git returned an invalid hunk line");
      }
      if (current.remainingOld < 0 || current.remainingNew < 0)
        throw new Error("Git returned too many hunk lines");
      current.lines.push(line);
      totalLines += 1;
      if (totalLines > maxDiffLines) return { kind: "too_large" };
      continue;
    }
    if (row.startsWith("Binary files ") || row === "GIT binary patch") binary = true;
    if (/^(?:new file mode|deleted file mode|old mode|new mode|index) .*120000(?:\s|$)/.test(row))
      symlink = true;
  }
  if (current !== null) {
    if (current.remainingOld !== 0 || current.remainingNew !== 0)
      throw new Error("Git returned an incomplete hunk");
    hunks.push({
      oldStart: current.oldStart,
      oldCount: current.oldCount,
      newStart: current.newStart,
      newCount: current.newCount,
      lines: current.lines,
    });
  }
  if (symlink) return { kind: "binary", reason: "symlink" };
  if (binary) return { kind: "binary", reason: "binary" };
  return withWordDetails({ kind: "text", syntax: { kind: "plain", reason: "unavailable" }, hunks });
}

export function diffFromContent(content: Buffer, side: "old" | "new" = "new"): ParsedDiff {
  if (content.byteLength > maxTextBytes) return { kind: "too_large" };
  if (content.includes(0)) return { kind: "binary", reason: "binary" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return { kind: "binary", reason: "binary" };
  }
  if (text === "")
    return { kind: "text", syntax: { kind: "plain", reason: "unavailable" }, hunks: [] };
  const hasFinalNewline = text.endsWith("\n");
  const sourceLines = text.split("\n");
  if (hasFinalNewline) sourceLines.pop();
  if (sourceLines.length > maxDiffLines) return { kind: "too_large" };
  const lines: DiffLine[] = sourceLines.map((source, index) => ({
    kind: side === "new" ? "added" : "removed",
    oldLine: side === "old" ? index + 1 : null,
    newLine: side === "new" ? index + 1 : null,
    text: source,
    tokens: [{ text: source, role: "plain" }],
    detail: { kind: "none" },
    noNewlineAtEnd: !hasFinalNewline && index === sourceLines.length - 1,
  }));
  return {
    kind: "text",
    syntax: { kind: "plain", reason: "unavailable" },
    hunks: [
      {
        oldStart: side === "old" ? 1 : 0,
        oldCount: side === "old" ? lines.length : 0,
        newStart: side === "new" ? 1 : 0,
        newCount: side === "new" ? lines.length : 0,
        lines,
      },
    ],
  };
}

type WorkingFile =
  | { kind: "content"; content: Buffer }
  | { kind: "binary"; reason: "binary" | "symlink" }
  | { kind: "too_large" }
  | { kind: "stale" };

async function readWorkingFile(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<WorkingFile> {
  try {
    const location = await checkedProjectPath(root, project, path);
    if (location.kind === "symlink") return { kind: "binary", reason: "symlink" };
    if (location.kind !== "file") return { kind: "binary", reason: "binary" };
    if (location.metadata.size > maxTextBytes) return { kind: "too_large" };
    return await withCheckedWorkingFile(
      root,
      project,
      path,
      async ({ file, metadata }): Promise<WorkingFile> => {
        if (metadata.size > maxTextBytes) return { kind: "too_large" };
        const content = Buffer.alloc(maxTextBytes + 1);
        let size = 0;
        while (size < content.length) {
          const { bytesRead } = await file.read(content, size, content.length - size, null);
          if (bytesRead === 0) break;
          size += bytesRead;
        }
        return { kind: "content", content: content.subarray(0, size) };
      },
    );
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "not_found") return { kind: "stale" };
    throw error;
  }
}

async function readUntrackedFile(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<DiffResult> {
  const file = await readWorkingFile(root, project, path);
  return file.kind === "content" ? diffFromContent(file.content) : file;
}

export function decodedText(content: Buffer): string | null {
  if (content.byteLength > maxTextBytes || content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

async function readBlob(
  project: Project,
  kind: "head" | "index",
  path: string,
): Promise<string | null> {
  try {
    return decodedText(await readGitPath(project.absolutePath, { kind, path }, maxTextBytes + 1));
  } catch (error: unknown) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

async function readWorkingSource(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<string | null> {
  const file = await readWorkingFile(root, project, path);
  return file.kind === "content" ? decodedText(file.content) : null;
}

async function withSyntax(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  diff: DiffResult,
  override: string | null,
): Promise<DiffResult> {
  if (diff.kind !== "text" || diff.hunks.length === 0) return diff;
  const prefix = await readGitPrefix(project.absolutePath);
  const oldPath = entry.oldPath ?? entry.path;
  const oldGitPath = repositoryPath(prefix, oldPath);
  const newGitPath = repositoryPath(prefix, entry.path);
  return withDiffSyntax(
    diff,
    entry.path,
    override,
    () =>
      oldGitPath === null || !isWithinRoot(root.realPath, resolve(project.absolutePath, oldPath))
        ? Promise.resolve(null)
        : readBlob(project, entry.layer === "staged" ? "head" : "index", oldGitPath),
    () =>
      newGitPath === null
        ? Promise.resolve(null)
        : entry.layer === "staged"
          ? readBlob(project, "index", newGitPath)
          : readWorkingSource(root, project, entry.path),
  );
}

export async function readProjectDiff(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  languageOverride: string | null = null,
): Promise<DiffResult> {
  if (entry.layer === "conflict") return { kind: "conflict" };
  if (entry.isSubmodule) return { kind: "binary", reason: "submodule" };
  if (entry.layer === "untracked")
    return withSyntax(
      root,
      project,
      entry,
      await readUntrackedFile(root, project, entry.path),
      languageOverride,
    );

  const pathspecs = [entry.path];
  if (entry.oldPath !== null) {
    const oldCandidate = resolve(project.absolutePath, entry.oldPath);
    if (isWithinRoot(root.realPath, oldCandidate) && !pathspecs.includes(entry.oldPath))
      pathspecs.push(entry.oldPath);
  }
  const args = [
    "diff",
    ...(entry.layer === "staged" ? ["--cached"] : []),
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
    "--no-prefix",
    "--find-renames",
    "--",
    ...pathspecs,
  ];
  try {
    return withSyntax(
      root,
      project,
      entry,
      parseGitPatch(await runGit(project.absolutePath, args, maxPatchBytes + 1024)),
      languageOverride,
    );
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { kind: "too_large" };
    throw error;
  }
}
