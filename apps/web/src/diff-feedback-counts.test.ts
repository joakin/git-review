import { expect, test } from "bun:test";
import { diffDraftCounts, diffRowDraftCount } from "./diff-feedback-counts.ts";
import { rangeSubject, type DiffCommentAnchor, type DraftComment } from "./comments.ts";
const anchor = (side: "old" | "new", line: number): DiffCommentAnchor => ({
  kind: "diff",
  layer: "unstaged",
  side,
  path: "example.ts",
  line,
  sourceText: line === 1 ? "shared" : "changed",
  before: null,
  after: null,
});
const old = [anchor("old", 1), anchor("old", 2)];
const next = [anchor("new", 1), anchor("new", 2)];
const subject = rangeSubject(
  [old, next].map((anchors) => ({ anchors, start: 0, end: 14, text: "shared\nchanged" })),
);
const first = old[0];
if (subject === null || first === undefined) throw new Error("Invalid fixture range");
const mixed: DraftComment = {
  id: "mixed",
  anchor: first,
  subject,
  body: "Review both",
  state: "current",
  createdAt: 1,
  updatedAt: 1,
};

test("mixed range markers cover both sides but context row actions count each draft once", () => {
  const oldNote = { ...mixed, id: "old-note", subject: { kind: "line" as const } };
  const counts = diffDraftCounts([mixed, oldNote], "unstaged", "example.ts");
  expect(counts.old.get(1)?.size).toBe(2);
  expect(counts.new.get(1)?.size).toBe(1);
  expect(counts.old.get(2)?.size).toBe(1);
  expect(counts.new.get(2)?.size).toBe(1);
  expect(diffRowDraftCount(counts, 1, 1)).toBe(2);
  expect(diffRowDraftCount(counts, 2, null)).toBe(1);
  expect(diffRowDraftCount(counts, null, 2)).toBe(1);
  expect(diffRowDraftCount(counts, null, null)).toBe(0);
});
test("diff marker identity keeps path and Git layer distinct", () => {
  expect(diffRowDraftCount(diffDraftCounts([mixed], "staged", "example.ts"), 1, 1)).toBe(0);
  expect(diffRowDraftCount(diffDraftCounts([mixed], "unstaged", "other.ts"), 1, 1)).toBe(0);
});
