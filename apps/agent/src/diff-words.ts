import type { DiffLine, DiffResult, TextSpan } from "@git-review/shared/api";

const unitPattern = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
const maxLineLength = 4096;
const maxUnitsPerLine = 512;
const maxLinePairsPerChunk = 65_536;
const maxTokenCellsPerComparison = 32_768;
const maxSpansPerLine = 256;

type Unit = { text: string; start: number; end: number };
type LineUnits = { line: DiffLine; units: Unit[]; counts: Map<string, number>; weight: number };
type Pair = { old: LineUnits; next: LineUnits };
type ComparedUnit = Unit & { line: DiffLine | null };
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

function comparisonGroups(old: LineUnits[], next: LineUnits[], pairs: Pair[]): Pair[][] {
  const groups: Pair[][] = [];
  let group: Pair[] = [];
  let previousOld = -1;
  let previousNew = -1;
  for (const pair of [...pairs, null]) {
    const oldIndex = pair === null ? old.length : old.indexOf(pair.old);
    const newIndex = pair === null ? next.length : next.indexOf(pair.next);
    const oldGap = oldIndex - previousOld - 1;
    const newGap = newIndex - previousNew - 1;
    // A lone replacement between confident anchors (or a chunk edge) needs no
    // similarity threshold. Larger ambiguous gaps remain full-row changes.
    if (oldGap === 1 && newGap === 1) {
      const before = old[previousOld + 1];
      const after = next[previousNew + 1];
      if (before !== undefined && after !== undefined) group.push({ old: before, next: after });
    } else if (oldGap > 0 || newGap > 0) {
      if (group.length > 0) groups.push(group);
      group = [];
    }
    if (pair !== null) group.push(pair);
    previousOld = oldIndex;
    previousNew = newIndex;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

function comparisonUnits(pairs: Pair[]): { old: ComparedUnit[]; next: ComparedUnit[] } {
  const rows = pairs.flatMap((pair) => [pair.old, pair.next]);
  const first = rows[0];
  let prefix = 0;
  // Keep shared indentation/comment leaders out of cross-line alignment. They
  // otherwise compete with words that reflow across those leaders.
  while (
    first?.units[prefix] !== undefined &&
    rows.every((row) => row.units[prefix]?.text === first.units[prefix]?.text)
  )
    prefix += 1;
  const flatten = (side: "old" | "next"): ComparedUnit[] =>
    pairs.flatMap((pair, index) => {
      const row = pair[side];
      const units: ComparedUnit[] = row.units
        .slice(prefix)
        .map((unit) => ({ ...unit, line: row.line }));
      // A source line break acts as a space for word matching, but has no span
      // in either original row. Rewrapping therefore does not add/remove words.
      if (index < pairs.length - 1) units.push({ text: " ", start: 0, end: 0, line: null });
      return units;
    });
  return { old: flatten("old"), next: flatten("next") };
}

function unmatchedSpans(units: ComparedUnit[], matched: Uint8Array): Map<DiffLine, TextSpan[]> {
  const byLine = new Map<DiffLine, TextSpan[]>();
  for (let index = 0; index < units.length; index += 1) {
    if (matched[index] === 1) continue;
    const unit = units[index];
    if (unit === undefined || unit.line === null) continue;
    let spans = byLine.get(unit.line);
    if (spans === undefined) {
      spans = [];
      byLine.set(unit.line, spans);
    }
    const previous = spans[spans.length - 1];
    if (previous !== undefined && /^\s*$/u.test(unit.line.text.slice(previous.end, unit.start)))
      previous.end = unit.end;
    else spans.push({ start: unit.start, end: unit.end });
  }
  return byLine;
}

function wordSpans(old: ComparedUnit[], next: ComparedUnit[]): Map<DiffLine, TextSpan[]> | null {
  const width = next.length + 1;
  const best = new Uint32Array((old.length + 1) * width);
  const bestAt = (i: number, j: number): number => best[i * width + j] ?? 0;
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      best[i * width + j] =
        old[i]?.text === next[j]?.text
          ? bestAt(i + 1, j + 1) + (old[i]?.text.trim().length ?? 0)
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
  const spans = new Map([...unmatchedSpans(old, oldMatched), ...unmatchedSpans(next, nextMatched)]);
  if ([...spans.values()].some((lineSpans) => lineSpans.length > maxSpansPerLine)) return null;
  return spans;
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
      const before = old.filter((row): row is LineUnits => row !== null);
      const after = next.filter((row): row is LineUnits => row !== null);
      const compare = (pairs: Pair[]): boolean => {
        const units = comparisonUnits(pairs);
        const cells = units.old.length * units.next.length;
        if (cells > maxTokenCellsPerComparison || cells > tokenCellBudget) return false;
        tokenCellBudget -= cells;
        const spans = wordSpans(units.old, units.next);
        if (spans !== null)
          for (const [line, lineSpans] of spans)
            line.detail = { kind: "word_change", spans: lineSpans };
        return true;
      };
      for (const group of comparisonGroups(before, after, orderedPairs(before, after))) {
        if (!compare(group) && group.length > 1) for (const pair of group) compare([pair]);
      }
    }
  }
  return diff;
}
