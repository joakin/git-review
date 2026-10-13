import { createHash } from "node:crypto";
import type { DiffResult } from "@git-review/shared/api";
import {
  contextGaps,
  maxContextAnchorText,
  type ContextNeighbors,
  type DiffContextLine,
  type DiffContextMetadata,
} from "@git-review/shared/diff-context";

export type TextDiff = Extract<DiffResult, { kind: "text" }>;
export type ContextContent = {
  metadata: Extract<DiffContextMetadata, { kind: "available" }>;
  old: string[];
  next: string[];
  oldFinalNewline: boolean;
  newFinalNewline: boolean;
};

export function sourceLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** Validate the patch and every omitted interval against exact, unnormalized source sides. */
export function diffContextContent(
  diff: TextDiff,
  oldText: string,
  newText: string,
): ContextContent {
  const old = sourceLines(oldText);
  const next = sourceLines(newText);
  for (const hunk of diff.hunks) {
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind !== "added") {
        if (
          line.oldLine !== oldNumber ||
          old[oldNumber - 1] !== line.text ||
          line.noNewlineAtEnd !== (oldNumber === old.length && !oldText.endsWith("\n"))
        )
          throw new Error("Old diff rows do not match source");
        oldNumber += 1;
      }
      if (line.kind !== "removed") {
        if (
          line.newLine !== newNumber ||
          next[newNumber - 1] !== line.text ||
          line.noNewlineAtEnd !== (newNumber === next.length && !newText.endsWith("\n"))
        )
          throw new Error("New diff rows do not match source");
        newNumber += 1;
      }
      if (
        (line.kind === "added" && line.oldLine !== null) ||
        (line.kind === "removed" && line.newLine !== null)
      )
        throw new Error("Invalid diff side");
    }
  }
  const gaps = contextGaps(diff.hunks, old.length, next.length);
  for (const gap of gaps) {
    for (let offset = 0; offset < gap.count; offset += 1) {
      if (old[gap.oldStart + offset - 1] !== next[gap.newStart + offset - 1])
        throw new Error("Diff gap is not unchanged");
    }
  }
  const canonical = diff.hunks.map((hunk) => [
    hunk.oldStart,
    hunk.oldCount,
    hunk.newStart,
    hunk.newCount,
    hunk.lines.map((line) => [
      line.kind,
      line.oldLine,
      line.newLine,
      line.text,
      line.noNewlineAtEnd,
    ]),
  ]);
  const source = createHash("sha256")
    .update(JSON.stringify([oldText, newText, canonical]))
    .digest("hex");
  return {
    metadata: { kind: "available", source, oldLines: old.length, newLines: next.length, gaps },
    old,
    next,
    oldFinalNewline: oldText.endsWith("\n"),
    newFinalNewline: newText.endsWith("\n"),
  };
}

function neighbors(lines: readonly string[], number: number, text: string): ContextNeighbors {
  const before = lines[number - 2] ?? null;
  const after = lines[number] ?? null;
  if ([text, before, after].some((value) => value !== null && value.length > maxContextAnchorText))
    return { kind: "unavailable" };
  return { kind: "available", before, after };
}

export function contextLines(
  content: ContextContent,
  gapId: number,
  offset: number,
  count: number,
): DiffContextLine[] {
  const gap = content.metadata.gaps.find((candidate) => candidate.id === gapId);
  if (gap === undefined || offset < 0 || count < 1 || offset + count > gap.count)
    throw new Error("Invalid context slice");
  return Array.from({ length: count }, (_, index): DiffContextLine => {
    const oldLine = gap.oldStart + offset + index;
    const newLine = gap.newStart + offset + index;
    const text = content.next[newLine - 1];
    if (text === undefined) throw new Error("Missing context source");
    // A gap's immediate neighbors at its ends can be changed, and differ between Old and New.
    return {
      kind: "context",
      oldLine,
      newLine,
      text,
      tokens: [{ text, role: "plain" }],
      detail: { kind: "none" },
      noNewlineAtEnd: newLine === content.next.length && !content.newFinalNewline,
      neighbors: {
        old: neighbors(content.old, oldLine, text),
        new: neighbors(content.next, newLine, text),
      },
    };
  });
}
