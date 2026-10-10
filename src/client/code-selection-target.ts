import {
  rangeSubject,
  selectionSubject,
  type CommentAnchor,
  type CommentTarget,
  type FileCommentAnchor,
  type DiffCommentAnchor,
  type RangeSelectionPart,
  type ReviewSide,
} from "./comments.ts";
import {
  maxFeedbackRangeLines,
  maxFeedbackRangeText,
  sameCommentSource,
} from "../shared/feedback-check.ts";

export type SelectionSourceRow = { text: string } & (
  | { kind: "file"; anchor: FileCommentAnchor | null }
  | {
      kind: "diff";
      anchor: DiffCommentAnchor | null;
      preferredSide: ReviewSide;
      lineKind: "context" | "added" | "removed";
      anchors: Record<ReviewSide, DiffCommentAnchor | null>;
    }
  | { kind: "inspect"; anchor: null }
);
export type SelectionComment =
  { kind: "target"; target: CommentTarget } | { kind: "unavailable"; reason: string };
const unavailable = (reason: string): SelectionComment => ({ kind: "unavailable", reason });
const limitReason = `Select at most ${maxFeedbackRangeLines} source lines and ${maxFeedbackRangeText.toLocaleString()} characters.`;

function rangeSides(
  first: Exclude<SelectionSourceRow, { kind: "inspect" }>,
  rows: readonly SelectionSourceRow[],
): readonly (ReviewSide | null)[] {
  if (first.kind === "file") return [null];
  const removed = rows.some((row) => row.kind === "diff" && row.lineKind === "removed");
  const added = rows.some((row) => row.kind === "diff" && row.lineKind === "added");
  if (removed && added) return ["old", "new"];
  if (removed) return ["old"];
  if (added) return ["new"];
  return [first.preferredSide];
}

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
  if (rows.length > maxFeedbackRangeLines) return unavailable(limitReason);
  if (rows.some((row) => row.kind !== first.kind) || first.kind === "inspect")
    return unavailable("Select consecutive lines in one source view.");
  const parts: RangeSelectionPart[] = [];
  let count = 0;
  let characters = 0;
  for (const side of rangeSides(first, rows)) {
    const selected = rows.flatMap<{
      row: SelectionSourceRow;
      index: number;
      anchor: CommentAnchor | null;
    }>((row, index) => {
      if (side === null && row.kind === "file") return [{ row, index, anchor: row.anchor }];
      if (
        side !== null &&
        row.kind === "diff" &&
        (row.lineKind === "context" || row.lineKind === (side === "old" ? "removed" : "added"))
      )
        return [{ row, index, anchor: row.anchors[side] }];
      return [];
    });
    const anchors: CommentAnchor[] = [];
    for (const item of selected) {
      if (item.anchor === null)
        return unavailable("A source line is too long to save. Select a smaller range.");
      const head = anchors[0];
      if (
        head !== undefined &&
        (!sameCommentSource(head, item.anchor) || item.anchor.line !== head.line + anchors.length)
      )
        return unavailable("Select consecutive source lines. Reveal hidden context first.");
      anchors.push(item.anchor);
    }
    const head = selected[0];
    const tail = selected.at(-1);
    if (head === undefined || tail === undefined)
      return unavailable("Select consecutive lines in one source view.");
    const source = selected.map((item) => item.row.text).join("\n");
    count += anchors.length;
    characters += source.length;
    if (count > maxFeedbackRangeLines || characters > maxFeedbackRangeText)
      return unavailable(limitReason);
    const from = head.index === 0 ? start : 0;
    const to =
      source.length -
      tail.row.text.length +
      (tail.index === rows.length - 1 ? end : tail.row.text.length);
    parts.push({ anchors, start: from, end: to, text: source.slice(from, to) });
  }
  const subject = rangeSubject(parts);
  const anchor = subject?.parts[0]?.anchors[0];
  return subject === null || anchor === undefined
    ? unavailable("Select complete characters within one source range.")
    : { kind: "target", target: { anchor, subject } };
}
