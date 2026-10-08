import { isProjectPath } from "../shared/project-path.ts";
import type { ChangeLayer, DiffHunk, DiffResult, FileLine, FileReadResult } from "../shared/api.ts";
import { isRecord } from "../shared/validation.ts";

import {
  maxFeedbackCheckAnchors,
  type CommentAnchor,
  type DiffCommentAnchor,
  type FileCommentAnchor,
} from "../shared/feedback-check.ts";
export type ReviewSide = "old" | "new";
export type ReviewLayer = "staged" | "unstaged" | "untracked";
export type {
  CommentAnchor,
  DiffCommentAnchor,
  FileCommentAnchor,
} from "../shared/feedback-check.ts";
export type SelectionSubject = { kind: "selection"; start: number; end: number; text: string };
export type CommentSubject = { kind: "line" } | SelectionSubject;
export type CommentTarget = { anchor: CommentAnchor; subject: CommentSubject };
export type DraftComment = {
  id: string;
  anchor: CommentAnchor;
  subject: CommentSubject;
  body: string;
  createdAt: number;
  updatedAt: number;
  state: "current" | "outdated";
};
export type FeedbackHistory = {
  id: string;
  copiedAt: number;
  text: string;
  comments: DraftComment[];
};
export type CommentStore = {
  version: 4;
  projectPath: string;
  drafts: DraftComment[];
  history: FeedbackHistory[];
};
export type CheckedComments = {
  projectPath: string;
  drafts: Pick<DraftComment, "id" | "anchor" | "subject" | "state">[];
};
export type FeedbackSnapshot = { projectPath: string; text: string; drafts: DraftComment[] };

export const commentStoragePrefix = "git-review:comments:v2:";
export const maxBodyLength = 5000;
export const maxDrafts = maxFeedbackCheckAnchors;
export const maxFeedbackLength = 250_000;
const maxHistory = 20;

export function newLocalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyCommentStore(projectPath: string): CommentStore {
  return { version: 4, projectPath, drafts: [], history: [] };
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}

function parseAnchor(value: unknown): CommentAnchor | null {
  if (!isRecord(value)) return null;
  const { path, line, sourceText, before, after } = value;
  if (!validText(path, 4096) || path.length === 0 || !validText(sourceText, 20_000)) return null;
  if (!Number.isSafeInteger(line) || typeof line !== "number" || line <= 0) return null;
  if (
    !(before === null || validText(before, 20_000)) ||
    !(after === null || validText(after, 20_000))
  )
    return null;
  const context = { path, line, sourceText, before, after };
  if (value["kind"] === "file") {
    if (
      value["source"] !== "worktree" ||
      "layer" in value ||
      "side" in value ||
      path.startsWith("/") ||
      path
        .split("/")
        .some((part) => part === "" || part === "." || part === ".." || part === ".git")
    )
      return null;
    try {
      encodeURIComponent(path);
    } catch {
      return null;
    }
    return { kind: "file", source: "worktree", ...context };
  }
  if (value["kind"] !== "diff" || "source" in value) return null;
  const { layer, side } = value;
  if (layer !== "staged" && layer !== "unstaged" && layer !== "untracked") return null;
  if (side !== "old" && side !== "new") return null;
  return { kind: "diff", layer, side, ...context };
}

/** Offsets use UTF-16, but may not split a surrogate pair. */
export function selectionSubject(
  source: string,
  start: number,
  end: number,
): SelectionSubject | null {
  const splitsPair = (offset: number): boolean =>
    offset > 0 &&
    offset < source.length &&
    /[\uD800-\uDBFF]/.test(source.charAt(offset - 1)) &&
    /[\uDC00-\uDFFF]/.test(source.charAt(offset));
  if (
    !validText(source, 20_000) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > source.length ||
    splitsPair(start) ||
    splitsPair(end)
  )
    return null;
  const text = source.slice(start, end);
  if (text.trim().length === 0 || /[\r\n]/.test(text)) return null;
  return { kind: "selection", start, end, text };
}

