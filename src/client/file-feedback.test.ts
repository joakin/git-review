import { expect, test } from "bun:test";
import type { FileReadResult, Project } from "../shared/api.ts";
import { ApiRequestError, responseBody } from "./api.ts";
import { parseReviewBackup } from "./backup.ts";
import {
  anchorForFileLine,
  canReattachAnchor,
  emptyCommentStore,
  fileAnchorMatches,
  formatFeedback,
  mergeCheckedComments,
  recordSuccessfulCopy,
  snapshotFeedback,
  selectionSubject,
  undoSuccessfulCopy,
  validateCommentStore,
  type CommentStore,
  type DraftComment,
  type FileCommentAnchor,
} from "./comments.ts";
import { FeedbackTransactions, type FeedbackState } from "./feedback-transactions.ts";

const project: Project = {
  name: "Project",
  relativePath: "project",
  absolutePath: "/repo/project",
};
function file(
  texts: string[],
  path = "src/notes β\t.txt",
): Extract<FileReadResult, { kind: "text" }> {
  return {
    kind: "text",
    path,
    byteLength: texts.join("\n").length,
    syntax: { kind: "plain", reason: "selected" },
    lines: texts.map((text, index) => ({
      number: index + 1,
      text,
      tokens: text === "" ? [] : [{ text, role: "plain" }],
    })),
  };
}
const source = file(["first", "", "third", "fourth", "last"]);
function draft(
  id = "file",
  index = 0,
  value = source,
): DraftComment & { anchor: FileCommentAnchor } {
  const anchor = anchorForFileLine(value.path, value.lines, index);
  if (anchor === null) throw new Error("Missing fixture line");
  return {
    id,
    anchor,
    subject: { kind: "line" },
    body: `Question ${id}`,
    state: "current",
    createdAt: 10,
    updatedAt: 11,
  };
}
const diffDraft: DraftComment = {
  ...draft("diff"),
  anchor: {
    kind: "diff",
    layer: "unstaged",
    side: "new",
    path: source.path,
    line: 1,
    sourceText: "first",
    before: null,
    after: "",
  },
};
type Ports = ConstructorParameters<typeof FeedbackTransactions>[0];
function harness(
  drafts: DraftComment[],
  overrides: Partial<Pick<Ports, "fetchStatus" | "fetchDiff" | "fetchFile" | "writeText">> = {},
) {
  let store: CommentStore = { ...emptyCommentStore(project.absolutePath), drafts };
  let state: FeedbackState = { check: { kind: "idle" }, copy: { kind: "idle" } };
  const written: string[] = [];
  const engine = new FeedbackTransactions({
    readStore: () => store,
    updateStore: (change) => (store = change(store)),
    onState: (next) => {
      state = next;
    },
    onCopied: () => {},
    fetchStatus:
      overrides.fetchStatus ??
      (async () => {
        throw new Error("File-only checks must not fetch Git status");
      }),
    fetchDiff:
      overrides.fetchDiff ??
      (async () => {
        throw new Error("Unexpected diff read");
      }),
    fetchFile: overrides.fetchFile ?? (async () => source),
    writeText: async (text) => {
      written.push(text);
      await overrides.writeText?.(text);
    },
  });
  return {
    engine,
    written,
    get state() {
      return state;
    },
    get store() {
      return store;
    },
    set store(next: CommentStore) {
      store = next;
    },
  };
}

