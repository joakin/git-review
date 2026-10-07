import type {
  ChangeEntry,
  ChangeLineStats,
  Project,
  ProjectInventory,
  ProjectStatus,
  ReviewChangeEntry,
} from "../shared/api.ts";
import { parseChangeLineStats } from "../shared/api.ts";
import { validateChangeGroupTotals } from "../shared/change-line-stats.ts";
import { expectGitOid, gitPath } from "../shared/git.ts";
import { hasErrorCode } from "../shared/validation.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import { readNumstatRecord } from "./git-numstat.ts";
import { readProjectStatus } from "./git-status.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { workingDiffPaths } from "./working-diff-paths.ts";
import { maxSourceTextBytes, parseSourceText } from "./source-text.ts";
import { readWorkingContent } from "./working-text.ts";

const maxStatsBytes = 8 * 1024 * 1024;
const maxUntrackedFiles = 1000;
const maxRenameReads = 32;
const statsWorkMs = 10_000;
const readLimit: ChangeLineStats = { kind: "unavailable", reason: "limit" };
const missingStats: ChangeLineStats = { kind: "unavailable", reason: "read_error" };
type NumericRead =
  | { kind: "ready"; values: ReadonlyMap<string, ChangeLineStats> }
  | { kind: "unavailable"; reason: "limit" | "read_error" };

function addStats(left: ChangeLineStats, right: ChangeLineStats): ChangeLineStats {
  if (left.kind === "not_applicable") return left;
  if (right.kind === "not_applicable") return right;
  if (left.kind !== "text") return left;
  if (right.kind !== "text") return right;
  return parseChangeLineStats({
    kind: "text",
    added: left.added + right.added,
    deleted: left.deleted + right.deleted,
  });
}

/** Validate raw modes and numeric paths together; links are never counted as source text. */
export function parseChangeStats(output: Buffer): ReadonlyMap<string, ChangeLineStats> {
  if (output.length === 0) return new Map();
  const records = new TextDecoder("utf-8", { fatal: true }).decode(output).split("\0");
  if (records.pop() !== "") throw new Error("Incomplete Git change statistics");
  const modes = new Map<string, "text" | "symlink" | "submodule">();
  const origins = new Map<string, Set<string | null>>();
  let index = 0;
  while (records[index]?.startsWith(":")) {
    const match =
      /^:(000000|100644|100755|120000|160000) (000000|100644|100755|120000|160000) ([0-9a-f]+) ([0-9a-f]+) ([AMDTU]|[RC][0-9]{1,3})$/.exec(
        records[index++] ?? "",
      );
    if (match === null) throw new Error("Invalid Git statistics mode record");
    if (expectGitOid(match[3]).length !== expectGitOid(match[4]).length)
      throw new Error("Mismatched Git statistics object formats");
    const status = match[5];
    if (status === undefined) throw new Error("Missing Git statistics status");
    const first = gitPath(records[index++]);
    const renamed = status.startsWith("R") || status.startsWith("C");
    if (renamed && Number(status.slice(1)) > 100) throw new Error("Invalid Git rename score");
    const path = renamed ? gitPath(records[index++]) : first;
    const previousOrigins = origins.get(path) ?? new Set<string | null>();
    previousOrigins.add(renamed ? first : null);
    origins.set(path, previousOrigins);
    const kind =
      match[1] === "120000" || match[2] === "120000"
        ? "symlink"
        : match[1] === "160000" || match[2] === "160000"
          ? "submodule"
          : "text";
    const previous = modes.get(path);
    if (previous === undefined || previous === "text") modes.set(path, kind);
  }
  const result = new Map<string, ChangeLineStats>();
  while (index < records.length) {
    const record = readNumstatRecord(records, index);
    index = record.nextIndex;
    const mode = modes.get(record.path);
    if (mode === undefined) throw new Error("Git numeric statistics lack matching file modes");
    if (!origins.get(record.path)?.has(record.oldPath))
      throw new Error("Git numeric statistics have a different rename origin");
    const stats: ChangeLineStats =
      mode === "text" ? record.stats : { kind: "not_applicable", reason: mode };
    const previous = result.get(record.path);
    result.set(record.path, previous === undefined ? stats : addStats(previous, stats));
  }
  for (const path of modes.keys()) {
    if (!result.has(path)) throw new Error("Git file modes lack matching numeric statistics");
  }
  return result;
}

function notApplicable(entry: ChangeEntry): ChangeLineStats | null {
  if (entry.layer === "conflict") return { kind: "not_applicable", reason: "conflict" };
  if (entry.isSubmodule) return { kind: "not_applicable", reason: "submodule" };
  return null;
}

async function numericRead(
  project: Project,
  cached: boolean,
  options: readonly string[],
  paths: readonly string[],
): Promise<NumericRead> {
  try {
    const values = await runGit(
      project.absolutePath,
      [
        "diff",
        ...(cached ? ["--cached"] : []),
        "--raw",
        "--numstat",
        "--no-abbrev",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        ...options,
        "--",
        ...paths,
      ],
      maxStatsBytes,
    ).then(parseChangeStats);
    return { kind: "ready", values };
  } catch (error: unknown) {
    if (error instanceof GitCommandError)
      return {
        kind: "unavailable",
        reason:
          error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.code === "ETIMEDOUT"
            ? "limit"
            : "read_error",
      };
    throw error;
  }
}