function parseSubject(value: unknown, source: string): CommentSubject | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "line")
    return "start" in value || "end" in value || "text" in value ? null : { kind: "line" };
  if (
    value["kind"] !== "selection" ||
    typeof value["start"] !== "number" ||
    typeof value["end"] !== "number"
  )
    return null;
  const subject = selectionSubject(source, value["start"], value["end"]);
  return subject?.kind === "selection" && subject.text === value["text"] ? subject : null;
}

function parseDraft(value: unknown): DraftComment | null {
  if (!isRecord(value)) return null;
  const { id, body, createdAt, updatedAt, state } = value;
  const anchor = parseAnchor(value["anchor"]);
  if (
    anchor === null ||
    !validText(id, 100) ||
    id.length === 0 ||
    !validText(body, maxBodyLength) ||
    body.trim().length === 0
  )
    return null;
  if (
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    typeof updatedAt !== "number" ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < createdAt
  )
    return null;
  if (state !== "current" && state !== "outdated") return null;
  const subject = parseSubject(value["subject"], anchor.sourceText);
  if (subject === null) return null;
  return { id, anchor, subject, body, createdAt, updatedAt, state };
}

export function validateCommentStore(value: unknown, projectPath: string): CommentStore | null {
  if (
    !isRecord(value) ||
    value["version"] !== 4 ||
    !isProjectPath(projectPath) ||
    value["projectPath"] !== projectPath
  )
    return null;
  if (
    !Array.isArray(value["drafts"]) ||
    value["drafts"].length > maxDrafts ||
    !Array.isArray(value["history"]) ||
    value["history"].length > maxHistory
  )
    return null;
  const drafts: DraftComment[] = [];
  const ids = new Set<string>();
  for (const item of value["drafts"]) {
    const draft = parseDraft(item);
    if (draft === null || ids.has(draft.id)) return null;
    ids.add(draft.id);
    drafts.push(draft);
  }
  const history: FeedbackHistory[] = [];
  for (const item of value["history"]) {
    if (
      !isRecord(item) ||
      !validText(item["id"], 100) ||
      item["id"].length === 0 ||
      !validText(item["text"], maxFeedbackLength) ||
      typeof item["copiedAt"] !== "number" ||
      !Number.isSafeInteger(item["copiedAt"]) ||
      item["copiedAt"] < 0 ||
      !Array.isArray(item["comments"]) ||
      item["comments"].length > maxDrafts
    )
      return null;
    const comments: DraftComment[] = [];
    for (const raw of item["comments"]) {
      const comment = parseDraft(raw);
      if (comment === null || comment.state !== "current") return null;
      comments.push(comment);
    }
    history.push({ id: item["id"], copiedAt: item["copiedAt"], text: item["text"], comments });
  }
  return { version: 4, projectPath, drafts, history };
}

export function parseCommentStore(value: unknown, projectPath: string): CommentStore {
  return validateCommentStore(value, projectPath) ?? emptyCommentStore(projectPath);
}

export function readCommentStore(projectPath: string): CommentStore {
  try {
    const raw = localStorage.getItem(`${commentStoragePrefix}${encodeURIComponent(projectPath)}`);
    if (raw === null) return emptyCommentStore(projectPath);
    const value: unknown = JSON.parse(raw);
    const store = validateCommentStore(value, projectPath);
    if (store === null) return emptyCommentStore(projectPath);
    return store;
  } catch {
    return emptyCommentStore(projectPath);
  }
}

export function saveCommentStore(store: CommentStore): void {
  try {
    localStorage.setItem(
      `${commentStoragePrefix}${encodeURIComponent(store.projectPath)}`,
      JSON.stringify(store),
    );
  } catch {
    /* Storage denial does not stop the current review session. */
  }
}