test("file anchors handle first, blank and last lines, exact neighbors, path and line bounds", () => {
  for (const index of [0, 1, 4]) {
    const comment = draft(`line-${index}`, index);
    expect(fileAnchorMatches(source, comment.anchor)).toBe(true);
    expect(comment.anchor.before).toBe(source.lines[index - 1]?.text ?? null);
    expect(comment.anchor.after).toBe(source.lines[index + 1]?.text ?? null);
  }
  expect(anchorForFileLine(source.path, source.lines, -1)).toBeNull();
  expect(anchorForFileLine(source.path, source.lines, 5)).toBeNull();
  expect(anchorForFileLine(source.path, file(["x".repeat(20_001)]).lines, 0)).toBeNull();
  const first = draft();
  expect(
    fileAnchorMatches(file(["first", "", "changed elsewhere", "fourth", "last"]), first.anchor),
  ).toBe(true);
  expect(fileAnchorMatches(file(["first", "neighbor changed", "third"]), first.anchor)).toBe(false);
  expect(
    fileAnchorMatches(file(["inserted", ...source.lines.map((line) => line.text)]), first.anchor),
  ).toBe(false);
  expect(fileAnchorMatches(file(["first", ""], "another.txt"), first.anchor)).toBe(false);
  expect(
    fileAnchorMatches({ kind: "binary", path: source.path, byteLength: 5 }, first.anchor),
  ).toBe(false);
  expect(fileAnchorMatches(source, diffDraft.anchor)).toBe(false);
});

test("expanded stores reject malformed, ambiguous and unsupported anchors atomically", () => {
  const original = draft();
  const store = { ...emptyCommentStore(project.absolutePath), drafts: [original] };
  expect(validateCommentStore(store, project.absolutePath)).toEqual(store);
  const invalid = [
    { ...original.anchor, kind: "future" },
    { ...original.anchor, source: "commit" },
    { ...original.anchor, source: null },
    { ...original.anchor, layer: "unstaged" },
    { ...original.anchor, side: "new" },
    { ...original.anchor, line: 0 },
    { ...original.anchor, path: "../outside" },
    { ...original.anchor, path: ".git/config" },
    { ...original.anchor, path: "/absolute" },
    { ...original.anchor, before: 2 },
    { ...original.anchor, sourceText: "nul\0" },
  ];
  for (const anchor of invalid) {
    expect(
      validateCommentStore(
        { ...store, drafts: [original, { ...original, id: "bad", anchor }] },
        project.absolutePath,
      ),
    ).toBeNull();
    expect(
      validateCommentStore(
        {
          ...store,
          history: [
            { id: "copy", copiedAt: 12, text: "copy", comments: [{ ...original, anchor }] },
          ],
        },
        project.absolutePath,
      ),
    ).toBeNull();
  }
  expect(validateCommentStore({ ...store, version: 3 }, project.absolutePath)).toBeNull();
});

test("mixed export separates working-tree feedback, sorts duplicate anchors deterministically and preserves Undo", () => {
  const first = draft("a");
  const second = draft("b");
  const store = {
    ...emptyCommentStore(project.absolutePath),
    drafts: [second, diffDraft, first, { ...draft("outdated"), state: "outdated" as const }],
  };
  const text = formatFeedback(project.absolutePath, store.drafts);
  expect(text).toContain('[unstaged] "src/notes β\\t.txt"\n  new line 1  "first"');
  expect(text).toContain('[worktree] "src/notes β\\t.txt"\n  line 1  "first"');
  expect(text.indexOf("[unstaged]")).toBeLessThan(text.indexOf("[worktree]"));
  expect(text.indexOf("Question a")).toBeLessThan(text.indexOf("Question b"));
  expect(text).not.toContain("Question outdated");
  const copied = recordSuccessfulCopy(
    store,
    snapshotFeedback(project.absolutePath, store, store),
    15,
    "copy",
  );
  expect(copied.drafts.map((item) => item.id)).toEqual(["outdated"]);
  expect(copied.history[0]?.text).toBe(text);
  expect(undoSuccessfulCopy(copied, "copy").drafts.map((item) => item.id)).toEqual([
    "outdated",
    "b",
    "diff",
    "a",
  ]);
  expect(canReattachAnchor(first.anchor, diffDraft.anchor)).toBe(false);
  expect(canReattachAnchor(first.anchor, draft("another", 1).anchor)).toBe(true);
  // Checking a file anchor never validates a diff anchor sharing its line and text.
  expect(
    mergeCheckedComments(
      { ...store, drafts: [diffDraft] },
      {
        projectPath: project.absolutePath,
        drafts: [
          { id: diffDraft.id, anchor: first.anchor, subject: first.subject, state: "outdated" },
        ],
      },
    ).drafts,
  ).toEqual([diffDraft]);
});

