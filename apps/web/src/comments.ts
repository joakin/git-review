import { isProjectPath } from "@git-review/shared/project-path";
import type {
  ChangeLayer,
  DiffHunk,
  DiffResult,
  FileLine,
  FileReadResult,
} from "@git-review/shared/api";
import { isRecord } from "@git-review/shared/validation";

import {
  maxFeedbackCheckAnchors,
  maxFeedbackCheckLines,
  maxFeedbackRangeText,
  maxFeedbackRangeLines,
  parseRangeCommentAnchor,
  type CommentAnchor,
  type FeedbackAnchor,
  type DiffCommentAnchor,
  type FileCommentAnchor,
} from "@git-review/shared/feedback-check";
export type ReviewSide = "old" | "new";
export type ReviewLayer = "staged" | "unstaged" | "untracked";
export type {
  CommentAnchor,
  DiffCommentAnchor,
  FileCommentAnchor,
} from "@git-review/shared/feedback-check";
export type SelectionSubject = { kind: "selection"; start: number; end: number; text: string };
export type RangeSelectionPart = {
  anchors: CommentAnchor[];
  start: number;
  end: number;
  text: string;
};
export type RangeSubject = { kind: "range"; parts: RangeSelectionPart[] };
export type CommentSubject = { kind: "line" } | SelectionSubject | RangeSubject;
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
  version: 5;
  projectPath: string;
  drafts: DraftComment[];
  history: FeedbackHistory[];
};
export type CheckedComments = {
  projectPath: string;
  drafts: Pick<DraftComment, "id" | "anchor" | "subject" | "state">[];
};
export type FeedbackSnapshot = { projectPath: string; text: string; drafts: DraftComment[] };

export const commentStoragePrefix = "git-review:comments:v3:";
export const previousCommentStoragePrefix = "git-review:comments:v2:";
export const maxBodyLength = 5000;
export const maxDrafts = maxFeedbackCheckAnchors;
export const maxFeedbackLength = 250_000;
const maxHistory = 20;

export function newLocalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyCommentStore(projectPath: string): CommentStore {
  return { version: 5, projectPath, drafts: [], history: [] };
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
  if (
    !validText(source, 20_000) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > source.length ||
    splitsSurrogatePair(source, start) ||
    splitsSurrogatePair(source, end)
  )
    return null;
  const text = source.slice(start, end);
  if (text.trim().length === 0 || /[\r\n]/.test(text)) return null;
  return { kind: "selection", start, end, text };
}

export function rangeSourceText(part: RangeSelectionPart): string {
  return part.anchors.map((anchor) => anchor.sourceText).join("\n");
}

export function rangeSubject(parts: readonly RangeSelectionPart[]): RangeSubject | null {
  try {
    const anchor = parseRangeCommentAnchor({
      kind: "range",
      parts: parts.map((part) => part.anchors),
    });
    const parsed: RangeSelectionPart[] = [];
    for (const [index, part] of parts.entries()) {
      const anchors = anchor.parts[index];
      const first = anchors?.[0];
      const last = anchors?.at(-1);
      if (anchors === undefined || first === undefined || last === undefined) return null;
      const source = anchors.map((line) => line.sourceText).join("\n");
      const lastStart = source.length - last.sourceText.length;
      if (
        !Number.isSafeInteger(part.start) ||
        !Number.isSafeInteger(part.end) ||
        part.start < 0 ||
        part.start > first.sourceText.length ||
        part.end < part.start ||
        part.end > source.length ||
        part.end < lastStart ||
        (part.end === lastStart && last.sourceText.length > 0) ||
        splitsSurrogatePair(source, part.start) ||
        splitsSurrogatePair(source, part.end) ||
        source.slice(part.start, part.end) !== part.text
      )
        return null;
      parsed.push({ anchors, start: part.start, end: part.end, text: part.text });
    }
    if (parsed.every((part) => part.text.trim().length === 0)) return null;
    return { kind: "range", parts: parsed };
  } catch {
    return null;
  }
}

