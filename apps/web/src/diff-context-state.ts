import type { DiffHunk, DiffResult } from "@git-review/shared/api";
import type { DiffContextGap, DiffContextLine } from "@git-review/shared/diff-context";
import { ResourceCache } from "@git-review/shared/resource-cache";

export type ContextChunk = {
  gap: number;
  offset: number;
  direction: "up" | "down";
  hunk: DiffHunk;
  lines: DiffContextLine[];
};
export type ContextExpansion = { chunks: ContextChunk[] };
export const emptyContext: ContextExpansion = { chunks: [] };
const displayResources = new WeakMap<object, WeakMap<ContextExpansion, object>>();
export function contextDisplayResource(diff: DiffResult, data: ContextExpansion): object {
  if (data.chunks.length === 0) return diff;
  let versions = displayResources.get(diff);
  if (versions === undefined) {
    versions = new WeakMap();
    displayResources.set(diff, versions);
  }
  let resource = versions.get(data);
  if (resource === undefined) {
    resource = {};
    versions.set(data, resource);
  }
  return resource;
}
export const contextCache = new ResourceCache<{ language: string | null; data: ContextExpansion }>(
  128,
  16 * 1024 * 1024,
);

export function consumedContext(data: ContextExpansion, gap: DiffContextGap) {
  let up = 0;
  let down = 0;
  for (const chunk of data.chunks) {
    if (chunk.gap !== gap.id) continue;
    if (chunk.direction === "up") up += chunk.lines.length;
    else down += chunk.lines.length;
  }
  return { up, down, remaining: gap.count - up - down };
}

export function appendContext(
  data: ContextExpansion,
  diff: Extract<DiffResult, { kind: "text" }>,
  gap: DiffContextGap,
  direction: "up" | "down",
  offset: number,
  lines: DiffContextLine[],
): ContextExpansion {
  const consumed = consumedContext(data, gap);
  if (
    offset !== (direction === "down" ? consumed.down : gap.count - consumed.up - lines.length) ||
    lines.length === 0 ||
    lines.length > consumed.remaining
  )
    throw new Error("Context overlaps an existing range");
  const hunk: DiffHunk = {
    oldStart: gap.oldStart + offset,
    newStart: gap.newStart + offset,
    oldCount: lines.length,
    newCount: lines.length,
    lines,
  };
  const next = { chunks: [...data.chunks, { gap: gap.id, offset, direction, hunk, lines }] };
  const all = [
    ...diff.hunks.flatMap((hunk) => hunk.lines),
    ...next.chunks.flatMap((chunk) => chunk.lines),
  ];
  if (
    all.length > 20_000 ||
    all.reduce((sum, line) => sum + line.tokens.length, 0) > 100_000 ||
    JSON.stringify(next).length * 2 > 8 * 1024 * 1024
  )
    throw new Error("The displayed context limit has been reached");
  return next;
}

export function plainContext(data: ContextExpansion): ContextExpansion {
  return {
    chunks: data.chunks.map((chunk) => {
      const lines = chunk.lines.map((line): DiffContextLine => ({
        ...line,
        tokens: [{ text: line.text, role: "plain" }],
      }));
      return { ...chunk, lines, hunk: { ...chunk.hunk, lines } };
    }),
  };
}

/** Capture at response acceptance, so a reader can scroll freely while a request is pending. */
export function preserveContextPosition(separator: HTMLElement): () => void {
  const card = separator.closest(".diff-card");
  if (!(card instanceof HTMLElement)) return () => {};
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const rows = Array.from(card.querySelectorAll<HTMLElement>(".diff-row"));
  const row =
    rows.find(
      (row) =>
        row.getBoundingClientRect().bottom > top &&
        row.getBoundingClientRect().top < window.innerHeight,
    ) ??
    rows.find((row) => row.getBoundingClientRect().top > separator.getBoundingClientRect().top) ??
    rows.at(-1);
  const position = row?.getBoundingClientRect().top;
  const focused = separator.contains(document.activeElement);
  return () => {
    if (row?.isConnected && position !== undefined)
      window.scrollBy(0, row.getBoundingClientRect().top - position);
    if (focused && !separator.isConnected && row?.isConnected)
      Array.from(
        row.querySelectorAll<HTMLButtonElement>(".diff-number-button, .diff-mobile-line-trigger"),
      )
        .find((button) => button.getClientRects().length > 0)
        ?.focus({ preventScroll: true });
  };
}
