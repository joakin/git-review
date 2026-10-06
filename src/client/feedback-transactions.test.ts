import { describe, expect, test } from "bun:test";
import type { DiffResult, Project, ProjectStatus } from "../shared/api.ts";
import {
  emptyCommentStore,
  formatFeedback,
  maxFeedbackLength,
  parseCommentStore,
  snapshotFeedback,
  undoSuccessfulCopy,
  type CommentStore,
  type DraftComment,
  type DiffCommentAnchor,
} from "./comments.ts";
import { FeedbackTransactions, type FeedbackState } from "./feedback-transactions.ts";

const project: Project = {
  id: "project",
  path: "project",
  name: "Project",
  absolutePath: "/repo/project",
};
const otherProject: Project = {
  id: "other",
  path: "other",
  name: "Other",
  absolutePath: "/repo/other",
};
const status: ProjectStatus = {
  kind: "git",
  revision: "revision",
  changeToken: "token",
  entries: [
    {
      layer: "unstaged",
      path: "file.ts",
      kind: "modified",
      oldPath: null,
      isSubmodule: false,
      stats: { kind: "text", added: 1, deleted: 0 },
    },
  ],
};
const diff: DiffResult = {
  kind: "text",
  syntax: { kind: "plain", reason: "selected" },
  hunks: [
    {
      oldStart: 1,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      lines: [
        {
          kind: "added",
          oldLine: null,
          newLine: 1,
          text: "source",
          tokens: [{ text: "source", role: "plain" }],
          detail: { kind: "none" },
          noNewlineAtEnd: false,
        },
      ],
    },
  ],
};

function draft(id: string): DraftComment & { anchor: DiffCommentAnchor } {
  return {
    id,
    subject: { kind: "line" },
    anchor: {
      kind: "diff",
      layer: "unstaged",
      path: "file.ts",
      side: "new",
      line: 1,
      sourceText: "source",
      before: null,
      after: null,
    },
    body: `Feedback ${id}`,
    createdAt: 1,
    updatedAt: 1,
    state: "current",
  };
}

function deferred<T>() {
  const callbacks = {
    resolve: (_value: T): void => {
      throw new Error("Deferred promise is not initialized");
    },
    reject: (_error: unknown): void => {
      throw new Error("Deferred promise is not initialized");
    },
  };
  const promise = new Promise<T>((resolve, reject) => {
    callbacks.resolve = resolve;
    callbacks.reject = reject;
  });
  return { promise, ...callbacks };
}

type Ports = ConstructorParameters<typeof FeedbackTransactions>[0];
function harness(
  drafts: DraftComment[] = [draft("one")],
  overrides: Partial<Pick<Ports, "fetchStatus" | "fetchDiff" | "fetchFile" | "writeText">> = {},
) {
  let current: CommentStore | null = { ...emptyCommentStore(project.id), drafts };
  const states: FeedbackState[] = [];
  const copied: Parameters<Ports["onCopied"]>[0][] = [];
  const written: string[] = [];
  const transactions = new FeedbackTransactions({
    readStore: () => current,
    updateStore: (change) => {
      if (current !== null) current = change(current);
      return current;
    },
    onState: (value) => states.push(value),
    onCopied: (value) => copied.push(value),
    fetchStatus: overrides.fetchStatus ?? (async () => status),
    fetchDiff: overrides.fetchDiff ?? (async () => diff),
    fetchFile:
      overrides.fetchFile ??
      (async () => {
        throw new Error("Unexpected file read");
      }),
    writeText: async (text) => {
      written.push(text);
      await overrides.writeText?.(text);
    },
  });
  return {
    transactions,
    copied,
    written,
    get store(): CommentStore {
      if (current === null) throw new Error("No current store");
      return current;
    },
    set store(value: CommentStore) {
      current = value;
    },
    clearStore: () => {
      current = null;
    },
    get state(): FeedbackState {
      return states.at(-1) ?? { check: { kind: "idle" }, copy: { kind: "idle" } };
    },
  };
}

