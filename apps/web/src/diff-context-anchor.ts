import type { DiffContextLine } from "@git-review/shared/diff-context";
import type { ChangeLayer } from "@git-review/shared/api";
import type { DiffCommentAnchor, ReviewSide } from "./comments.ts";

export function anchorForContextLine(
  layer: ChangeLayer,
  path: string,
  line: DiffContextLine,
  side: ReviewSide,
): DiffCommentAnchor | null {
  const neighbors = line.neighbors[side];
  if (layer === "conflict" || neighbors.kind !== "available") return null;
  if (
    ![line.text, neighbors.before, neighbors.after].every(
      (text) => text === null || (text.length <= 20_000 && !text.includes("\0")),
    )
  )
    return null;
  return {
    kind: "diff",
    layer,
    path,
    side,
    line: side === "old" ? line.oldLine : line.newLine,
    sourceText: line.text,
    before: neighbors.before,
    after: neighbors.after,
  };
}