export function anchorForLine(
  layer: ChangeLayer,
  path: string,
  hunk: DiffHunk,
  index: number,
  side: ReviewSide,
): DiffCommentAnchor | null {
  const line = hunk.lines[index];
  if (line === undefined || layer === "conflict") return null;
  const number = side === "old" ? line.oldLine : line.newLine;
  if (number === null) return null;
  const sideText = (offset: number): string | null => {
    const other = hunk.lines[index + offset];
    return other !== undefined && (side === "old" ? other.oldLine : other.newLine) !== null
      ? other.text
      : null;
  };
  if (
    ![line.text, sideText(-1), sideText(1)].every(
      (text) => text === null || validText(text, 20_000),
    )
  )
    return null;
  return {
    kind: "diff",
    layer,
    path,
    side,
    line: number,
    sourceText: line.text,
    before: sideText(-1),
    after: sideText(1),
  };
}

export function anchorMatches(result: DiffResult, anchor: CommentAnchor): boolean {
  if (anchor.kind !== "diff" || result.kind !== "text") return false;
  for (const hunk of result.hunks) {
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const current = anchorForLine(anchor.layer, anchor.path, hunk, index, anchor.side);
      if (
        current !== null &&
        current.line === anchor.line &&
        current.sourceText === anchor.sourceText &&
        current.before === anchor.before &&
        current.after === anchor.after
      )
        return true;
    }
  }
  return false;
}

export function anchorForFileLine(
  path: string,
  lines: readonly FileLine[],
  index: number,
): FileCommentAnchor | null {
  const line = lines[index];
  if (line === undefined) return null;
  const before = lines[index - 1]?.text ?? null;
  const after = lines[index + 1]?.text ?? null;
  if (![line.text, before, after].every((text) => text === null || validText(text, 20_000)))
    return null;
  return {
    kind: "file",
    source: "worktree",
    path,
    line: line.number,
    sourceText: line.text,
    before,
    after,
  };
}

export function fileAnchorMatches(result: FileReadResult, anchor: CommentAnchor): boolean {
  if (anchor.kind !== "file" || result.kind !== "text" || result.path !== anchor.path) return false;
  const current = anchorForFileLine(result.path, result.lines, anchor.line - 1);
  return current !== null && sameAnchor(current, anchor);
}

