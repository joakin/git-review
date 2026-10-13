import type { DiffLine, DiffResult, TextSpan } from "@git-review/shared/api";

const unitPattern = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
const maxLineLength = 4096;
const maxUnitsPerLine = 512;
const maxLinePairsPerChunk = 65_536;
const maxTokenCellsPerPair = 32_768;
const maxSpansPerLine = 256;

type Unit = { text: string; start: number; end: number };
type LineUnits = { line: DiffLine; units: Unit[]; counts: Map<string, number>; weight: number };
type Pair = { old: LineUnits; next: LineUnits };
type TextDiff = Extract<DiffResult, { kind: "text" }>;

function unitsFor(line: DiffLine): LineUnits | null {
  if (line.text.length > maxLineLength) return null;
  const units: Unit[] = [];
  const counts = new Map<string, number>();
  let weight = 0;
  for (const match of line.text.matchAll(unitPattern)) {
    const text = match[0];
    const start = match.index;
    if (text === undefined || start === undefined) return null;
    const significant = !/^\s+$/u.test(text);
    units.push({ text, start, end: start + text.length });
    if (units.length > maxUnitsPerLine) return null;
    if (significant) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
      weight += text.length;
    }
  }
  return { line, units, counts, weight };
}

function similarity(old: LineUnits, next: LineUnits): number {
  if (old.weight === 0 || next.weight === 0) return 0;
  let shared = 0;
  for (const [unit, count] of old.counts) {
    shared += Math.min(count, next.counts.get(unit) ?? 0) * unit.length;
  }
  return Math.round((shared * 1000) / Math.max(old.weight, next.weight));
}

function orderedPairs(old: LineUnits[], next: LineUnits[]): Pair[] {
  if (old.length === 1 && next.length === 1) {
    const first = old[0];
    const second = next[0];
    return first === undefined || second === undefined ? [] : [{ old: first, next: second }];
  }
  const width = next.length + 1;
  const score = new Int16Array(old.length * next.length);
  const best = new Int32Array((old.length + 1) * width);
  const scoreAt = (i: number, j: number): number => score[i * next.length + j] ?? 0;
  const bestAt = (i: number, j: number): number => best[i * width + j] ?? 0;
  const unambiguous = (i: number, j: number): boolean => {
    const selected = scoreAt(i, j);
    for (let other = 0; other < next.length; other += 1) {
      if (other !== j && scoreAt(i, other) >= selected) return false;
    }
    for (let other = 0; other < old.length; other += 1) {
      if (other !== i && scoreAt(other, j) >= selected) return false;
    }
    return true;
  };
  for (let i = 0; i < old.length; i += 1) {
    const before = old[i];
    if (before === undefined) continue;
    for (let j = 0; j < next.length; j += 1) {
      const after = next[j];
      if (after !== undefined) score[i * next.length + j] = similarity(before, after);
    }
  }
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      const paired = scoreAt(i, j) >= 500 ? scoreAt(i, j) + bestAt(i + 1, j + 1) : 0;
      best[i * width + j] = Math.max(bestAt(i + 1, j), bestAt(i, j + 1), paired);
    }
  }
  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    const paired = scoreAt(i, j) >= 500 ? scoreAt(i, j) + bestAt(i + 1, j + 1) : 0;
    const skipOld = bestAt(i + 1, j);
    const skipNew = bestAt(i, j + 1);
    if (paired > skipOld && paired > skipNew) {
      const before = old[i];
      const after = next[j];
      if (before !== undefined && after !== undefined && unambiguous(i, j))
        pairs.push({ old: before, next: after });
      i += 1;
      j += 1;
    } else if (skipOld > skipNew) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function unmatchedSpans(units: Unit[], matched: Uint8Array): TextSpan[] {
  const spans: TextSpan[] = [];
  for (let index = 0; index < units.length; index += 1) {
    if (matched[index] === 1) continue;
    const unit = units[index];
    if (unit === undefined) continue;
    const previous = spans[spans.length - 1];
    if (previous !== undefined && previous.end === unit.start) previous.end = unit.end;
    else spans.push({ start: unit.start, end: unit.end });
  }
  return spans;
}

function wordSpans(old: Unit[], next: Unit[]): { old: TextSpan[]; next: TextSpan[] } | null {
  const width = next.length + 1;
  const best = new Uint16Array((old.length + 1) * width);
  const bestAt = (i: number, j: number): number => best[i * width + j] ?? 0;
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      best[i * width + j] =
        old[i]?.text === next[j]?.text
          ? bestAt(i + 1, j + 1) + 1
          : Math.max(bestAt(i + 1, j), bestAt(i, j + 1));
    }
  }
  const oldMatched = new Uint8Array(old.length);
  const nextMatched = new Uint8Array(next.length);
  let i = 0;
  let j = 0;
  while (i < old.length && j < next.length) {
    const before = old[i];
    const after = next[j];
    if (before !== undefined && after !== undefined && before.text === after.text) {
      oldMatched[i] = 1;
      nextMatched[j] = 1;
      i += 1;
      j += 1;
    } else if (bestAt(i + 1, j) >= bestAt(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const oldSpans = unmatchedSpans(old, oldMatched);
  const nextSpans = unmatchedSpans(next, nextMatched);
  if (oldSpans.length > maxSpansPerLine || nextSpans.length > maxSpansPerLine) return null;
  return { old: oldSpans, next: nextSpans };
}

export function withWordDetails(diff: TextDiff): TextDiff {
  let linePairBudget = 100_000;
  let tokenCellBudget = 2_000_000;
  for (const hunk of diff.hunks) {
    let cursor = 0;
    while (cursor < hunk.lines.length) {
      if (hunk.lines[cursor]?.kind === "context") {
        cursor += 1;
        continue;
      }
      const start = cursor;
      while (cursor < hunk.lines.length && hunk.lines[cursor]?.kind !== "context") cursor += 1;
      const changed = hunk.lines.slice(start, cursor);
      const oldRows = changed.filter((line) => line.kind === "removed");
      const newRows = changed.filter((line) => line.kind === "added");
      if (
        oldRows.length === 0 ||
        newRows.length === 0 ||
        oldRows.length > 256 ||
        newRows.length > 256
      )
        continue;
      const candidatePairs = oldRows.length * newRows.length;
      if (candidatePairs > maxLinePairsPerChunk || candidatePairs > linePairBudget) continue;
      linePairBudget -= candidatePairs;
      const old = oldRows.map(unitsFor);
      const next = newRows.map(unitsFor);
      if (old.some((row) => row === null) || next.some((row) => row === null)) continue;
      const pairs = orderedPairs(
        old.filter((row): row is LineUnits => row !== null),
        next.filter((row): row is LineUnits => row !== null),
      );
      for (const pair of pairs) {
        const cells = pair.old.units.length * pair.next.units.length;
        if (cells > maxTokenCellsPerPair || cells > tokenCellBudget) continue;
        tokenCellBudget -= cells;
        const spans = wordSpans(pair.old.units, pair.next.units);
        if (spans === null) continue;
        if (spans.old.length > 0) pair.old.line.detail = { kind: "word_change", spans: spans.old };
        if (spans.next.length > 0)
          pair.next.line.detail = { kind: "word_change", spans: spans.next };
      }
    }
  }
  return diff;
}