function heldClipboard() {
  const started = deferred<void>();
  const completion = deferred<void>();
  return {
    started,
    completion,
    writeText: async () => {
      started.resolve();
      await completion.promise;
    },
  };
}

describe("owned feedback transactions", () => {
  test("a late line check preserves edits, deletion, reattachment, new drafts and history", async () => {
    const result = deferred<DiffResult>();
    const started = deferred<void>();
    const edited = draft("edited");
    const moved = draft("moved");
    const h = harness([edited, moved, draft("deleted")], {
      fetchDiff: async () => {
        started.resolve();
        return result.promise;
      },
    });
    const checking = h.transactions.check(project);
    await started.promise;
    const newBody = { ...edited, body: "Newer body", updatedAt: 2 };
    const reattached = { ...moved, anchor: { ...moved.anchor, line: 2 }, updatedAt: 2 };
    const added = draft("added");
    const history = [
      { id: "concurrent-history", copiedAt: 3, text: "Existing feedback", comments: [edited] },
    ];
    h.store = { ...h.store, drafts: [newBody, reattached, added], history };
    result.resolve({ kind: "binary", reason: "binary" });
    await checking;
    expect(h.store.drafts).toEqual([{ ...newBody, state: "outdated" }, reattached, added]);
    expect(h.store.history).toEqual(history);
    expect(h.state.check.kind).toBe("ready");
  });

  test("copy uses the latest checked body and excludes drafts added during its precheck", async () => {
    const latest = deferred<ProjectStatus>();
    const clipboard = heldClipboard();
    const original = draft("one");
    const h = harness([original], {
      fetchStatus: async () => latest.promise,
      writeText: clipboard.writeText,
    });
    const copying = h.transactions.copy(project);
    const edited = { ...original, body: "Latest saved body", updatedAt: 2 };
    const added = draft("unchecked");
    h.store = { ...h.store, drafts: [edited, added] };
    latest.resolve(status);
    await clipboard.started.promise;
    expect(h.written).toEqual([formatFeedback(project.absolutePath, [edited])]);
    expect(h.state.copy).toEqual({ kind: "copying" });
    clipboard.completion.resolve();
    await copying;
    expect(h.store.drafts).toEqual([added]);
    expect(h.store.history[0]?.comments).toEqual([edited]);
    expect(h.copied).toHaveLength(1);
  });

  test("manual export excludes an unchecked draft restored by Undo while checking", async () => {
    const latest = deferred<ProjectStatus>();
    const original = draft("one");
    const restored = {
      ...draft("restored"),
      anchor: { ...original.anchor, sourceText: "Stale archived source" },
    };
    const h = harness([original], { fetchStatus: async () => latest.promise });
    h.store = {
      ...h.store,
      history: [{ id: "undo-entry", copiedAt: 2, text: "Archived feedback", comments: [restored] }],
    };
    const pending = h.transactions.check(project);
    h.store = undoSuccessfulCopy(h.store, "undo-entry");
    latest.resolve(status);
    await pending;
    const checked = h.state.check;
    if (checked.kind !== "ready") throw new Error("Expected a successful check");
    expect(h.store.drafts).toEqual([original, restored]);
    const preview = snapshotFeedback(project.absolutePath, h.store, checked.checked);
    expect(preview.text).toBe(formatFeedback(project.absolutePath, [original]));
    expect(preview.text).not.toContain(restored.body);
    expect(preview.drafts).toEqual([original]);
  });

  test("copy cannot export a reattached anchor using the old precheck", async () => {
    const latest = deferred<ProjectStatus>();
    const original = draft("one");
    const h = harness([original], { fetchStatus: async () => latest.promise });
    const copying = h.transactions.copy(project);
    const reattached = { ...original, anchor: { ...original.anchor, line: 9 }, updatedAt: 2 };
    h.store = { ...h.store, drafts: [reattached] };
    latest.resolve(status);
    await copying;
    expect(h.written).toEqual([]);
    expect(h.store.drafts).toEqual([reattached]);
    expect(h.store.history).toEqual([]);
    expect(h.state.copy).toEqual({
      kind: "error",
      message: "No current comments to copy. Reattach outdated comments first.",
    });
  });

  test("clipboard success archives its snapshot while preserving newer edits, deletion, additions and Undo", async () => {
    const clipboard = heldClipboard();
    const unchanged = draft("unchanged");
    const edited = draft("edited");
    const moved = draft("moved");
    const deleted = draft("deleted");
    const h = harness([unchanged, edited, moved, deleted], { writeText: clipboard.writeText });
    const restored = draft("restored-by-undo");
    h.store = {
      ...h.store,
      history: [{ id: "undo-entry", copiedAt: 2, text: "Undo this", comments: [restored] }],
    };
    const copying = h.transactions.copy(project);
    await clipboard.started.promise;
    const newer = { ...edited, body: "Newer feedback", updatedAt: 3 };
    const reattached = { ...moved, anchor: { ...moved.anchor, path: "other.ts" }, updatedAt: 3 };
    const added = draft("added");
    const concurrentHistory = {
      id: "concurrent",
      copiedAt: 3,
      text: "Other copy",
      comments: [added],
    };
    h.store = {
      ...h.store,
      drafts: [unchanged, newer, reattached, added, restored],
      history: [concurrentHistory],
    };
    clipboard.completion.resolve();
    await copying;
    expect(h.store.drafts).toEqual([newer, reattached, added, restored]);
    expect(h.store.history[0]?.comments).toEqual([unchanged, edited, moved, deleted]);
    expect(h.store.history[0]?.text).toBe(h.written[0]);
    expect(h.store.history.slice(1)).toEqual([concurrentHistory]);
    expect(h.state.copy).toEqual({ kind: "idle" });
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`a superseded check's late ${outcome} cannot replace the newer result`, async () => {
      const older = deferred<ProjectStatus>();
      let first = true;
      const h = harness([draft("one")], {
        fetchStatus: async () => {
          if (first) {
            first = false;
            return older.promise;
          }
          return { kind: "not_git" };
        },
      });
      const pending = h.transactions.check(project);
      await h.transactions.check(project);
      const currentStore = h.store;
      const currentState = h.state;
      if (outcome === "success") older.resolve(status);
      else older.reject(new Error("Older request failed"));
      await pending;
      expect(h.store).toEqual(currentStore);
      expect(h.store.drafts[0]?.state).toBe("outdated");
      expect(h.state).toEqual(currentState);
    });
  }

  for (const destination of [project, otherProject]) {
    test(`cancel and return to ${destination.id} ignores late check results`, async () => {
      const latest = deferred<ProjectStatus>();
      const h = harness([draft("one")], { fetchStatus: async () => latest.promise });
      const pending = h.transactions.check(project);
      h.transactions.cancel();
      h.clearStore();
      h.store = { ...emptyCommentStore(destination.id), drafts: [draft("new-session")] };
      const current = h.store;
      latest.resolve(status);
      await pending;
      expect(h.store).toEqual(current);
      expect(h.state).toEqual({ check: { kind: "idle" }, copy: { kind: "idle" } });
      expect(h.copied).toEqual([]);
    });
  }

  test("cancel aborts a held diff and its late error cannot replace the next check", async () => {
    const older = deferred<DiffResult>();
    const started = deferred<AbortSignal>();
    let first = true;
    const h = harness([draft("one")], {
      fetchDiff: async (_id, _layer, _path, _revision, _language, signal) => {
        if (first) {
          first = false;
          started.resolve(signal);
          return older.promise;
        }
        return diff;
      },
    });
    const pending = h.transactions.check(project);
    const signal = await started.promise;
    h.transactions.cancel();
    expect(signal.aborted).toBe(true);
    await h.transactions.check(project);
    older.reject(new Error("Aborted diff responded late"));
    await pending;
    expect(h.state.check.kind).toBe("ready");
    expect(h.store.drafts).toEqual([draft("one")]);
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`a canceled clipboard ${outcome} preserves the same project's new session and releases its lease`, async () => {
      const clipboard = heldClipboard();
      let first = true;
      const h = harness([draft("one")], {
        writeText: async () => {
          if (first) {
            first = false;
            await clipboard.writeText();
          }
        },
      });
      const pending = h.transactions.copy(project);
      await clipboard.started.promise;
      h.transactions.cancel();
      h.clearStore();
      h.store = { ...emptyCommentStore(project.id), drafts: [draft("new-session")] };
      const current = h.store;
      await h.transactions.copy(project);
      await h.transactions.copyHistory(project, "Blocked history copy");
      expect(h.written).toHaveLength(1);
      if (outcome === "success") clipboard.completion.resolve();
      else clipboard.completion.reject(new Error("Late clipboard failure"));
      await pending;
      expect(h.store).toEqual(current);
      expect(h.copied).toEqual([]);
      expect(h.state).toEqual({ check: { kind: "idle" }, copy: { kind: "idle" } });
      // The next write may start once the canceled browser promise has settled.
      await h.transactions.copyHistory(project, "New session history");
      expect(h.written).toEqual([
        formatFeedback(project.absolutePath, [draft("one")]),
        "New session history",
      ]);
      expect(h.copied).toEqual([{ kind: "history" }]);
      expect(h.store).toEqual(current);
    });
  }

  test("a pending clipboard lease prevents all overlapping writes, including across projects", async () => {
    const clipboard = heldClipboard();
    const h = harness([draft("one")], { writeText: clipboard.writeText });
    const pending = h.transactions.copy(project);
    await clipboard.started.promise;
    await h.transactions.copy(project);
    await h.transactions.copyHistory(project, "Blocked history");
    h.transactions.cancel();
    h.store = { ...emptyCommentStore(otherProject.id), drafts: [draft("other")] };
    await h.transactions.check(otherProject);
    await h.transactions.copy(otherProject);
    await h.transactions.copyHistory(otherProject, "Blocked other history");
    expect(h.written).toHaveLength(1);
    const current = h.store;
    clipboard.completion.resolve();
    await pending;
    expect(h.store).toEqual(current);
    expect(h.copied).toEqual([]);
    expect(h.state.check.kind).toBe("ready");
    await h.transactions.copy(otherProject);
    expect(h.written[1]).toBe(formatFeedback(otherProject.absolutePath, [draft("other")]));
    expect(h.store.drafts).toEqual([]);
    expect(h.store.history[0]?.comments).toEqual([draft("other")]);
  });

  test("a canceled write settling preserves a newer project's check error", async () => {
    const clipboard = heldClipboard();
    const h = harness([draft("one")], {
      writeText: clipboard.writeText,
      fetchStatus: async (id) => {
        if (id === otherProject.id) throw new Error("New project's check failed");
        return status;
      },
    });
    const pending = h.transactions.copy(project);
    await clipboard.started.promise;
    h.transactions.cancel();
    h.store = { ...emptyCommentStore(otherProject.id), drafts: [draft("other")] };
    await h.transactions.check(otherProject);
    clipboard.completion.reject(new Error("Canceled old write failed"));
    await pending;
    expect(h.state).toEqual({
      check: { kind: "error", message: "New project's check failed" },
      copy: { kind: "idle" },
    });
    expect(h.store.history).toEqual([]);
    expect(h.store.drafts).toEqual([draft("other")]);
  });

  test("clipboard rejection retains checked drafts and history and permits a retry", async () => {
    let denied = true;
    const h = harness([draft("one")], {
      writeText: async () => {
        if (denied) throw new Error("Clipboard denied");
      },
    });
    const history = [{ id: "old", copiedAt: 2, text: "Old copy", comments: [draft("old")] }];
    h.store = { ...h.store, history };
    await h.transactions.copy(project);
    expect(h.store.drafts).toEqual([draft("one")]);
    expect(h.store.history).toEqual(history);
    expect(h.copied).toEqual([]);
    expect(h.state.copy).toEqual({ kind: "error", message: "Clipboard denied" });
    denied = false;
    await h.transactions.copy(project);
    expect(h.store.drafts).toEqual([]);
    expect(h.store.history).toHaveLength(2);
    expect(h.copied).toHaveLength(1);
  });

  test("an export exceeding the persisted history bound retains valid drafts and permits a smaller retry", async () => {
    const largeDrafts = Array.from({ length: 51 }, (_, index) => ({
      ...draft(`large-${index}`),
      body: "x".repeat(5000),
    }));
    const h = harness(largeDrafts);
    await h.transactions.copy(project);
    expect(h.state.copy).toEqual({
      kind: "error",
      message: "Feedback is too large for copy history. Select the text below to copy it manually.",
    });
    expect(h.written).toEqual([]);
    expect(h.copied).toEqual([]);
    expect(h.store.drafts).toEqual(largeDrafts);
    expect(h.store.history).toEqual([]);
    expect(parseCommentStore(JSON.parse(JSON.stringify(h.store)) as unknown, project.id)).toEqual(
      h.store,
    );
    const checked = h.state.check;
    if (checked.kind !== "ready")
      throw new Error("Expected checked manual feedback to remain available");
    expect(
      snapshotFeedback(project.absolutePath, h.store, checked.checked).text.length,
    ).toBeGreaterThan(maxFeedbackLength);
    const smallerDrafts = largeDrafts.slice(0, 49);
    h.store = { ...h.store, drafts: smallerDrafts };
    await h.transactions.copy(project);
    expect(h.state.copy).toEqual({ kind: "idle" });
    expect(h.written).toHaveLength(1);
    expect(h.store.drafts).toEqual([]);
    expect(h.store.history[0]?.comments).toEqual(smallerDrafts);
    expect(h.store.history[0]?.text).toBe(h.written[0]);
    expect(parseCommentStore(JSON.parse(JSON.stringify(h.store)) as unknown, project.id)).toEqual(
      h.store,
    );
  });

  test("stale diff and check failures do not write or archive feedback", async () => {
    let stale = true;
    const h = harness([draft("one")], {
      fetchDiff: async () => {
        if (stale) return { kind: "stale" };
        throw new Error("Diff unavailable");
      },
    });
    const current = h.store;
    await h.transactions.copy(project);
    expect(h.state.check).toEqual({
      kind: "error",
      message: "The files changed during checking. Try again.",
    });
    expect(h.store).toEqual(current);
    stale = false;
    await h.transactions.check(project);
    expect(h.state.check).toEqual({ kind: "error", message: "Diff unavailable" });
    expect(h.store).toEqual(current);
    expect(h.written).toEqual([]);
    expect(h.copied).toEqual([]);
  });

  test("history recopy uses its saved text without changing drafts or archived records", async () => {
    const clipboard = heldClipboard();
    const h = harness([draft("one")], { writeText: clipboard.writeText });
    const entry = {
      id: "old",
      copiedAt: 2,
      text: "Original archived text",
      comments: [draft("old")],
    };
    h.store = { ...h.store, history: [entry] };
    const pending = h.transactions.copyHistory(project, entry.text);
    await clipboard.started.promise;
    await h.transactions.copy(project);
    await h.transactions.copyHistory(project, "Blocked second recopy");
    const edited = { ...draft("one"), body: "Edited while recopying", updatedAt: 3 };
    h.store = { ...h.store, drafts: [edited] };
    const current = h.store;
    clipboard.completion.resolve();
    await pending;
    expect(h.written).toEqual([entry.text]);
    expect(h.store).toEqual(current);
    expect(h.copied).toEqual([{ kind: "history" }]);
  });
});
