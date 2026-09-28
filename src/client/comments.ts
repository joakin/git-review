import type { ChangeLayer, DiffHunk, DiffResult } from "../shared/api.ts";
import { isRecord } from "../shared/validation.ts";

export type ReviewSide = "old" | "new";
export type CommentAnchor = {
  layer: ChangeLayer;
  path: string;
  side: ReviewSide;
  line: number;
  sourceText: string;
  before: string | null;
  after: string | null;
};
export type DraftComment = {
  id: string;
  anchor: CommentAnchor;
  body: string;
  createdAt: number;
  updatedAt: number;
  state: "current" | "outdated";
};
export type FeedbackHistory = { id: string; copiedAt: number; text: string; comments: DraftComment[] };
export type CommentStore = { version: 1; projectId: string; drafts: DraftComment[]; history: FeedbackHistory[] };

const prefix = "git-review:comments:v1:";
export const maxBodyLength = 5000;
export const maxDrafts = 200;
const maxHistory = 20;

export function newLocalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emptyCommentStore(projectId: string): CommentStore {
  return { version: 1, projectId, drafts: [], history: [] };
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}

function parseAnchor(value: unknown): CommentAnchor | null {
  if (!isRecord(value)) return null;
  const { layer, path, side, line, sourceText, before, after } = value;
  if (layer !== "staged" && layer !== "unstaged" && layer !== "untracked") return null;
  if (!validText(path, 4096) || path.length === 0 || !validText(sourceText, 20_000)) return null;
  if (side !== "old" && side !== "new") return null;
  if (!Number.isSafeInteger(line) || typeof line !== "number" || line <= 0) return null;
  if (!(before === null || validText(before, 20_000)) || !(after === null || validText(after, 20_000))) return null;
  return { layer, path, side, line, sourceText, before, after };
}

function parseDraft(value: unknown): DraftComment | null {
  if (!isRecord(value)) return null;
  const { id, body, createdAt, updatedAt, state } = value;
  const anchor = parseAnchor(value["anchor"]);
  if (anchor === null || !validText(id, 100) || id.length === 0 || !validText(body, maxBodyLength) || body.trim().length === 0) return null;
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0 || typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < createdAt) return null;
  if (state !== "current" && state !== "outdated") return null;
  return { id, anchor, body, createdAt, updatedAt, state };
}

export function parseCommentStore(value: unknown, projectId: string): CommentStore {
  const empty = emptyCommentStore(projectId);
  if (!isRecord(value) || value["version"] !== 1 || value["projectId"] !== projectId) return empty;
  if (!Array.isArray(value["drafts"]) || value["drafts"].length > maxDrafts || !Array.isArray(value["history"]) || value["history"].length > maxHistory) return empty;
  const drafts: DraftComment[] = [];
  const ids = new Set<string>();
  for (const item of value["drafts"]) {
    const draft = parseDraft(item);
    if (draft === null || ids.has(draft.id)) return empty;
    ids.add(draft.id);
    drafts.push(draft);
  }
  const history: FeedbackHistory[] = [];
  for (const item of value["history"]) {
    if (!isRecord(item) || !validText(item["id"], 100) || item["id"].length === 0 || !validText(item["text"], 250_000) || typeof item["copiedAt"] !== "number" || !Number.isSafeInteger(item["copiedAt"]) || item["copiedAt"] < 0 || !Array.isArray(item["comments"]) || item["comments"].length > maxDrafts) return empty;
    const comments: DraftComment[] = [];
    for (const raw of item["comments"]) {
      const comment = parseDraft(raw);
      if (comment === null || comment.state !== "current") return empty;
      comments.push(comment);
    }
    history.push({ id: item["id"], copiedAt: item["copiedAt"], text: item["text"], comments });
  }
  return { version: 1, projectId, drafts, history };
}

export function readCommentStore(projectId: string): CommentStore {
  try {
    const raw = localStorage.getItem(`${prefix}${projectId}`);
    return raw === null ? emptyCommentStore(projectId) : parseCommentStore(JSON.parse(raw) as unknown, projectId);
  } catch { return emptyCommentStore(projectId); }
}

export function saveCommentStore(store: CommentStore): void {
  try { localStorage.setItem(`${prefix}${store.projectId}`, JSON.stringify(store)); }
  catch { /* Storage denial does not stop the current review session. */ }
}

export function anchorForLine(layer: ChangeLayer, path: string, hunk: DiffHunk, index: number, side: ReviewSide): CommentAnchor | null {
  const line = hunk.lines[index];
  if (line === undefined || layer === "conflict") return null;
  const number = side === "old" ? line.oldLine : line.newLine;
  if (number === null) return null;
  const sideText = (offset: number): string | null => {
    const other = hunk.lines[index + offset];
    return other !== undefined && (side === "old" ? other.oldLine : other.newLine) !== null ? other.text : null;
  };
  return { layer, path, side, line: number, sourceText: line.text, before: sideText(-1), after: sideText(1) };
}

export function anchorMatches(result: DiffResult, anchor: CommentAnchor): boolean {
  if (result.kind !== "text") return false;
  for (const hunk of result.hunks) {
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const current = anchorForLine(anchor.layer, anchor.path, hunk, index, anchor.side);
      if (current !== null && current.line === anchor.line && current.sourceText === anchor.sourceText && current.before === anchor.before && current.after === anchor.after) return true;
    }
  }
  return false;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function formatFeedback(projectPath: string, drafts: readonly DraftComment[]): string {
  const layerOrder: Record<CommentAnchor["layer"], number> = { staged: 0, unstaged: 1, untracked: 2, conflict: 3 };
  const sorted = drafts.filter((draft) => draft.state === "current").sort((a, b) =>
    layerOrder[a.anchor.layer] - layerOrder[b.anchor.layer] || a.anchor.path.localeCompare(b.anchor.path) || a.anchor.line - b.anchor.line || a.anchor.side.localeCompare(b.anchor.side) || a.createdAt - b.createdAt,
  );
  if (sorted.length === 0) return "";
  const lines = [`Review feedback for ${quote(projectPath)}`];
  let group = "";
  for (const draft of sorted) {
    const nextGroup = `${draft.anchor.layer}:${draft.anchor.path}`;
    if (nextGroup !== group) {
      lines.push("", `[${draft.anchor.layer}] ${quote(draft.anchor.path)}`);
      group = nextGroup;
    }
    lines.push(`  ${draft.anchor.side} line ${draft.anchor.line}  ${quote(draft.anchor.sourceText)}`);
    for (const bodyLine of draft.body.trim().split(/\r?\n/)) lines.push(`    ${bodyLine}`);
  }
  return lines.join("\n");
}

export function recordSuccessfulCopy(store: CommentStore, text: string, copiedAt: number, id: string): CommentStore {
  const copied = store.drafts.filter((draft) => draft.state === "current");
  if (copied.length === 0 || text.length === 0) return store;
  const entry: FeedbackHistory = { id, copiedAt, text, comments: copied };
  return { ...store, drafts: store.drafts.filter((draft) => draft.state === "outdated"), history: [entry, ...store.history].slice(0, maxHistory) };
}