function splitsSurrogatePair(source: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < source.length &&
    /[\uD800-\uDBFF]/.test(source.charAt(offset - 1)) &&
    /[\uDC00-\uDFFF]/.test(source.charAt(offset))
  );
}

export function commentCheckAnchor(
  comment: Pick<DraftComment, "anchor" | "subject">,
): FeedbackAnchor {
  return comment.subject.kind === "range"
    ? { kind: "range", parts: comment.subject.parts.map((part) => part.anchors) }
    : comment.anchor;
}

export function commentLineAnchors(
  comment: Pick<DraftComment, "anchor" | "subject">,
): CommentAnchor[] {
  return comment.subject.kind === "range"
    ? comment.subject.parts.flatMap((part) => part.anchors)
    : [comment.anchor];
}

export function isSelectionSubject(subject: CommentSubject): boolean {
  return subject.kind !== "line";
}

export function commentSourceLineCount(drafts: readonly DraftComment[]): number {
  return drafts.reduce((count, draft) => count + commentLineAnchors(draft).length, 0);
}

function parseSubject(value: unknown, source: string, allowRange: boolean): CommentSubject | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "range" && allowRange) {
    const raw = value["parts"];
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return null;
    const parts: RangeSelectionPart[] = [];
    for (const item of raw) {
      if (
        !isRecord(item) ||
        !Array.isArray(item["anchors"]) ||
        item["anchors"].length > maxFeedbackRangeLines ||
        typeof item["start"] !== "number" ||
        typeof item["end"] !== "number" ||
        typeof item["text"] !== "string" ||
        item["text"].length > maxFeedbackRangeText
      )
        return null;
      const anchors: CommentAnchor[] = [];
      for (const rawAnchor of item["anchors"]) {
        const anchor = parseAnchor(rawAnchor);
        if (anchor === null) return null;
        anchors.push(anchor);
      }
      parts.push({ anchors, start: item["start"], end: item["end"], text: item["text"] });
    }
    return rangeSubject(parts);
  }
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

function parseDraft(value: unknown, allowRange: boolean): DraftComment | null {
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
  const subject = parseSubject(value["subject"], anchor.sourceText, allowRange);
  if (subject === null) return null;
  if (subject.kind === "range") {
    const first = subject.parts[0]?.anchors[0];
    if (first === undefined || !sameAnchor(anchor, first)) return null;
  }
  return { id, anchor, subject, body, createdAt, updatedAt, state };
}

function validateStoreVersion(
  value: unknown,
  projectPath: string,
  version: 4 | 5,
): CommentStore | null {
  if (
    !isRecord(value) ||
    value["version"] !== version ||
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
    const draft = parseDraft(item, version === 5);
    if (draft === null || ids.has(draft.id)) return null;
    ids.add(draft.id);
    drafts.push(draft);
  }
  if (commentSourceLineCount(drafts) > maxFeedbackCheckLines) return null;
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
      const comment = parseDraft(raw, version === 5);
      if (comment === null || comment.state !== "current") return null;
      comments.push(comment);
    }
    if (commentSourceLineCount(comments) > maxFeedbackCheckLines) return null;
    history.push({ id: item["id"], copiedAt: item["copiedAt"], text: item["text"], comments });
  }
  return { version: 5, projectPath, drafts, history };
}

export function validateCommentStore(value: unknown, projectPath: string): CommentStore | null {
  return validateStoreVersion(value, projectPath, 5);
}

export function upgradeCommentStore(value: unknown, projectPath: string): CommentStore | null {
  return validateStoreVersion(value, projectPath, 4);
}

export function parseCommentStore(value: unknown, projectPath: string): CommentStore {
  return validateCommentStore(value, projectPath) ?? emptyCommentStore(projectPath);
}

