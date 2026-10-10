import {
  commentLineAnchors,
  type DraftComment,
  type ReviewLayer,
  type ReviewSide,
} from "./comments.ts";
export type DiffDraftCounts = Record<ReviewSide, ReadonlyMap<number, ReadonlySet<string>>>;
export function diffDraftCounts(
  drafts: readonly DraftComment[],
  layer: ReviewLayer,
  path: string,
): DiffDraftCounts {
  const counts = { old: new Map<number, Set<string>>(), new: new Map<number, Set<string>>() };
  for (const draft of drafts) {
    for (const anchor of commentLineAnchors(draft)) {
      if (anchor.kind !== "diff" || anchor.layer !== layer || anchor.path !== path) continue;
      const side = counts[anchor.side];
      const ids = side.get(anchor.line) ?? new Set<string>();
      ids.add(draft.id);
      side.set(anchor.line, ids);
    }
  }
  return counts;
}
export function diffRowDraftCount(
  counts: DiffDraftCounts,
  oldLine: number | null,
  newLine: number | null,
): number {
  return new Set([
    ...(oldLine === null ? [] : (counts.old.get(oldLine) ?? [])),
    ...(newLine === null ? [] : (counts.new.get(newLine) ?? [])),
  ]).size;
}
