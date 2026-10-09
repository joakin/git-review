import { expect, test } from "bun:test";
import {
  commentCheckAnchor,
  emptyCommentStore,
  formatFeedback,
  mergeCheckedComments,
  rangeSubject,
  rangeSourceText,
  readCommentStore,
  recordSuccessfulCopy,
  snapshotFeedback,
  undoSuccessfulCopy,
  upgradeCommentStore,
  validateCommentStore,
  commentStoragePrefix,
  previousCommentStoragePrefix,
  type CommentAnchor,
  type DiffCommentAnchor,
  type DraftComment,
  type RangeSelectionPart,
} from "./comments.ts";
import { parseFeedbackCheckRequest, feedbackAnchorKey } from "../shared/feedback-check.ts";
import { withTestStorage } from "./storage-test-support.ts";
import { createReviewBackup, parseReviewBackup } from "./backup.ts";
import { defaultAppearance, defaultCodeTypography, emptyWorkspace } from "./storage.ts";

const projectPath = "/repo/project";
function part(texts = ["\tfirst 🦊", "", "last last"]): RangeSelectionPart {
  const anchors: CommentAnchor[] = texts.map((sourceText, index) => ({
    kind: "file",
    source: "worktree",
    path: "src/range.ts",
    line: index + 1,
    sourceText,
    before: texts[index - 1] ?? null,
    after: texts[index + 1] ?? null,
  }));
  const text = texts.join("\n");
  return { anchors, start: 0, end: text.length, text };
}
function draft(parts = [part()]): DraftComment {
  const subject = rangeSubject(parts);
  const anchor = subject?.parts[0]?.anchors[0];
  if (subject === null || anchor === undefined) throw new Error("Invalid range fixture");
  return {
    id: "range",
    anchor,
    subject,
    body: "Explain this block",
    state: "current",
    createdAt: 1,
    updatedAt: 1,
  };
}
const store = (comment = draft()) => ({ ...emptyCommentStore(projectPath), drafts: [comment] });

function diffLine(line: CommentAnchor, side: "old" | "new"): DiffCommentAnchor {
  return {
    kind: "diff",
    layer: "unstaged",
    side,
    path: line.path,
    line: line.line,
    sourceText: line.sourceText,
    before: line.before,
    after: line.after,
  };
}

test("range subjects retain blank rows, endpoint whitespace, Unicode and exact repeated occurrences", () => {
  const original = part();
  expect(rangeSourceText(original)).toBe(original.text);
  expect(rangeSubject([original])?.parts[0]).toEqual(original);
  const selected = {
    ...original,
    start: 1,
    end: original.end - 5,
    text: original.text.slice(1, -5),
  };
  expect(rangeSubject([selected])?.parts[0]?.text).toBe("first 🦊\n\nlast");
  const emoji = original.text.indexOf("🦊");
  expect(
    rangeSubject([{ ...original, start: emoji + 1, text: original.text.slice(emoji + 1) }]),
  ).toBeNull();
  expect(rangeSubject([{ ...original, text: "wrong" }])).toBeNull();
  expect(rangeSubject([part([" ", "\t"])])).toBeNull();
  expect(rangeSubject([part(["one"])])).toBeNull();
  expect(
    rangeSubject([
      { ...original, end: original.text.length - 9, text: original.text.slice(0, -9) },
    ]),
  ).toBeNull();
  expect(rangeSubject([part(["x".repeat(20_000), "y".repeat(20_000)])])).toBeNull();
});

test("range anchors reject gaps, mixed sources, reversed sides and oversized collections", () => {
  const original = part();
  for (const changed of [
    { ...original.anchors[1], line: 8 },
    { ...original.anchors[1], path: "other.ts" },
    { ...original.anchors[1], kind: "diff", layer: "unstaged", side: "new" },
  ])
    expect(() =>
      parseFeedbackCheckRequest({
        anchors: [{ kind: "range", parts: [[original.anchors[0], changed, original.anchors[2]]] }],
      }),
    ).toThrow();
  expect(() =>
    parseFeedbackCheckRequest({
      anchors: [{ kind: "range", parts: [part(Array.from({ length: 201 }, () => "x")).anchors] }],
    }),
  ).toThrow();
  const old = part(["context", "before"]).anchors.map((line) => diffLine(line, "old"));
  const next = old.map((line) => ({ ...line, side: "new" }));
  expect(() =>
    parseFeedbackCheckRequest({ anchors: [{ kind: "range", parts: [next, old] }] }),
  ).toThrow();
  expect(() =>
    parseFeedbackCheckRequest({
      anchors: [
        { kind: "range", parts: [old, next.map((line) => ({ ...line, layer: "staged" }))] },
      ],
    }),
  ).toThrow();
});

test("mixed diff feedback quotes both selected sides once before one comment body", () => {
  const side = (name: "old" | "new", texts: string[]): RangeSelectionPart => {
    const base = part(texts);
    return {
      ...base,
      anchors: base.anchors.map((anchor) => diffLine(anchor, name)),
    };
  };
  const comment = draft([
    side("old", ["context", "before", "after"]),
    side("new", ["context", "replacement", "after"]),
  ]);
  const output = formatFeedback(projectPath, [comment]);
  expect(output).toContain('old lines 1–3  "context\\nbefore\\nafter"');
  expect(output).toContain('new lines 1–3  "context\\nreplacement\\nafter"');
  expect(output.split("Explain this block")).toHaveLength(2);
  expect(validateCommentStore(store(comment), projectPath)).toEqual(store(comment));
});

