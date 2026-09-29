import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import type { ChangeEntry, ChangeKind, ProjectStatus } from "../shared/api.ts";
import { hasErrorCode } from "../shared/validation.ts";
import { AppError, isWithinRoot } from "./paths.ts";

const maxOutputBytes = 8 * 1024 * 1024;
const gitTimeoutMs = 10_000;

export class GitCommandError extends Error {
  constructor(readonly stderr: string, readonly code: number | string | null) {
    super(stderr || "Git could not read this folder");
  }
}

export function runGit(cwd: string, args: readonly string[], maxBytes = maxOutputBytes): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--literal-pathspecs", "-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: maxBytes,
        timeout: gitTimeoutMs,
        env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new GitCommandError(stderr.toString("utf8").trim(), error.code ?? null));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function fields(record: string, count: number): string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = 1; index < count; index += 1) {
    const next = record.indexOf(" ", start);
    if (next === -1) throw new Error("Git returned an incomplete status record");
    result.push(record.slice(start, next));
    start = next + 1;
  }
  result.push(record.slice(start));
  if (result.some((field) => field.length === 0)) throw new Error("Git returned an empty status field");
  return result;
}

function kindFor(code: string): ChangeKind | null {
  switch (code) {
    case ".": return null;
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "T": return "type_changed";
    default: throw new Error(`Git returned an unknown status code: ${code}`);
  }
}

function validatePath(path: string): void {
  if (path.length === 0 || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Git returned an invalid path");
  }
}

function validateSubmodule(value: string | undefined): boolean {
  if (value === undefined || !/^N\.\.\.$|^S[.C][.M][.U]$/.test(value)) {
    throw new Error("Git returned an invalid submodule state");
  }
  return value.startsWith("S");
}

function validateModesAndHashes(parts: readonly string[], modeIndexes: readonly number[], hashIndexes: readonly number[]): void {
  for (const index of modeIndexes) {
    if (!/^[0-7]{6}$/.test(parts[index] ?? "")) throw new Error("Git returned an invalid file mode");
  }
  for (const index of hashIndexes) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(parts[index] ?? "")) throw new Error("Git returned an invalid object ID");
  }
}

function parseNulRecords(output: Buffer): string[] {
  if (output.length === 0) return [];
  if (output[output.length - 1] !== 0) throw new Error("Git returned an incomplete status response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const records: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    records.push(decoder.decode(output.subarray(start, index)));
    start = index + 1;
  }
  return records;
}

export function parsePorcelainStatus(output: Buffer): ChangeEntry[] {
  const records = parseNulRecords(output);
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length === 0) throw new Error("Git returned an empty status record");
    if (record.startsWith("# ") || record.startsWith("! ")) continue;
    if (record.startsWith("? ")) {
      const path = record.slice(2);
      validatePath(path);
      entries.push({ layer: "untracked", kind: "added", path, oldPath: null, isSubmodule: false });
      continue;
    }
    const tag = record[0];
    if (tag === "u") {
      const parts = fields(record, 11);
      const path = parts[10];
      if (path === undefined) throw new Error("Git returned an incomplete conflict record");
      validatePath(path);
      if (!/^(?:DD|AU|UD|UA|DU|AA|UU)$/.test(parts[1] ?? "")) throw new Error("Git returned an invalid conflict state");
      const isSubmodule = validateSubmodule(parts[2]);
      validateModesAndHashes(parts, [3, 4, 5, 6], [7, 8, 9]);
      entries.push({ layer: "conflict", kind: "conflicted", path, oldPath: null, isSubmodule });
      continue;
    }
    if (tag !== "1" && tag !== "2") throw new Error("Git returned an unknown status record");
    const parts = fields(record, tag === "1" ? 9 : 10);
    const xy = parts[1];
    const path = parts[tag === "1" ? 8 : 9];
    if (xy === undefined || xy.length !== 2 || path === undefined) throw new Error("Git returned an invalid change record");
    validatePath(path);
    const isSubmodule = validateSubmodule(parts[2]);
    validateModesAndHashes(parts, [3, 4, 5], [6, 7]);
    let oldPath: string | null = null;
    if (tag === "2") {
      const score = parts[8] ?? "";
      if (!/^[RC][0-9]{1,3}$/.test(score) || Number(score.slice(1)) > 100) throw new Error("Git returned an invalid rename score");
      oldPath = records[index + 1] ?? null;
      if (oldPath === null) throw new Error("Git returned a rename without its old path");
      validatePath(oldPath);
      index += 1;
    }
    const stagedKind = kindFor(xy[0] ?? "");
    const unstagedKind = kindFor(xy[1] ?? "");
    if (stagedKind !== null) entries.push({ layer: "staged", kind: stagedKind, path, oldPath, isSubmodule });
    if (unstagedKind !== null) entries.push({ layer: "unstaged", kind: unstagedKind, path, oldPath: unstagedKind === "renamed" || unstagedKind === "copied" ? oldPath : null, isSubmodule });
  }
  return entries;
}

