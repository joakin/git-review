import { parseDiffResponse, type DiffHunk, type DiffLine } from "./api.ts";
import { parseChangeSnapshot, type ChangeSnapshot } from "./change-snapshot.ts";
import { parseDiffFileFields, type DiffFileRequest } from "./diff-request.ts";
import { isChangeLayer, type ChangeLayer } from "./api.ts";
import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";

export const contextStep = 20;
export const maxContextBodyBytes = 2 * 1024 * 1024;
export const maxContextResponseBytes = 2 * 1024 * 1024;
export const maxContextAnchors = 100;
export const maxContextAnchorText = 20_000;

export type DiffContextGap = { id: number; oldStart: number; newStart: number; count: number };
export type DiffContextMetadata =
  | {
      kind: "available";
      source: string;
      oldLines: number;
      newLines: number;
      gaps: DiffContextGap[];
    }
  | { kind: "unavailable"; reason: "limit" | "source" };
export type ContextNeighbors =
  { kind: "available"; before: string | null; after: string | null } | { kind: "unavailable" };
export type DiffContextLine = DiffLine & {
  kind: "context";
  oldLine: number;
  newLine: number;
  detail: { kind: "none" };
  neighbors: { old: ContextNeighbors; new: ContextNeighbors };
};
export type ContextAnchor = {
  side: "old" | "new";
  line: number;
  sourceText: string;
  before: string | null;
  after: string | null;
};
type ContextFile = ChangeSnapshot & DiffFileRequest & { layer: ChangeLayer };
export type DiffContextRequest = ContextFile &
  (
    | {
        kind: "expand";
        source: string;
        gap: number;
        up: number;
        down: number;
        direction: "up" | "down";
      }
    | { kind: "check"; anchors: ContextAnchor[] }
  );
export type DiffContextResponse =
  | { kind: "stale" }
  | { kind: "unavailable"; reason: "limit" | "source" }
  | { kind: "checked"; matches: boolean[] }
  | { kind: "expanded"; source: string; gap: number; offset: number; lines: DiffContextLine[] };

/** Starts are zero-based offsets here, including Git's zero-count boundary convention. */
export function contextGaps(
  hunks: readonly DiffHunk[],
  oldLines: number,
  newLines: number,
): DiffContextGap[] {
  const gaps: DiffContextGap[] = [];
  let oldEnd = 0;
  let newEnd = 0;
  for (let id = 0; id <= hunks.length; id += 1) {
    const hunk = hunks[id];
    const oldFrom = hunk === undefined ? oldLines : hunk.oldStart - (hunk.oldCount === 0 ? 0 : 1);
    const newFrom = hunk === undefined ? newLines : hunk.newStart - (hunk.newCount === 0 ? 0 : 1);
    const count = oldFrom - oldEnd;
    if (count < 0 || count !== newFrom - newEnd || oldFrom > oldLines || newFrom > newLines)
      throw new Error("Diff context ranges do not match source bounds");
    if (count > 0) gaps.push({ id, oldStart: oldEnd + 1, newStart: newEnd + 1, count });
    if (hunk !== undefined) {
      oldEnd = oldFrom + hunk.oldCount;
      newEnd = newFrom + hunk.newCount;
      if (oldEnd > oldLines || newEnd > newLines) throw new Error("Diff hunk exceeds its source");
    }
  }
  return gaps;
}

function sourceId(value: unknown): string {
  const source = expectString(value, "context source");
  if (!/^[a-f0-9]{64}$/.test(source)) throw new Error("Invalid context source");
  return source;
}

export function parseDiffContextMetadata(
  value: unknown,
  hunks: readonly DiffHunk[],
): DiffContextMetadata {
  const outer = expectRecord(value, "context metadata");
  if (outer["kind"] === "unavailable") {
    const reason = outer["reason"];
    if (reason !== "limit" && reason !== "source")
      throw new Error("Invalid context unavailability");
    return { kind: "unavailable", reason };
  }
  if (outer["kind"] !== "available") throw new Error("Invalid context capability");
  const oldLines = expectNonNegativeInteger(outer["oldLines"], "old source lines");
  const newLines = expectNonNegativeInteger(outer["newLines"], "new source lines");
  if (oldLines > 1024 * 1024 || newLines > 1024 * 1024)
    throw new Error("Context source exceeds its line budget");
  const gaps = contextGaps(hunks, oldLines, newLines);
  const rawGaps = outer["gaps"];
  if (!Array.isArray(rawGaps) || rawGaps.length !== gaps.length)
    throw new Error("Context gaps do not match diff");
  for (let index = 0; index < gaps.length; index += 1) {
    const raw = expectRecord(rawGaps[index], "context gap");
    const gap = gaps[index];
    if (
      gap === undefined ||
      raw["id"] !== gap.id ||
      raw["oldStart"] !== gap.oldStart ||
      raw["newStart"] !== gap.newStart ||
      raw["count"] !== gap.count
    )
      throw new Error("Context gaps do not match diff");
  }
  return { kind: "available", source: sourceId(outer["source"]), oldLines, newLines, gaps };
}

function anchorText(value: unknown): string {
  const text = expectString(value, "anchor source text");
  if (text.length > maxContextAnchorText || text.includes("\n") || text.includes("\0"))
    throw new Error("Invalid anchor text");
  return text;
}