export function readCommentStore(
  projectPath: string,
  onNotice: (message: string) => void = () => {},
): CommentStore {
  try {
    const raw = localStorage.getItem(`${commentStoragePrefix}${encodeURIComponent(projectPath)}`);
    if (raw === null) {
      const previousKey = `${previousCommentStoragePrefix}${encodeURIComponent(projectPath)}`;
      const previous = localStorage.getItem(previousKey);
      if (previous === null) return emptyCommentStore(projectPath);
      const converted = upgradeCommentStore(JSON.parse(previous) as unknown, projectPath);
      if (converted === null) return emptyCommentStore(projectPath);
      if (saveCommentStore(converted)) {
        try {
          localStorage.removeItem(previousKey);
        } catch {
          /* The converted store is already safe. */
        }
      } else
        onNotice(
          "Previous feedback was loaded in memory, but its upgraded format could not be saved. The previous saved data is preserved.",
        );
      return converted;
    }
    const value: unknown = JSON.parse(raw);
    const store = validateCommentStore(value, projectPath);
    if (store === null) return emptyCommentStore(projectPath);
    return store;
  } catch {
    return emptyCommentStore(projectPath);
  }
}

export function saveCommentStore(store: CommentStore): boolean {
  try {
    localStorage.setItem(
      `${commentStoragePrefix}${encodeURIComponent(store.projectPath)}`,
      JSON.stringify(store),
    );
    return true;
  } catch {
    /* Storage denial does not stop the current review session. */
    return false;
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

export function anchorMatches(result: DiffResult, anchor: FeedbackAnchor): boolean {
  if (anchor.kind === "range")
    return anchor.parts.flat().every((line) => anchorMatches(result, line));
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
    if (draft.subject.kind === "range") {
      for (const part of draft.subject.parts) {
        const first = part.anchors[0];
        const last = part.anchors.at(-1);
        if (first === undefined || last === undefined) continue;
        const source = rangeSourceText(part);
        const endColumn = part.end - (source.length - last.sourceText.length);
        lines.push(
          `  ${first.kind === "diff" ? `${first.side} ` : ""}${first.line === last.line ? `line ${first.line}` : `lines ${first.line}–${last.line}`}  ${quote(source)}`,
        );
        lines.push(
          `    selected ${quote(part.text)} (from line ${first.line}, column ${part.start + 1} to ${endColumn === 0 ? `the start of line ${last.line}` : `line ${last.line}, column ${endColumn}`})`,
        );
      }
      for (const bodyLine of draft.body.trim().split(/\r?\n/)) lines.push(`    ${bodyLine}`);
      continue;
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
  if (first.kind === "range")
    return (
      second.kind === "range" &&
      first.parts.length === second.parts.length &&
      first.parts.every((part, index) => {
        const other = second.parts[index];
        return (
          other !== undefined &&
          part.start === other.start &&
          part.end === other.end &&
          part.text === other.text &&
          part.anchors.length === other.anchors.length &&
          part.anchors.every((anchor, line) => {
            const next = other.anchors[line];
            return next !== undefined && sameAnchor(anchor, next);
          })
        );
      })
    );
  return (
    first.kind === second.kind &&
    (first.kind === "line" ||
      (second.kind === "selection" &&
        first.start === second.start &&
        first.end === second.end &&
        first.text === second.text))
  );
}

function cloneSubject(subject: CommentSubject): CommentSubject {
  return subject.kind === "range"
    ? {
        kind: "range",
        parts: subject.parts.map((part) => ({
          ...part,
          anchors: part.anchors.map((anchor) => ({ ...anchor })),
        })),
      }
    : { ...subject };
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
            subject: cloneSubject(draft.subject),
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
  if (
    store.drafts.length + restored.length > maxDrafts ||
    commentSourceLineCount([...store.drafts, ...restored]) > maxFeedbackCheckLines
  )
    return store;
  return { ...store, drafts: [...store.drafts, ...restored], history: store.history.slice(1) };
}
