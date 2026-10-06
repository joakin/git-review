import { expect, test } from "bun:test";
import {
  emptyCommentStore,
  selectionSubject,
  validateCommentStore,
  formatFeedback,
  snapshotFeedback,
  mergeCheckedComments,
  recordSuccessfulCopy,
  undoSuccessfulCopy,
  type DraftComment,
  type CommentStore,
} from "./comments.ts";
import { parseReviewBackup } from "./backup.ts";

const projectPath = "/repo/project";
const text = "\tfoo + foo + '🦊'; ";
const anchor = {
  kind: "file",
  source: "worktree",
  path: "notes β.ts",
  line: 1,
  sourceText: text,
  before: null,
  after: null,
} as const;
function fragment(start = 7, end = 10): DraftComment {
  const subject = selectionSubject(text, start, end);
  if (subject === null) throw new Error("Invalid fixture fragment");
  return {
    id: "selected",
    anchor,
    subject,
    body: "Why this occurrence?",
    state: "current",
    createdAt: 1,
    updatedAt: 1,
  };
}
function store(draft = fragment()): CommentStore {
  return { ...emptyCommentStore(projectPath), drafts: [draft] };
}

test("selection subjects preserve exact repeated occurrences, spaces, tabs and Unicode boundaries", () => {
  expect(fragment().subject).toEqual({ kind: "selection", start: 7, end: 10, text: "foo" });
  expect(selectionSubject(text, 0, 4)).toEqual({
    kind: "selection",
    start: 0,
    end: 4,
    text: "\tfoo",
  });
  expect(selectionSubject(text, 6, 11)).toEqual({
    kind: "selection",
    start: 6,
    end: 11,
    text: " foo ",
  });
  const emoji = text.indexOf("🦊");
  expect(selectionSubject(text, emoji, emoji + 2)).toEqual({
    kind: "selection",
    start: emoji,
    end: emoji + 2,
    text: "🦊",
  });
  const invalidOffsets: [number, number][] = [
    [emoji, emoji + 1],
    [emoji + 1, emoji + 2],
    [-1, 2],
    [0, 0],
    [0, text.length + 1],
    [NaN, 2],
    [0.5, 3],
    [0, 1],
  ];
  for (const [start, end] of invalidOffsets) expect(selectionSubject(text, start, end)).toBeNull();
  expect(selectionSubject("one\ntwo", 0, 7)).toBeNull();
  expect(selectionSubject("x".repeat(20_001), 0, 2)).toBeNull();
});

test("stored selections validate their text, offsets and variant atomically in drafts and history", () => {
  const original = fragment();
  const valid = store(original);
  expect(validateCommentStore(valid, projectPath)).toEqual(valid);
  for (const subject of [
    null,
    { kind: "line", text: "foo" },
    { kind: "selection", start: 7, end: 10, text: "bar" },
    { kind: "selection", start: -1, end: 10, text: "foo" },
    { kind: "future" },
  ]) {
    const invalid = { ...original, subject };
    expect(validateCommentStore({ ...valid, drafts: [invalid] }, projectPath)).toBeNull();
    expect(
      validateCommentStore(
        { ...valid, history: [{ id: "copy", copiedAt: 2, text: "Archived", comments: [invalid] }] },
        projectPath,
      ),
    ).toBeNull();
  }
  expect(validateCommentStore({ ...valid, version: 2 }, projectPath)).toBeNull();
});

test("selection export quotes the full source and exact fragment with its occurrence positions", () => {
  const output = formatFeedback("/repo", [fragment()]);
  expect(output).toContain(JSON.stringify(text));
  expect(output).toContain('selected "foo" (columns 8–10)');
  expect(output).toContain("Why this occurrence?");
  expect(formatFeedback("/repo", [{ ...fragment(), subject: { kind: "line" } }])).not.toContain(
    "selected ",
  );
});

test("late checks and copy do not validate or clear a reattached selection sharing the same line", () => {
  const original = fragment();
  const changed = fragment(1, 4);
  const checked = { projectPath, drafts: [original] };
  expect(
    mergeCheckedComments(store(changed), {
      ...checked,
      drafts: [{ ...original, state: "outdated" }],
    }).drafts,
  ).toEqual([changed]);
  expect(snapshotFeedback("/repo", store(changed), checked).drafts).toEqual([]);
  const snapshot = snapshotFeedback("/repo", store(original), checked);
  const copied = recordSuccessfulCopy(store(changed), snapshot, 2, "copy");
  expect(copied.drafts).toEqual([changed]);
  expect(copied.history[0]?.comments).toEqual([original]);
  const archived = recordSuccessfulCopy(store(original), snapshot, 2, "copy");
  expect(archived.drafts).toEqual([]);
  expect(undoSuccessfulCopy(archived, "copy").drafts).toEqual([original]);
});

test("backup six retains selections and rejects obsolete formats", () => {
  const backup = {
    version: 6,
    rootPath: "/repo",
    workspace: { version: 4, rootPath: "/repo", recentPaths: [] },
    wrap: true,
    codeTypography: { version: 1, fontFamily: "system", fontSize: 14 },
    appearance: { version: 1, appTheme: "system", codeTheme: "light" },
    comments: [store()],
    openCards: [],
    languages: [],
  };
  expect(parseReviewBackup(backup, "/repo").comments).toEqual([store()]);
  expect(() => parseReviewBackup({ ...backup, version: 5 }, "/repo")).toThrow("unsupported format");
});
