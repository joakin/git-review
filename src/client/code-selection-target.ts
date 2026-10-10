import {
  rangeSubject,
  selectionSubject,
  type CommentAnchor,
  type CommentTarget,
} from "./comments.ts";
import {
  maxFeedbackRangeLines,
  maxFeedbackRangeText,
  sameCommentSource,
} from "../shared/feedback-check.ts";

export type SelectionSourceRow = { text: string; anchor: CommentAnchor | null };
export type SelectionComment =
  { kind: "target"; target: CommentTarget } | { kind: "unavailable"; reason: string };

/** DOM controls never contribute to the selected source fragment. */
export function selectionComment(
  rows: readonly SelectionSourceRow[],
  start: number,
  end: number,
): SelectionComment | null {
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return null;
  const full = rows.map((row) => row.text).join("\n");
  const stop = full.length - last.text.length + end;
  if (full.slice(start, stop).trim().length === 0) return null;
  if (rows.length === 1) {
    const subject = selectionSubject(first.text, start, end);
    return subject !== null && first.anchor !== null
      ? { kind: "target", target: { anchor: first.anchor, subject } }
      : null;
  }
  if (rows.length > maxFeedbackRangeLines || full.length > maxFeedbackRangeText)
    return {
      kind: "unavailable",
      reason: `Select at most ${maxFeedbackRangeLines} lines and ${maxFeedbackRangeText.toLocaleString()} characters.`,
    };
  if (first.anchor === null)
    return {
      kind: "unavailable",
      reason: "A source line is too long to save. Select a smaller range.",
    };
  if (first.anchor.kind !== "file")
    return { kind: "unavailable", reason: "Select one source line in this diff." };
  const anchors: CommentAnchor[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.anchor === null)
      return {
        kind: "unavailable",
        reason: "A source line is too long to save. Select a smaller range.",
      };
    if (
      !sameCommentSource(first.anchor, row.anchor) ||
      row.anchor.line !== first.anchor.line + index
    )
      return { kind: "unavailable", reason: "Select consecutive lines in one file." };
    anchors.push(row.anchor);
  }
  const subject = rangeSubject([{ anchors, start, end: stop, text: full.slice(start, stop) }]);
  return subject === null
    ? { kind: "unavailable", reason: "Select complete characters within the source code." }
    : { kind: "target", target: { anchor: first.anchor, subject } };
}