function neighbor(value: unknown): string | null {
  return value === null ? null : anchorText(value);
}

export function parseDiffContextRequest(value: unknown): DiffContextRequest {
  const outer = expectRecord(value, "context request");
  const layer = outer["layer"];
  if (!isChangeLayer(layer) || layer === "conflict") throw new Error("Invalid context layer");
  const common = { ...parseChangeSnapshot(outer), ...parseDiffFileFields(outer), layer };
  const commonKeys = ["kind", "revision", "changeToken", "layer", "path", "language"];
  if (outer["kind"] === "expand") {
    if (
      Object.keys(outer).some(
        (key) => ![...commonKeys, "source", "gap", "up", "down", "direction"].includes(key),
      )
    )
      throw new Error("Unexpected context field");
    const direction = outer["direction"];
    if (direction !== "up" && direction !== "down") throw new Error("Invalid context direction");
    return {
      ...common,
      kind: "expand",
      source: sourceId(outer["source"]),
      gap: expectNonNegativeInteger(outer["gap"], "gap"),
      up: expectNonNegativeInteger(outer["up"], "up count"),
      down: expectNonNegativeInteger(outer["down"], "down count"),
      direction,
    };
  }
  if (
    outer["kind"] !== "check" ||
    Object.keys(outer).some((key) => ![...commonKeys, "anchors"].includes(key))
  )
    throw new Error("Invalid context operation");
  const raw = outer["anchors"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxContextAnchors)
    throw new Error("Expected bounded context anchors");
  const anchors = raw.map((value: unknown): ContextAnchor => {
    const anchor = expectRecord(value, "context anchor");
    if (
      Object.keys(anchor).some(
        (key) => !["side", "line", "sourceText", "before", "after"].includes(key),
      )
    )
      throw new Error("Unexpected anchor field");
    const side = anchor["side"];
    const line = expectNonNegativeInteger(anchor["line"], "anchor line");
    if ((side !== "old" && side !== "new") || line === 0) throw new Error("Invalid context anchor");
    return {
      side,
      line,
      sourceText: anchorText(anchor["sourceText"]),
      before: neighbor(anchor["before"]),
      after: neighbor(anchor["after"]),
    };
  });
  return { ...common, kind: "check", anchors };
}

export function parseDiffContextResponse(
  value: unknown,
  request: DiffContextRequest,
  gap: DiffContextGap | null,
): DiffContextResponse {
  const outer = expectRecord(value, "context response");
  if (outer["kind"] === "stale") return { kind: "stale" };
  if (outer["kind"] === "unavailable") {
    const reason = outer["reason"];
    if (reason !== "limit" && reason !== "source") throw new Error("Invalid context reason");
    return { kind: "unavailable", reason };
  }
  if (request.kind === "check") {
    const matches = outer["matches"];
    if (
      outer["kind"] !== "checked" ||
      !Array.isArray(matches) ||
      matches.length !== request.anchors.length ||
      !matches.every((match: unknown) => typeof match === "boolean")
    )
      throw new Error("Context anchor results do not match request");
    return { kind: "checked", matches };
  }
  if (
    gap === null ||
    gap.id !== request.gap ||
    outer["kind"] !== "expanded" ||
    outer["source"] !== request.source ||
    outer["gap"] !== gap.id
  )
    throw new Error("Context response does not match request");
  const count = Math.min(contextStep, gap.count - request.up - request.down);
  const offset = request.direction === "down" ? request.down : gap.count - request.up - count;
  if (count <= 0 || outer["offset"] !== offset)
    throw new Error("Context response range does not match request");
  const parsed = parseDiffResponse({
    kind: "text",
    syntax: { kind: "plain", reason: "unavailable" },
    hunks: [
      {
        oldStart: gap.oldStart + offset,
        newStart: gap.newStart + offset,
        oldCount: count,
        newCount: count,
        lines: outer["lines"],
      },
    ],
  });
  if (parsed.kind !== "text") throw new Error("Expected text context");
  const rawLines = outer["lines"];
  if (!Array.isArray(rawLines)) throw new Error("Expected context lines");
  const lines = (parsed.hunks[0]?.lines ?? []).map((line, index): DiffContextLine => {
    if (
      line.kind !== "context" ||
      line.text.includes("\0") ||
      line.detail.kind !== "none" ||
      line.oldLine !== gap.oldStart + offset + index ||
      line.newLine !== gap.newStart + offset + index
    )
      throw new Error("Invalid context line coordinates");
    const raw = expectRecord(rawLines[index], "context line");
    const neighbors = expectRecord(raw["neighbors"], "source neighbors");
    const parseNeighbors = (value: unknown): ContextNeighbors => {
      const raw = expectRecord(value, "side neighbors");
      if (raw["kind"] === "unavailable") return { kind: "unavailable" };
      if (raw["kind"] !== "available") throw new Error("Invalid source neighbors");
      return { kind: "available", before: neighbor(raw["before"]), after: neighbor(raw["after"]) };
    };
    return {
      ...line,
      kind: "context",
      oldLine: gap.oldStart + offset + index,
      newLine: gap.newStart + offset + index,
      detail: { kind: "none" },
      neighbors: { old: parseNeighbors(neighbors["old"]), new: parseNeighbors(neighbors["new"]) },
    };
  });
  return { kind: "expanded", source: request.source, gap: gap.id, offset, lines };
}
