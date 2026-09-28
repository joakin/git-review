import { describe, expect, test } from "bun:test";
import type { DiffResult } from "../shared/api.ts";
import { anchorForLine, anchorMatches, emptyCommentStore, formatFeedback, parseCommentStore, recordSuccessfulCopy, type DraftComment } from "./comments.ts";

const diff: DiffResult = { kind: "text", syntax: { kind: "plain", reason: "selected" }, hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, lines: [
  { kind: "context", oldLine: 1, newLine: 1, text: "before", tokens: [{ text: "before", role: "plain" }], noNewlineAtEnd: false },
  { kind: "removed", oldLine: 2, newLine: null, text: "old", tokens: [{ text: "old", role: "plain" }], noNewlineAtEnd: false },
  { kind: "added", oldLine: null, newLine: 2, text: "new", tokens: [{ text: "new", role: "plain" }], noNewlineAtEnd: false },
] }] };

function draft(id: string, side: "old" | "new", index: number): DraftComment {
  if (diff.kind !== "text") throw new Error("Expected text fixture");
  const anchor = anchorForLine("unstaged", "src/name\tfile.ts", diff.hunks[0]!, index, side);
  if (anchor === null) throw new Error("Expected anchor");
  return { id, anchor, body: "Change this\nthen check it", createdAt: 1, updatedAt: 1, state: "current" };
}

describe("review feedback", () => {
  test("anchors stay on their side and require exact text and context", () => {
    const old = draft("old", "old", 1);
    const next = draft("new", "new", 2);
    expect(anchorMatches(diff, old.anchor)).toBe(true);
    expect(anchorMatches(diff, next.anchor)).toBe(true);
    expect(anchorForLine("unstaged", "x", diff.hunks[0]!, 1, "new")).toBeNull();
    expect(anchorMatches(diff, { ...old.anchor, sourceText: "changed" })).toBe(false);
    expect(anchorMatches(diff, { ...old.anchor, before: "different" })).toBe(false);
    expect(anchorMatches(diff, { ...old.anchor, line: 3 })).toBe(false);
  });

  test("export identifies layer, path, side and line; outdated drafts are excluded", () => {
    const old = draft("old", "old", 1);
    const next = { ...draft("new", "new", 2), state: "outdated" as const };
    expect(formatFeedback("/repo", [next, old])).toBe('Review feedback for "/repo"\n\n[unstaged] "src/name\\tfile.ts"\n  old line 2  "old"\n    Change this\n    then check it');
  });

  test("the same path in staged and unstaged changes has separate export sections", () => {
    const stagedDraft = draft("staged", "new", 2);
    const staged = { ...stagedDraft, anchor: { ...stagedDraft.anchor, layer: "staged" as const } };
    const unstaged = draft("unstaged", "old", 1);
    const text = formatFeedback("/repo", [staged, unstaged]);
    expect(text.match(/\[staged\]/g)).toHaveLength(1);
    expect(text.match(/\[unstaged\]/g)).toHaveLength(1);
    expect(text.indexOf("[staged]")).toBeLessThan(text.indexOf("[unstaged]"));
  });

  test("storage rejects malformed and oversized records instead of importing partial state", () => {
    const store = { ...emptyCommentStore("project"), drafts: [draft("one", "old", 1)] };
    expect(parseCommentStore(store, "project").drafts).toHaveLength(1);
    expect(parseCommentStore({ ...store, drafts: [{ ...store.drafts[0], body: " " }] }, "project").drafts).toHaveLength(0);
    expect(parseCommentStore({ ...store, drafts: Array(201).fill(store.drafts[0]) }, "project").drafts).toHaveLength(0);
    expect(parseCommentStore(store, "other").drafts).toHaveLength(0);
  });

  test("a successful copy snapshots only current comments and keeps outdated drafts", () => {
    const current = draft("one", "old", 1);
    const outdated = { ...draft("two", "new", 2), state: "outdated" as const };
    const store = { ...emptyCommentStore("project"), drafts: [current, outdated] };
    const copied = recordSuccessfulCopy(store, "feedback", 4, "copy-id");
    expect(copied.drafts.map((item) => item.id)).toEqual(["two"]);
    expect(copied.history[0]?.comments.map((item) => item.id)).toEqual(["one"]);
    expect(store.drafts).toHaveLength(2);
  });
});