test("backup six round-trips mixed stores and rejects obsolete formats", () => {
  const store = {
    ...emptyCommentStore(project.absolutePath),
    drafts: [diffDraft, draft()],
    history: [{ id: "copy", copiedAt: 12, text: "Old copy text", comments: [draft("history")] }],
  };
  const backup = {
    version: 6,
    rootPath: "/repo",
    workspace: { version: 4, rootPath: "/repo", recentPaths: ["project"] },
    wrap: true,
    comments: [store],
    openCards: [],
    languages: [],
    codeTypography: { version: 1, fontFamily: "system", fontSize: 14 },
    appearance: { version: 1, appTheme: "system", codeTheme: "light" },
  };
  const parsed = parseReviewBackup(backup, "/repo");
  expect(parsed.comments).toEqual([store]);
  expect(parseReviewBackup(JSON.parse(JSON.stringify(parsed)) as unknown, "/repo")).toEqual(parsed);
  for (const version of [1, 2, 3, 4, 5]) {
    expect(() => parseReviewBackup({ ...backup, version }, "/repo")).toThrow("unsupported format");
    expect(() =>
      parseReviewBackup({ ...backup, version, comments: [{ ...store, version: 1 }] }, "/repo"),
    ).toThrow("unsupported format");
  }
  expect(() => parseReviewBackup(backup, "/other")).toThrow("different host root");
  expect(() => parseReviewBackup({ ...backup, version: 7 }, "/repo")).toThrow("unsupported format");
});

test("file-only check and copy read each path once using plain text without Git", async () => {
  const calls: string[] = [];
  const h = harness([draft("one"), draft("duplicate"), draft("blank", 1)], {
    fetchFile: async (id, path, language, signal) => {
      expect(id).toBe(project.absolutePath);
      expect(language).toBe("text");
      expect(signal.aborted).toBe(false);
      calls.push(path);
      return source;
    },
  });
  await h.engine.check(project);
  expect(calls).toEqual([source.path]);
  expect(h.state.check.kind).toBe("ready");
  await h.engine.copy(project);
  expect(calls).toEqual([source.path, source.path]);
  expect(h.written).toHaveLength(1);
  expect(h.store.drafts).toEqual([]);
  expect(h.store.history[0]?.comments).toHaveLength(3);
});

test("mixed source checking retains valid file feedback when Git changes have disappeared", async () => {
  const h = harness([draft(), diffDraft], { fetchStatus: async () => ({ kind: "not_git" }) });
  await h.engine.copy(project);
  expect(h.written[0]).toContain("[worktree]");
  expect(h.written[0]).not.toContain("[unstaged]");
  expect(h.store.drafts).toEqual([{ ...diffDraft, state: "outdated" }]);
});

test("missing and non-text files become outdated without writing or losing their drafts", async () => {
  const unavailable: FileReadResult[] = [
    { kind: "binary", path: source.path, byteLength: 5 },
    { kind: "symlink", path: source.path, byteLength: 5 },
    { kind: "too_large", path: source.path, byteLength: 5 },
    { kind: "unsupported", path: source.path, byteLength: 5 },
    file([]),
    file(["changed", ""]),
  ];
  for (const value of unavailable) {
    const h = harness([draft()], { fetchFile: async () => value });
    await h.engine.copy(project);
    expect(h.written).toEqual([]);
    expect(h.store.drafts[0]?.state).toBe("outdated");
    expect(h.store.drafts[0]?.body).toBe("Question file");
  }
  const h = harness([draft()], {
    fetchFile: async () => {
      throw new ApiRequestError("File missing", "file_not_found", 404);
    },
  });
  await h.engine.copy(project);
  expect(h.written).toEqual([]);
  expect(h.state.check.kind).toBe("ready");
  expect(h.store.drafts[0]?.state).toBe("outdated");
});