async function trackedStats(
  root: ApprovedRoot,
  project: Project,
  entries: readonly ChangeEntry[],
  layer: "staged" | "unstaged",
  deadline: number,
): Promise<ReviewChangeEntry[]> {
  const group = entries.filter((entry) => entry.layer === layer && notApplicable(entry) === null);
  if (group.length === 0) return [];
  const ordinary = group.filter((entry) => entry.oldPath === null);
  const batch: NumericRead =
    ordinary.length === 0
      ? { kind: "ready", values: new Map() }
      : await numericRead(project, layer === "staged", ["--relative", "--no-renames"], ["."]);
  const results = ordinary.map((entry) => ({
    ...entry,
    stats: batch.kind === "unavailable" ? batch : (batch.values.get(entry.path) ?? missingStats),
  }));
  const renames = group.filter((entry) => entry.oldPath !== null);
  for (let offset = 0; offset < renames.length; offset += 4) {
    const chunk = renames.slice(offset, offset + 4);
    const reads = await Promise.all(
      chunk.map(async (entry, index): Promise<ReviewChangeEntry> => {
        if (offset + index >= maxRenameReads || Date.now() >= deadline)
          return { ...entry, stats: readLimit };
        const stats = await numericRead(
          project,
          layer === "staged",
          ["--find-renames"],
          workingDiffPaths(root, project, entry),
        );
        if (stats.kind === "unavailable") return { ...entry, stats };
        if (stats.values.size === 0) return { ...entry, stats: missingStats };
        let total: ChangeLineStats = { kind: "text", added: 0, deleted: 0 };
        for (const value of stats.values.values()) total = addStats(total, value);
        return { ...entry, stats: total };
      }),
    );
    results.push(...reads);
  }
  return results;
}

async function untrackedStats(
  root: ApprovedRoot,
  project: Project,
  entries: readonly ChangeEntry[],
  deadline: number,
): Promise<ReviewChangeEntry[]> {
  let remaining = maxStatsBytes;
  let reads = 0;
  const results: ReviewChangeEntry[] = [];
  for (const entry of entries) {
    if (entry.layer !== "untracked") continue;
    let stats: ChangeLineStats = readLimit;
    if (reads < maxUntrackedFiles && remaining > 1 && Date.now() < deadline) {
      reads += 1;
      try {
        const file = await readWorkingContent(
          root,
          project,
          entry.path,
          Math.min(maxSourceTextBytes, remaining - 1),
          (bytes) => {
            if (bytes > remaining) return false;
            remaining -= bytes;
            return true;
          },
        );
        if (file.kind === "stale") stats = { kind: "unavailable", reason: "changed" };
        else if (file.kind === "binary")
          stats =
            file.reason === "symlink"
              ? { kind: "not_applicable", reason: "symlink" }
              : { kind: "binary" };
        else if (file.kind === "content") {
          const text = parseSourceText(file.content);
          stats =
            text.kind === "too_large"
              ? readLimit
              : text.kind === "binary"
                ? { kind: "binary" }
                : { kind: "text", added: text.lineCount, deleted: 0 };
        }
      } catch (error: unknown) {
        if (error instanceof AppError || hasErrorCode(error, "EIO")) stats = missingStats;
        else throw error;
      }
    }
    results.push({ ...entry, stats });
  }
  return results;
}

async function withStatistics(
  root: ApprovedRoot,
  project: Project,
  inventory: Extract<ProjectInventory, { kind: "git" }>,
): Promise<Extract<ProjectStatus, { kind: "git" }>> {
  const deadline = Date.now() + statsWorkMs;
  const [staged, unstaged, untracked] = await Promise.all([
    trackedStats(root, project, inventory.entries, "staged", deadline),
    trackedStats(root, project, inventory.entries, "unstaged", deadline),
    untrackedStats(root, project, inventory.entries, deadline),
  ]);
  const counted = new Map(
    [...staged, ...unstaged, ...untracked].map((entry) => [
      JSON.stringify([entry.layer, entry.path]),
      entry.stats,
    ]),
  );
  const entries = inventory.entries.map((entry) => ({
    ...entry,
    stats:
      notApplicable(entry) ??
      counted.get(JSON.stringify([entry.layer, entry.path])) ??
      missingStats,
  }));
  validateChangeGroupTotals(entries);
  return { ...inventory, entries };
}

/** Metadata and counts are accepted together; mutable reads never use the commit cache. */
export async function readReviewStatus(
  root: ApprovedRoot,
  project: Project,
): Promise<ProjectStatus> {
  return readReviewSnapshot(
    () => readProjectStatus(project.absolutePath),
    (inventory) => withStatistics(root, project, inventory),
  );
}

/** A bounded retry never combines counts with a different mutable inventory version. */
export async function readReviewSnapshot(
  readInventory: () => Promise<ProjectInventory>,
  readStatistics: (
    inventory: Extract<ProjectInventory, { kind: "git" }>,
  ) => Promise<Extract<ProjectStatus, { kind: "git" }>>,
): Promise<ProjectStatus> {
  let before = await readInventory();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (before.kind === "not_git") return before;
    const review = await readStatistics(before);
    const after = await readInventory();
    if (after.kind === "not_git") return after;
    if (after.revision === before.revision && after.changeToken === before.changeToken)
      return review;
    before = after;
  }
  if (before.kind === "not_git") return before;
  return {
    ...before,
    entries: before.entries.map((entry) => ({
      ...entry,
      stats: notApplicable(entry) ?? { kind: "unavailable", reason: "changed" },
    })),
  };
}