async function workingPathFingerprint(projectPath: string, path: string): Promise<string> {
  const candidate = resolve(projectPath, path);
  if (!isWithinRoot(projectPath, candidate)) throw new AppError("forbidden", 403, "Changed file is outside the selected folder");
  try {
    const parent = await realpath(dirname(candidate));
    if (!isWithinRoot(projectPath, parent)) throw new AppError("forbidden", 403, "Changed file is outside the selected folder");
    const metadata = await lstat(candidate, { bigint: true });
    return [metadata.mode, metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(":");
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR") || hasErrorCode(error, "ELOOP")) return "missing";
    if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) throw new AppError("forbidden", 403, "Cannot read changed file metadata");
    throw error;
  }
}

export async function readProjectStatus(projectPath: string): Promise<ProjectStatus> {
  let insideWorkTree: Buffer;
  try {
    insideWorkTree = await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === 128 && error.stderr.includes("not a git repository")) {
      return { kind: "not_git" };
    }
    throw error;
  }
  if (insideWorkTree.toString("utf8").trim() !== "true") return { kind: "not_git" };
  const [prefixOutput, output] = await Promise.all([
    runGit(projectPath, ["rev-parse", "--show-prefix"]),
    runGit(projectPath, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--branch", "--", "."]),
  ]);
  const rawPrefix = new TextDecoder("utf-8", { fatal: true }).decode(prefixOutput);
  if (!rawPrefix.endsWith("\n")) throw new Error("Git returned an invalid worktree prefix");
  const prefix = rawPrefix.slice(0, -1);
  const entries = parsePorcelainStatus(output).map((entry): ChangeEntry => {
    if (!entry.path.startsWith(prefix)) throw new Error("Git returned a path outside the selected folder");
    return {
      ...entry,
      path: entry.path.slice(prefix.length),
      oldPath: entry.oldPath === null ? null : posix.relative(prefix === "" ? "." : prefix.slice(0, -1), entry.oldPath),
    };
  });
  const tokenHash = createHash("sha256").update(output);
  const workingPaths = [...new Set(entries.filter((entry) => entry.layer !== "staged").map((entry) => entry.path))].sort();
  const realProjectPath = await realpath(projectPath);
  for (let offset = 0; offset < workingPaths.length; offset += 16) {
    const fingerprints = await Promise.all(workingPaths.slice(offset, offset + 16).map(async (path) => ({ path, value: await workingPathFingerprint(realProjectPath, path) })));
    for (const fingerprint of fingerprints) tokenHash.update("\0").update(fingerprint.path).update("\0").update(fingerprint.value);
  }
  return {
    kind: "git",
    revision: createHash("sha256").update(output).digest("hex").slice(0, 20),
    changeToken: tokenHash.digest("hex").slice(0, 20),
    entries,
  };
}