test("API errors preserve their code and read failures retain all drafts until a successful retry", async () => {
  await expect(
    responseBody(
      Response.json({ error: { code: "file_not_found", message: "Missing" } }, { status: 404 }),
    ),
  ).rejects.toMatchObject({ code: "file_not_found", status: 404 });
  for (const error of [
    new Error("Offline"),
    new ApiRequestError("Project missing", "project_not_found", 404),
    new ApiRequestError("Project changed", "project_changed", 409),
    new ApiRequestError("Denied", "forbidden", 403),
    new ApiRequestError("Server failed", "internal_error", 500),
  ]) {
    let fail = true;
    const h = harness([draft(), draft("second", 2)], {
      fetchFile: async () => {
        if (fail) throw error;
        return source;
      },
    });
    const original = h.store;
    await h.engine.copy(project);
    expect(h.state.check.kind).toBe("error");
    expect(h.store).toBe(original);
    expect(h.written).toEqual([]);
    fail = false;
    await h.engine.copy(project);
    expect(h.store.drafts).toEqual([]);
    expect(h.written).toHaveLength(1);
  }
});

test("a delayed file read merges validity without replacing edits, new drafts or reattached anchors", async () => {
  let release: (result: FileReadResult) => void = () => {
    throw new Error("Read not started");
  };
  const pending = new Promise<FileReadResult>((resolve) => {
    release = resolve;
  });
  const original = draft();
  const h = harness([original, draft("moved")], { fetchFile: async () => pending });
  const checking = h.engine.check(project);
  const moved = draft("moved", 4);
  h.store = {
    ...h.store,
    drafts: [
      { ...original, body: "New learning question", updatedAt: 20 },
      moved,
      draft("added", 1),
    ],
  };
  release(file(["changed", "", "third", "fourth", "last"]));
  await checking;
  expect(h.store.drafts).toEqual([
    { ...original, body: "New learning question", updatedAt: 20, state: "outdated" },
    moved,
    draft("added", 1),
  ]);
});

test("source changes after preview are rechecked on copy and cancellation rejects late file results", async () => {
  let current: FileReadResult = source;
  const h = harness([draft()], { fetchFile: async () => current });
  await h.engine.check(project);
  expect(h.state.check.kind).toBe("ready");
  current = file(["changed", ""]);
  await h.engine.copy(project);
  expect(h.written).toEqual([]);
  expect(h.store.drafts[0]?.state).toBe("outdated");
  let release: (result: FileReadResult) => void = () => {};
  const pending = new Promise<FileReadResult>((resolve) => {
    release = resolve;
  });
  const late = harness([draft()], { fetchFile: async () => pending });
  const checking = late.engine.check(project);
  late.engine.cancel();
  late.store = emptyCommentStore("another");
  release(source);
  await checking;
  expect(late.store.projectPath).toBe("another");
  expect(late.store.drafts).toEqual([]);
  expect(late.state.check.kind).toBe("idle");
});

test("selection reattachment during a file check or clipboard write preserves the newer fragment", async () => {
  const value = file(["first first"]);
  const first = selectionSubject("first first", 0, 5);
  const second = selectionSubject("first first", 6, 11);
  if (first === null || second === null) throw new Error("Missing selection fixture");
  const original = { ...draft("fragment", 0, value), subject: first };
  const moved = { ...original, subject: second };
  let finishRead: (result: FileReadResult) => void = () => {};
  const pendingRead = new Promise<FileReadResult>((resolve) => {
    finishRead = resolve;
  });
  const checking = harness([original], { fetchFile: async () => pendingRead });
  const pendingCopy = checking.engine.copy(project);
  checking.store = { ...checking.store, drafts: [moved] };
  finishRead(value);
  await pendingCopy;
  expect(checking.written).toEqual([]);
  expect(checking.store.drafts).toEqual([moved]);

  let finishWrite: () => void = () => {};
  const pendingWrite = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  let startedWrite: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    startedWrite = resolve;
  });
  const copying = harness([original], {
    fetchFile: async () => value,
    writeText: async () => {
      startedWrite();
      await pendingWrite;
    },
  });
  const copy = copying.engine.copy(project);
  await started;
  copying.store = { ...copying.store, drafts: [moved] };
  finishWrite();
  await copy;
  expect(copying.store.drafts).toEqual([moved]);
  expect(copying.store.history[0]?.comments).toEqual([original]);
});
