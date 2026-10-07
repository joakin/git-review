import type { DiffContextLine } from "../shared/diff-context.ts";
import type { ChangeLayer } from "../shared/api.ts";
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
