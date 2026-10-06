import { describe, expect, test } from "bun:test";
import type { DiffResult } from "../shared/api.ts";
import {
  anchorForLine,
  anchorMatches,
  emptyCommentStore,
  formatFeedback,
  maxDrafts,
  maxFeedbackLength,
  mergeCheckedComments,
  parseCommentStore,
  recordSuccessfulCopy,
  snapshotFeedback,
  undoSuccessfulCopy,
  validateCommentStore,
  type CheckedComments,
  type CommentAnchor,
  type DraftComment,
  type DiffCommentAnchor,
} from "./comments.ts";

const diff: DiffResult = {
  kind: "text",
  syntax: { kind: "plain", reason: "selected" },
  hunks: [
    {
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 2,
      lines: [
        {
          kind: "context",
          oldLine: 1,
          newLine: 1,
          text: "before",
          tokens: [{ text: "before", role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        },
        {
          kind: "removed",
          oldLine: 2,
          newLine: null,
          text: "old",
          tokens: [{ text: "old", role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        },
        {
          kind: "added",
          oldLine: null,
          newLine: 2,
          text: "new",
          tokens: [{ text: "new", role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        },
      ],
    },
  ],
};

function draft(
  id: string,
  side: "old" | "new",
  index: number,
): DraftComment & { anchor: DiffCommentAnchor } {
  if (diff.kind !== "text") throw new Error("Expected text fixture");
  const anchor = anchorForLine("unstaged", "src/name\tfile.ts", diff.hunks[0]!, index, side);
  if (anchor === null) throw new Error("Expected anchor");
  return {
    id,
    anchor,
    subject: { kind: "line" },
    body: "Change this\nthen check it",
    createdAt: 1,
    updatedAt: 1,
    state: "current",
  };
}

describe("review feedback", () => {
  test("reviewable layers preserve both sides while conflicts cannot create anchors", () => {
    const hunk = diff.hunks[0];
    if (hunk === undefined) throw new Error("Missing anchor fixture hunk");
    for (const side of ["old", "new"] as const) {
      for (const layer of ["staged", "unstaged", "untracked"] as const) {
        expect(anchorForLine(layer, "x", hunk, 0, side)).toEqual({
          kind: "diff",
          layer,
          path: "x",
          side,
          line: 1,
          sourceText: "before",
          before: null,
          after: side === "old" ? "old" : null,
        });
      }
      expect(anchorForLine("conflict", "x", hunk, 0, side)).toBeNull();
    }
  });

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
    expect(formatFeedback("/repo", [next, old])).toBe(
      'Review feedback for "/repo"\n\n[unstaged] "src/name\\tfile.ts"\n  old line 2  "old"\n    Change this\n    then check it',
    );
  });

  test("the same path has separate staged, unstaged and untracked export sections in order", () => {
    const stagedDraft = draft("staged", "new", 2);
    const staged = { ...stagedDraft, anchor: { ...stagedDraft.anchor, layer: "staged" as const } };
    const unstaged = draft("unstaged", "old", 1);
    const untrackedDraft = draft("untracked", "new", 2);
    const untracked = {
      ...untrackedDraft,
      anchor: { ...untrackedDraft.anchor, layer: "untracked" as const },
    };
    const text = formatFeedback("/repo", [untracked, unstaged, staged]);
    expect(text.match(/\[staged\]/g)).toHaveLength(1);
    expect(text.match(/\[unstaged\]/g)).toHaveLength(1);
    expect(text.match(/\[untracked\]/g)).toHaveLength(1);
    expect(text.indexOf("[staged]")).toBeLessThan(text.indexOf("[unstaged]"));
    expect(text.indexOf("[unstaged]")).toBeLessThan(text.indexOf("[untracked]"));
  });

  test("all reviewable layers round-trip through version-two drafts and history", () => {
    const drafts = (["staged", "unstaged", "untracked"] as const).map((layer) => {
      const original = draft(layer, "new", 2);
      return { ...original, anchor: { ...original.anchor, layer } };
    });
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts,
      history: [
        { id: "copy", copiedAt: 2, text: formatFeedback("/repo", drafts), comments: drafts },
      ],
    };
    const persisted: unknown = JSON.parse(JSON.stringify(store));
    expect(validateCommentStore(persisted, "/repo/project")).toEqual(store);
    expect(parseCommentStore(persisted, "/repo/project")).toEqual(store);
  });

  test("invalid layers in drafts or history reject the whole persisted store", () => {
    const valid = draft("valid", "new", 2);
    const original = draft("invalid", "old", 1);
    for (const layer of ["conflict", "unknown", null]) {
      const invalid = { ...original, anchor: { ...original.anchor, layer } };
      const stores = [
        { ...emptyCommentStore("/repo/project"), drafts: [valid, invalid] },
        {
          ...emptyCommentStore("/repo/project"),
          drafts: [valid],
          history: [
            { id: "copy", copiedAt: 2, text: "Previous feedback", comments: [valid, invalid] },
          ],
        },
      ];
      for (const store of stores) {
        expect(validateCommentStore(store, "/repo/project")).toBeNull();
        expect(parseCommentStore(store, "/repo/project")).toEqual(
          emptyCommentStore("/repo/project"),
        );
      }
    }
  });

  test("storage rejects malformed and oversized records instead of importing partial state", () => {
    const store = { ...emptyCommentStore("/repo/project"), drafts: [draft("one", "old", 1)] };
    expect(parseCommentStore(store, "/repo/project").drafts).toHaveLength(1);
    expect(
      parseCommentStore({ ...store, drafts: [{ ...store.drafts[0], body: " " }] }, "/repo/project")
        .drafts,
    ).toHaveLength(0);
    expect(
      parseCommentStore({ ...store, drafts: Array(201).fill(store.drafts[0]) }, "/repo/project")
        .drafts,
    ).toHaveLength(0);
    expect(parseCommentStore(store, "other").drafts).toHaveLength(0);
  });

  test("a successful copy snapshots only current comments and keeps outdated drafts", () => {
    const current = draft("one", "old", 1);
    const outdated = { ...draft("two", "new", 2), state: "outdated" as const };
    const store = { ...emptyCommentStore("/repo/project"), drafts: [current, outdated] };
    const copied = recordSuccessfulCopy(
      store,
      snapshotFeedback("/repo", store, store),
      4,
      "copy-id",
    );
    expect(copied.drafts.map((item) => item.id)).toEqual(["two"]);
    expect(copied.history[0]?.comments.map((item) => item.id)).toEqual(["one"]);
    expect(store.drafts).toHaveLength(2);
  });

  test("checking merges validity while preserving current bodies, additions, deletions and history", () => {
    const original = draft("one", "old", 1);
    const deleted = draft("deleted", "new", 2);
    const reattached = draft("reattached", "new", 2);
    const checked: CheckedComments = {
      projectPath: "/repo/project",
      drafts: [original, deleted, reattached].map((item) => ({ ...item, state: "outdated" })),
    };
    const edited = { ...original, body: "New body", updatedAt: 2 };
    const moved = { ...reattached, anchor: { ...reattached.anchor, line: 3 }, updatedAt: 2 };
    const added = draft("added", "old", 1);
    const history = [{ id: "history", copiedAt: 2, text: "Previous copy", comments: [original] }];
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts: [edited, moved, added],
      history,
    };
    const merged = mergeCheckedComments(store, checked);
    expect(merged.drafts).toEqual([{ ...edited, state: "outdated" }, moved, added]);
    expect(merged.history).toEqual(history);
    expect(mergeCheckedComments(store, { ...checked, projectPath: "other" })).toBe(store);
  });

  test("copy snapshots include only checked anchors and isolate the exported values", () => {
    const original = draft("one", "old", 1);
    const moved = draft("moved", "new", 2);
    const added = draft("added", "new", 2);
    const checked: CheckedComments = { projectPath: "/repo/project", drafts: [original, moved] };
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts: [
        { ...original, body: "Latest body" },
        { ...moved, anchor: { ...moved.anchor, line: 7 } },
        added,
      ],
    };
    const snapshot = snapshotFeedback("/repo", store, checked);
    expect(snapshot.drafts.map((item) => item.id)).toEqual(["one"]);
    expect(snapshot.text).toContain("Latest body");
    const first = store.drafts[0];
    if (first === undefined) throw new Error("Expected a draft fixture");
    first.body = "Later mutation";
    first.anchor.sourceText = "Later source";
    expect(snapshot.drafts[0]?.body).toBe("Latest body");
    expect(snapshot.drafts[0]?.anchor.sourceText).toBe("old");
    expect(snapshotFeedback("/repo", store, { ...checked, projectPath: "other" }).text).toBe("");
  });

  test("copy removes only the full exported version and retains every changed anchor field", () => {
    const original = draft("one", "old", 1);
    const initial = { ...emptyCommentStore("/repo/project"), drafts: [original] };
    const snapshot = snapshotFeedback("/repo", initial, initial);
    const changedAnchors: CommentAnchor[] = [
      { ...original.anchor, layer: "staged" },
      { ...original.anchor, path: "other.ts" },
      { ...original.anchor, side: "new" },
      { ...original.anchor, line: 9 },
      { ...original.anchor, sourceText: "Changed" },
      { ...original.anchor, before: "Changed" },
      { ...original.anchor, after: "Changed" },
    ];
    const changedVersions: DraftComment[] = [
      ...changedAnchors.map((anchor) => ({ ...original, anchor })),
      { ...original, body: "Changed body" },
      { ...original, createdAt: 0 },
      { ...original, updatedAt: 2 },
      { ...original, state: "outdated" },
    ];
    for (const changed of changedVersions) {
      const copied = recordSuccessfulCopy({ ...initial, drafts: [changed] }, snapshot, 4, "copy");
      expect(copied.drafts).toEqual([changed]);
      expect(copied.history[0]?.comments).toEqual([original]);
    }
    expect(recordSuccessfulCopy(initial, snapshot, 4, "copy").drafts).toEqual([]);
    const other = emptyCommentStore("other");
    expect(recordSuccessfulCopy(other, snapshot, 4, "copy")).toBe(other);
  });

  test("copy appends to current history with its bound and preserves version-two reload", () => {
    const original = draft("one", "old", 1);
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts: [original],
      history: Array.from({ length: 20 }, (_, index) => ({
        id: `history-${index}`,
        copiedAt: index + 1,
        text: `copy ${index}`,
        comments: [original],
      })),
    };
    const copied = recordSuccessfulCopy(
      store,
      snapshotFeedback("/repo", store, store),
      30,
      "latest",
    );
    expect(copied.history).toHaveLength(20);
    expect(copied.history.map((item) => item.id)).toEqual([
      "latest",
      ...store.history.slice(0, 19).map((item) => item.id),
    ]);
    expect(
      parseCommentStore(JSON.parse(JSON.stringify(copied)) as unknown, "/repo/project"),
    ).toEqual(copied);
  });

  test("the history text boundary accepts its limit and refuses overflow without clearing drafts", () => {
    const store = { ...emptyCommentStore("/repo/project"), drafts: [draft("one", "old", 1)] };
    const snapshot = snapshotFeedback("/repo", store, store);
    const bounded = { ...snapshot, text: "x".repeat(maxFeedbackLength) };
    const copied = recordSuccessfulCopy(store, bounded, 2, "copy");
    expect(copied.drafts).toEqual([]);
    expect(
      parseCommentStore(JSON.parse(JSON.stringify(copied)) as unknown, "/repo/project"),
    ).toEqual(copied);
    expect(recordSuccessfulCopy(store, { ...bounded, text: `${bounded.text}x` }, 2, "copy")).toBe(
      store,
    );
  });

  test("Undo restores only missing IDs and never replaces a newer draft", () => {
    const original = draft("one", "old", 1);
    const newer = { ...original, body: "Newer body", updatedAt: 3 };
    const missing = draft("missing", "new", 2);
    const olderEntry = { id: "older", copiedAt: 1, text: "Older copy", comments: [original] };
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts: [newer],
      history: [
        { id: "last-copy", copiedAt: 2, text: "Last copy", comments: [original, missing] },
        olderEntry,
      ],
    };
    expect(undoSuccessfulCopy(store, "older")).toBe(store);
    const restored = undoSuccessfulCopy(store, "last-copy");
    expect(restored.drafts).toEqual([newer, missing]);
    expect(restored.history).toEqual([olderEntry]);
    expect(store.drafts).toEqual([newer]);
  });

  test("Undo refuses an oversized restore atomically and remains available after space is freed", () => {
    const missing = [draft("restore-one", "old", 1), draft("restore-two", "new", 2)];
    const store = {
      ...emptyCommentStore("/repo/project"),
      drafts: Array.from({ length: maxDrafts - 1 }, (_, index) =>
        draft(`present-${index}`, "old", 1),
      ),
      history: [{ id: "last-copy", copiedAt: 2, text: "Last copy", comments: missing }],
    };
    expect(undoSuccessfulCopy(store, "last-copy")).toBe(store);
    expect(store.history).toHaveLength(1);
    const freed = { ...store, drafts: store.drafts.slice(1) };
    const restored = undoSuccessfulCopy(freed, "last-copy");
    expect(restored.drafts).toHaveLength(maxDrafts);
    expect(restored.drafts.slice(-2)).toEqual(missing);
    expect(restored.history).toEqual([]);
    expect(
      parseCommentStore(JSON.parse(JSON.stringify(restored)) as unknown, "/repo/project"),
    ).toEqual(restored);
  });
});
