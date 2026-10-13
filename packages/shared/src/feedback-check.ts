import { gitPath } from "./git.ts";
import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";

export const maxFeedbackCheckAnchors = 200;
export const maxFeedbackCheckBodyBytes = 8 * 1024 * 1024;
export const maxFeedbackAnchorText = 20_000;
export const maxFeedbackRangeLines = 200;
export const maxFeedbackRangeText = 40_000;
export const maxFeedbackCheckLines = 4000;

type LineContext = {
  path: string;
  line: number;
  sourceText: string;
  before: string | null;
  after: string | null;
};
export type DiffCommentAnchor = LineContext & {
  kind: "diff";
  layer: "staged" | "unstaged" | "untracked";
  side: "old" | "new";
};
export type FileCommentAnchor = LineContext & { kind: "file"; source: "worktree" };
export type CommentAnchor = DiffCommentAnchor | FileCommentAnchor;
export type RangeCommentAnchor = { kind: "range"; parts: CommentAnchor[][] };
export type FeedbackAnchor = CommentAnchor | RangeCommentAnchor;
export type FeedbackCheckRequest = { anchors: FeedbackAnchor[] };
export type FeedbackCheckResponse = { kind: "checked"; matches: boolean[] } | { kind: "stale" };

function text(value: unknown): string {
  const result = expectString(value, "anchor text");
  if (result.length > maxFeedbackAnchorText || result.includes("\n") || result.includes("\0"))
    throw new Error("Invalid anchor text");
  return result;
}

export function parseCommentAnchor(value: unknown): CommentAnchor {
  const anchor = expectRecord(value, "feedback anchor");
  const keys = ["kind", "path", "line", "sourceText", "before", "after"];
  const line = expectNonNegativeInteger(anchor["line"], "anchor line");
  if (line === 0) throw new Error("Invalid anchor line");
  const common = {
    path: gitPath(anchor["path"]),
    line,
    sourceText: text(anchor["sourceText"]),
    before: anchor["before"] === null ? null : text(anchor["before"]),
    after: anchor["after"] === null ? null : text(anchor["after"]),
  };
  if (common.path === "") throw new Error("Expected a source path");
  if (anchor["kind"] === "file") {
    if (
      anchor["source"] !== "worktree" ||
      Object.keys(anchor).some((key) => ![...keys, "source"].includes(key))
    )
      throw new Error("Invalid file anchor");
    return { kind: "file", source: "worktree", ...common };
  }
  const layer = anchor["layer"];
  const side = anchor["side"];
  if (
    anchor["kind"] !== "diff" ||
    (layer !== "staged" && layer !== "unstaged" && layer !== "untracked") ||
    (side !== "old" && side !== "new") ||
    Object.keys(anchor).some((key) => ![...keys, "layer", "side"].includes(key))
  )
    throw new Error("Invalid diff anchor");
  return { kind: "diff", layer, side, ...common };
}

export function sameCommentSource(first: CommentAnchor, second: CommentAnchor): boolean {
  return (
    first.kind === second.kind &&
    first.path === second.path &&
    (first.kind === "file" || (second.kind === "diff" && first.layer === second.layer))
  );
}

export function parseRangeCommentAnchor(value: unknown): RangeCommentAnchor {
  const raw = expectRecord(value, "range anchor");
  const parts = raw["parts"];
  if (
    raw["kind"] !== "range" ||
    Object.keys(raw).some((key) => key !== "kind" && key !== "parts") ||
    !Array.isArray(parts) ||
    parts.length < 1 ||
    parts.length > 2
  )
    throw new Error("Expected one source range or an Old/New pair");
  let count = 0;
  let characters = 0;
  const parsed = parts.map((part: unknown): CommentAnchor[] => {
    if (!Array.isArray(part) || part.length === 0 || part.length > maxFeedbackRangeLines)
      throw new Error("Expected bounded range lines");
    const lines = part.map(parseCommentAnchor);
    const first = lines[0];
    if (first === undefined) throw new Error("Expected range source");
    for (const [index, line] of lines.entries()) {
      if (
        !sameCommentSource(first, line) ||
        line.line !== first.line + index ||
        (first.kind === "diff" && (line.kind !== "diff" || first.side !== line.side))
      )
        throw new Error("Range lines must be consecutive and belong to one source side");
      characters += line.sourceText.length + (index === 0 ? 0 : 1);
      count += 1;
    }
    return lines;
  });
  const first = parsed[0]?.[0];
  const second = parsed[1]?.[0];
  if (count < 2 || count > maxFeedbackRangeLines || characters > maxFeedbackRangeText)
    throw new Error("The selected range exceeds the saved-source limit");
  if (
    second !== undefined &&
    (first?.kind !== "diff" ||
      second.kind !== "diff" ||
      !sameCommentSource(first, second) ||
      first.side !== "old" ||
      second.side !== "new")
  )
    throw new Error("Expected matching Old and New ranges");
  return { kind: "range", parts: parsed };
}

export function feedbackLineAnchors(anchor: FeedbackAnchor): CommentAnchor[] {
  return anchor.kind === "range" ? anchor.parts.flat() : [anchor];
}

export function parseFeedbackCheckRequest(value: unknown): FeedbackCheckRequest {
  const outer = expectRecord(value, "feedback check");
  if (Object.keys(outer).some((key) => key !== "anchors"))
    throw new Error("Unexpected check field");
  const raw = outer["anchors"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxFeedbackCheckAnchors)
    throw new Error("Expected bounded feedback anchors");
  const anchors = raw.map((value: unknown): FeedbackAnchor =>
    expectRecord(value, "feedback anchor")["kind"] === "range"
      ? parseRangeCommentAnchor(value)
      : parseCommentAnchor(value),
  );
  if (
    anchors.reduce((count, anchor) => count + feedbackLineAnchors(anchor).length, 0) >
    maxFeedbackCheckLines
  )
    throw new Error("Feedback contains too many source lines to check together");
  return { anchors };
}

export function feedbackAnchorKey(anchor: FeedbackAnchor): string {
  if (anchor.kind === "range")
    return JSON.stringify(["range", anchor.parts.map((part) => part.map(feedbackAnchorKey))]);
  return JSON.stringify(
    anchor.kind === "file"
      ? ["file", anchor.path, anchor.line, anchor.sourceText, anchor.before, anchor.after]
      : [
          "diff",
          anchor.layer,
          anchor.path,
          anchor.side,
          anchor.line,
          anchor.sourceText,
          anchor.before,
          anchor.after,
        ],
  );
}

export function parseFeedbackCheckResponse(value: unknown, count: number): FeedbackCheckResponse {
  const raw = expectRecord(value, "feedback check response");
  if (raw["kind"] === "stale") return { kind: "stale" };
  const matches = raw["matches"];
  if (
    raw["kind"] !== "checked" ||
    !Array.isArray(matches) ||
    matches.length !== count ||
    !matches.every((match: unknown) => typeof match === "boolean")
  )
    throw new Error("Feedback check results do not match request");
  return { kind: "checked", matches };
}