test("range snapshots are deep and late checks/copies preserve a changed interior anchor", () => {
  const original = draft();
  const saved = store(original);
  const checked = { projectPath, drafts: [original] };
  const snapshot = snapshotFeedback(projectPath, saved, checked);
  const changedPart = part();
  const middle = changedPart.anchors[1];
  if (middle === undefined) throw new Error("Missing middle fixture");
  middle.after = "changed neighbor";
  const changed = draft([changedPart]);
  expect(feedbackAnchorKey(commentCheckAnchor(changed))).not.toBe(
    feedbackAnchorKey(commentCheckAnchor(original)),
  );
  expect(
    mergeCheckedComments(store(changed), {
      projectPath,
      drafts: [{ ...original, state: "outdated" }],
    }).drafts,
  ).toEqual([changed]);
  expect(snapshotFeedback(projectPath, store(changed), checked).drafts).toEqual([]);
  expect(recordSuccessfulCopy(store(changed), snapshot, 2, "copy").drafts).toEqual([changed]);
  if (original.subject.kind !== "range") throw new Error("Missing range subject");
  original.subject.parts[0]?.anchors.splice(1, 1);
  const copied = snapshot.drafts[0];
  expect(copied?.subject.kind === "range" ? copied.subject.parts[0]?.anchors.length : 0).toBe(3);
  const archived = recordSuccessfulCopy(store(copied), snapshot, 2, "copy");
  expect(archived.drafts).toEqual([]);
  expect(undoSuccessfulCopy(archived, "copy").drafts).toEqual(snapshot.drafts);
});

test("current range stores reject mismatched leading anchors and forged fragments atomically", () => {
  const original = draft();
  expect(
    validateCommentStore(
      { ...store(), drafts: [{ ...original, anchor: { ...original.anchor, line: 2 } }] },
      projectPath,
    ),
  ).toBeNull();
  expect(upgradeCommentStore({ ...store(), version: 4 }, projectPath)).toBeNull();
  if (original.subject.kind !== "range") throw new Error("Missing range subject");
  const invalid = {
    ...original,
    subject: { ...original.subject, parts: [{ ...original.subject.parts[0], text: "forged" }] },
  };
  expect(
    validateCommentStore(
      { ...store(), history: [{ id: "copy", copiedAt: 2, text: "Exact", comments: [invalid] }] },
      projectPath,
    ),
  ).toBeNull();
});

test("conversion preserves current drafts/history and protects the new namespace from older tabs", () => {
  const line = { ...draft(), subject: { kind: "line" } as const };
  const previous = {
    ...store(line),
    version: 4,
    history: [{ id: "copy", copiedAt: 2, text: "Exact archived text  \n", comments: [line] }],
  };
  withTestStorage((local) => {
    const oldKey = previousCommentStoragePrefix + encodeURIComponent(projectPath);
    const newKey = commentStoragePrefix + encodeURIComponent(projectPath);
    local.setItem(oldKey, JSON.stringify(previous));
    const converted = readCommentStore(projectPath);
    expect(converted).toEqual({ ...previous, version: 5 });
    expect(local.getItem(newKey)).toBe(JSON.stringify(converted));
    expect(local.getItem(oldKey)).toBeNull();
    local.setItem(oldKey, JSON.stringify({ ...previous, drafts: [] }));
    expect(readCommentStore(projectPath)).toEqual(converted);
    expect(createReviewBackup("/repo").comments).toEqual([converted]);
  });
  withTestStorage((local) => {
    const oldKey = previousCommentStoragePrefix + encodeURIComponent(projectPath);
    local.setItem(oldKey, JSON.stringify(previous));
    local.setItem = () => {
      throw new Error("Quota");
    };
    expect(readCommentStore(projectPath)).toEqual({ ...previous, version: 5 });
    expect(local.getItem(oldKey)).toBe(JSON.stringify(previous));
  });
  withTestStorage((local) => {
    local.setItem(
      previousCommentStoragePrefix + encodeURIComponent(projectPath),
      JSON.stringify(previous),
    );
    local.removeItem = () => {
      throw new Error("Denied cleanup");
    };
    expect(readCommentStore(projectPath)).toEqual({ ...previous, version: 5 });
  });
});

test("backup six converts only today's validated stores and retains exact copied history", () => {
  const line = { ...draft(), subject: { kind: "line" } as const };
  const previous = {
    ...store(line),
    version: 4,
    history: [{ id: "copy", copiedAt: 2, text: "Exact  \n", comments: [line] }],
  };
  const backup = {
    version: 6,
    rootPath: "/repo",
    workspace: emptyWorkspace("/repo"),
    wrap: true,
    comments: [previous],
    openCards: [],
    languages: [],
    codeTypography: defaultCodeTypography,
    appearance: defaultAppearance,
  };
  const converted = parseReviewBackup(backup, "/repo");
  expect(converted.version).toBe(7);
  expect(converted.comments).toEqual([{ ...previous, version: 5 }]);
  expect(parseReviewBackup(converted, "/repo")).toEqual(converted);
  expect(() => parseReviewBackup({ ...backup, version: 5 }, "/repo")).toThrow("unsupported format");
  expect(() =>
    parseReviewBackup({ ...backup, comments: [{ ...previous, drafts: [draft()] }] }, "/repo"),
  ).toThrow("invalid comments");
});
