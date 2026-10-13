import type { Project } from "@git-review/shared/api";
import {
  expectGitOid,
  parseCommitStats,
  type CommitComparison,
  type CommitStats,
} from "@git-review/shared/git";
import { AppError } from "./paths.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import { readNumstatRecord } from "./git-numstat.ts";

type ReadyStats = Extract<CommitStats, { kind: "ready" }>;
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxBatchBytes = 8 * 1024 * 1024;
// Immutable totals only; unavailable states can recover after local objects arrive.
const cache = new Map<string, ReadyStats>();

function cacheKey(project: Project, oid: string): string {
  return `${project.absolutePath}\0${oid}`;
}
function remember(project: Project, oid: string, stats: ReadyStats): void {
  const key = cacheKey(project, oid);
  cache.delete(key);
  cache.set(key, stats);
  while (cache.size > 256) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function commitParents(raw: Buffer, oidLength: number): string[] {
  const end = raw.indexOf("\n\n");
  if (end < 0) throw new Error("Invalid Git commit object");
  const parents = raw
    .subarray(0, end)
    .toString("latin1")
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => expectGitOid(line.slice(7)));
  if (parents.length > 64 || parents.some((oid) => oid.length !== oidLength))
    throw new Error("Invalid Git commit parents");
  return parents;
}

function batchParents(output: Buffer, oids: readonly string[]): Map<string, string | null> {
  let offset = 0;
  const result = new Map<string, string | null>();
  for (const oid of oids) {
    const end = output.indexOf("\n", offset);
    if (end < 0) throw new Error("Incomplete Git commit batch");
    const header = decoder.decode(output.subarray(offset, end));
    if (header === `${oid} missing`)
      throw new AppError(
        "not_found",
        404,
        "A commit in this history snapshot is no longer available",
      );
    const fields = header.split(" ");
    const sizeText = fields[2];
    if (
      fields.length !== 3 ||
      fields[0] !== oid ||
      fields[1] !== "commit" ||
      sizeText === undefined ||
      !/^(?:0|[1-9][0-9]*)$/.test(sizeText)
    )
      throw new Error("Invalid Git commit batch record");
    const size = Number(sizeText);
    const start = end + 1;
    if (
      !Number.isSafeInteger(size) ||
      size > output.length - start - 1 ||
      output[start + size] !== 10
    )
      throw new Error("Incomplete Git commit batch content");
    result.set(oid, commitParents(output.subarray(start, start + size), oid.length)[0] ?? null);
    offset = start + size + 1;
  }
  if (offset !== output.length) throw new Error("Unexpected Git commit batch content");
  return result;
}

async function availableParents(
  project: Project,
  parents: readonly string[],
): Promise<Set<string>> {
  if (parents.length === 0) return new Set();
  const output = decoder.decode(
    await runGit(
      project.absolutePath,
      ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
      16 * 1024,
      parents.join("\n") + "\n",
    ),
  );
  const rows = output.split("\n");
  if (rows.pop() !== "" || rows.length !== parents.length)
    throw new Error("Incomplete Git parent inventory");
  const found = new Set<string>();
  rows.forEach((row, index) => {
    const oid = parents[index];
    if (oid === undefined || (row !== `${oid} missing` && row !== `${oid} commit`))
      throw new Error("Invalid Git parent inventory");
    if (row.endsWith(" commit")) found.add(oid);
  });
  return found;
}

function parseTotals(output: Buffer, oids: readonly string[]): Map<string, ReadyStats> {
  const totals = new Map<string, ReadyStats>(
    oids.map((oid) => [oid, { kind: "ready", added: 0, deleted: 0, binaryFiles: 0 }]),
  );
  if (output.length === 0) return totals; // diff-tree omits unchanged/empty commits.
  const records = decoder.decode(output).split("\0");
  if (records.pop() !== "") throw new Error("Incomplete Git numeric stats");
  let current: ReadyStats | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) throw new Error("Incomplete Git numeric stat record");
    if (!record.includes("\t")) {
      current = totals.get(record) ?? null;
      if (current === null) throw new Error("Unexpected Git stats commit");
      continue;
    }
    if (current === null) throw new Error("Unexpected Git numeric stat record");
    const { stats, nextIndex } = readNumstatRecord(records, index);
    index = nextIndex - 1;
    if (stats.kind === "binary") current.binaryFiles += 1;
    else {
      current.added += stats.added;
      current.deleted += stats.deleted;
    }
    parseCommitStats(current); // Reject unsafe totals before constructing the response.
  }
  return totals;
}

function atLimit(error: unknown): boolean {
  return (
    error instanceof GitCommandError &&
    (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.code === "ETIMEDOUT")
  );
}

async function compare(
  project: Project,
  pairs: ReadonlyMap<string, string | null>,
): Promise<Map<string, ReadyStats>> {
  if (pairs.size === 0) return new Map();
  const input = [...pairs]
    .map(([oid, parent]) => `${oid}${parent === null ? "" : ` ${parent}`}\n`)
    .join("");
  const output = await runGit(
    project.absolutePath,
    [
      "diff-tree",
      "--stdin",
      "--numstat",
      "-z",
      "-r",
      "--root",
      "--relative",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--find-renames",
      "--",
      ".",
    ],
    maxBatchBytes,
    input,
  );
  const totals = parseTotals(output, [...pairs.keys()]);
  for (const [oid, stats] of totals) remember(project, oid, stats);
  return totals;
}

export async function readHistoryStats(
  project: Project,
  oids: readonly string[],
): Promise<ReadonlyMap<string, CommitStats>> {
  const results = new Map<string, CommitStats>();
  const missing = oids.filter((oid) => {
    const cached = cache.get(cacheKey(project, oid));
    if (cached === undefined) return true;
    results.set(oid, cached);
    return false;
  });
  if (missing.length === 0) return results;
  try {
    const parents = batchParents(
      await runGit(
        project.absolutePath,
        ["cat-file", "--batch"],
        maxBatchBytes,
        missing.join("\n") + "\n",
      ),
      missing,
    );
    const found = await availableParents(project, [
      ...new Set([...parents.values()].filter((oid) => oid !== null)),
    ]);
    const pairs = new Map<string, string | null>();
    for (const [oid, parent] of parents) {
      if (parent !== null && !found.has(parent))
        results.set(oid, { kind: "unavailable", reason: "missing_parent" });
      else pairs.set(oid, parent);
    }
    for (const [oid, stats] of await compare(project, pairs)) results.set(oid, stats);
  } catch (error: unknown) {
    if (!atLimit(error)) throw error;
    for (const oid of missing)
      if (!results.has(oid)) results.set(oid, { kind: "unavailable", reason: "limit" });
  }
  return results;
}

export async function readCommitStats(
  project: Project,
  oid: string,
  comparison: CommitComparison,
): Promise<CommitStats> {
  if (comparison.kind === "missing_parent")
    return { kind: "unavailable", reason: "missing_parent" };
  const cached = cache.get(cacheKey(project, oid));
  if (cached !== undefined) return cached;
  try {
    const totals = await compare(
      project,
      new Map([[oid, comparison.kind === "empty" ? null : comparison.oid]]),
    );
    const stats = totals.get(oid);
    if (stats === undefined) throw new Error("Missing Git commit totals");
    return stats;
  } catch (error: unknown) {
    if (atLimit(error)) return { kind: "unavailable", reason: "limit" };
    throw error;
  }
}
