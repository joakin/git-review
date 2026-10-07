import type { DiffHunk, DiffLine, DiffResult } from "../shared/api.ts";
import { decodedText, parseSourceText } from "./source-text.ts";
import { withWordDetails } from "./diff-words.ts";

export const maxPatchBytes = 2 * 1024 * 1024;
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
  const patch = decodedText(output, maxPatchBytes);
  if (patch === null) return { kind: "binary", reason: "binary" };
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
  const parsed = parseSourceText(content);
  if (parsed.kind !== "text") return parsed;
  const { text, hasFinalNewline } = parsed;
  if (text === "")
    return { kind: "text", syntax: { kind: "plain", reason: "unavailable" }, hunks: [] };
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