export function canReattachAnchor(previous: CommentAnchor, next: CommentAnchor): boolean {
  return previous.kind === next.kind;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function formatFeedback(projectPath: string, drafts: readonly DraftComment[]): string {
  const sourceOrder = (anchor: CommentAnchor): number =>
    anchor.kind === "file" ? 3 : { staged: 0, unstaged: 1, untracked: 2 }[anchor.layer];
  const sorted = drafts
    .filter((draft) => draft.state === "current")
    .sort(
      (a, b) =>
        sourceOrder(a.anchor) - sourceOrder(b.anchor) ||
        a.anchor.path.localeCompare(b.anchor.path) ||
        a.anchor.line - b.anchor.line ||
        (a.anchor.kind === "diff" && b.anchor.kind === "diff"
          ? a.anchor.side.localeCompare(b.anchor.side)
          : 0) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
  if (sorted.length === 0) return "";
  const lines = [`Review feedback for ${quote(projectPath)}`];
  let group = "";
  for (const draft of sorted) {
    const source = draft.anchor.kind === "file" ? "worktree" : draft.anchor.layer;
    const nextGroup = `${source}:${draft.anchor.path}`;
    if (nextGroup !== group) {
      lines.push("", `[${source}] ${quote(draft.anchor.path)}`);
      group = nextGroup;
    }
    lines.push(
      `  ${draft.anchor.kind === "diff" ? `${draft.anchor.side} ` : ""}line ${draft.anchor.line}  ${quote(draft.anchor.sourceText)}`,
    );
    if (draft.subject.kind === "selection")
      lines.push(
        `    selected ${quote(draft.subject.text)} (columns ${draft.subject.start + 1}–${draft.subject.end})`,
      );
    for (const bodyLine of draft.body.trim().split(/\r?\n/)) lines.push(`    ${bodyLine}`);
  }
  return lines.join("\n");
}

function sameAnchor(first: CommentAnchor, second: CommentAnchor): boolean {
  return (
    first.kind === second.kind &&
    (first.kind === "file" ||
      (second.kind === "diff" && first.layer === second.layer && first.side === second.side)) &&
    first.path === second.path &&
    first.line === second.line &&
    first.sourceText === second.sourceText &&
    first.before === second.before &&
    first.after === second.after
  );
}

export function sameSubject(first: CommentSubject, second: CommentSubject): boolean {
  return (
    first.kind === second.kind &&
    (first.kind === "line" ||
      (second.kind === "selection" &&
        first.start === second.start &&
        first.end === second.end &&
        first.text === second.text))
  );
}

export function mergeCheckedComments(store: CommentStore, checked: CheckedComments): CommentStore {
  if (store.projectPath !== checked.projectPath) return store;
  const byId = new Map(checked.drafts.map((draft) => [draft.id, draft]));
  return {
    ...store,
    drafts: store.drafts.map((draft) => {
      const result = byId.get(draft.id);
      return result !== undefined &&
        sameAnchor(draft.anchor, result.anchor) &&
        sameSubject(draft.subject, result.subject)
        ? { ...draft, state: result.state }
        : draft;
    }),
  };
}

export function snapshotFeedback(
  projectPath: string,
  store: CommentStore,
  checked: CheckedComments,
): FeedbackSnapshot {
  const byId = new Map(checked.drafts.map((draft) => [draft.id, draft]));
  const drafts =
    store.projectPath !== checked.projectPath
      ? []
      : store.drafts
          .filter((draft) => {
            const result = byId.get(draft.id);
            return (
              draft.state === "current" &&
              result?.state === "current" &&
              sameAnchor(draft.anchor, result.anchor) &&
              sameSubject(draft.subject, result.subject)
            );
          })
          .map((draft) => ({
            ...draft,
            anchor: { ...draft.anchor },
            subject: { ...draft.subject },
          }));
  return { projectPath: store.projectPath, text: formatFeedback(projectPath, drafts), drafts };
}

export function recordSuccessfulCopy(
  store: CommentStore,
  snapshot: FeedbackSnapshot,
  copiedAt: number,
  id: string,
): CommentStore {
  if (
    store.projectPath !== snapshot.projectPath ||
    snapshot.drafts.length === 0 ||
    snapshot.text.length === 0 ||
    snapshot.text.length > maxFeedbackLength
  )
    return store;
  const byId = new Map(snapshot.drafts.map((draft) => [draft.id, draft]));
  const entry: FeedbackHistory = { id, copiedAt, text: snapshot.text, comments: snapshot.drafts };
  return {
    ...store,
    drafts: store.drafts.filter((draft) => {
      const copied = byId.get(draft.id);
      return (
        copied === undefined ||
        draft.state !== "current" ||
        draft.body !== copied.body ||
        draft.createdAt !== copied.createdAt ||
        draft.updatedAt !== copied.updatedAt ||
        !sameAnchor(draft.anchor, copied.anchor) ||
        !sameSubject(draft.subject, copied.subject)
      );
    }),
    history: [entry, ...store.history].slice(0, maxHistory),
  };
}

export function undoSuccessfulCopy(store: CommentStore, id: string): CommentStore {
  const entry = store.history[0];
  if (entry?.id !== id) return store;
  const existing = new Set(store.drafts.map((draft) => draft.id));
  const restored = entry.comments.filter((draft) => !existing.has(draft.id));
  if (store.drafts.length + restored.length > maxDrafts) return store;
  return { ...store, drafts: [...store.drafts, ...restored], history: store.history.slice(1) };
}
