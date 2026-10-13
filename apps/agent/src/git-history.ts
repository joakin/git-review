import type { Project } from "@git-review/shared/api";
import { ResourceCache } from "@git-review/shared/resource-cache";
import {
  gitPath,
  parseCommitDetail,
  parseCommitMetadata,
  parseGitRefs,
  type CommitComparison,
  type CommitDetail,
  type CommitDiff,
  type CommitFileChange,
  type CommitFileSide,
  type GitHistoryPage,
  type GitLogRequest,
  type GitRefs,
} from "@git-review/shared/git";
import { AppError } from "./paths.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import {
  readGitContext,
  requireGitContext,
  validateGitObjectId as objectId,
  type GitContext,
} from "./git-context.ts";
import { hasGitObject, readGitBlob } from "./git-objects.ts";
import { readRawRecord, type GitRawSide } from "./git-raw.ts";
import { diffFromContent, maxPatchBytes, parseGitPatch } from "./diff-content.ts";
import { decodedText, maxSourceTextBytes } from "./source-text.ts";
import { withDiffSyntax } from "./diff-syntax.ts";
import { commitParents, readCommitStats, readHistoryStats } from "./git-stats.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

type AvailableCommitDetail = Omit<CommitDetail, "comparison" | "stats"> & {
  comparison: Exclude<CommitComparison, { kind: "missing_parent" }>;
  stats: Extract<CommitDetail["stats"], { kind: "ready" }>;
};

const commitDetails = new ResourceCache<AvailableCommitDetail>(64, 4 * 1024 * 1024);

export async function readGitRefs(project: Project): Promise<GitRefs> {
  const ctx = await readGitContext(project.absolutePath);
  if (ctx === null) return { kind: "not_git" };
  const output = decoder.decode(
    await runGit(project.absolutePath, [
      "for-each-ref",
      "--sort=refname",
      "--format=%(refname)%00%(objectname)%00%(symref)%00",
      "refs/heads/",
      "refs/remotes/",
    ]),
  );
  const branches = [];
  for (const row of output.split("\n")) {
    if (row === "") continue;
    const fields = row.split("\0");
    if (fields.length !== 4 || fields[3] !== "") throw new Error("Invalid Git branch record");
    const [ref, oid, symref] = fields;
    if (ref === undefined || oid === undefined || symref === undefined)
      throw new Error("Incomplete Git branch record");
    if (symref !== "") continue;
    const kind = ref.startsWith("refs/heads/") ? "local" : "remote";
    branches.push({
      kind,
      ref,
      name: ref.slice(kind === "local" ? 11 : 13),
      tip: objectId(oid, ctx),
    });
    if (branches.length > 1000)
      throw new AppError("invalid_request", 422, "This repository has more than 1,000 branches");
  }
  let headRef: string | null = null;
  try {
    headRef = decoder
      .decode(await runGit(project.absolutePath, ["symbolic-ref", "--quiet", "HEAD"], 4096))
      .trim();
  } catch (error: unknown) {
    if (!(error instanceof GitCommandError && error.code === 1)) throw error;
  }
  let headOid: string | null = null;
  try {
    headOid = objectId(
      decoder
        .decode(
          await runGit(
            project.absolutePath,
            ["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{commit}"],
            4096,
          ),
        )
        .trim(),
      ctx,
    );
  } catch (error: unknown) {
    if (!(error instanceof GitCommandError && error.code === 1)) throw error;
  }
  const head =
    headOid === null
      ? { kind: "unborn", ref: headRef }
      : headRef === null
        ? { kind: "detached", oid: headOid }
        : { kind: "branch", ref: headRef, oid: headOid };
  return parseGitRefs({
    kind: "git",
    head,
    branches,
    scope: ctx.prefix === "" ? "" : ctx.prefix.slice(0, -1),
  });
}

export async function readGitHistory(
  project: Project,
  request: GitLogRequest,
): Promise<GitHistoryPage> {
  const ctx = await requireGitContext(project.absolutePath);
  let tip: string;
  let offset = 0;
  if (request.kind === "ref") {
    const refs = await readGitRefs(project);
    if (refs.kind !== "git")
      throw new AppError("invalid_request", 400, "This folder is not a Git worktree");
    if (request.ref === "HEAD" && refs.head.kind !== "unborn") tip = refs.head.oid;
    else {
      const branch = refs.branches.find((branch) => branch.ref === request.ref);
      if (branch === undefined)
        throw new AppError(
          "not_found",
          404,
          "This branch is unavailable. Refresh the branch list.",
        );
      tip = branch.tip;
    }
  } else {
    tip = objectId(request.tip, ctx);
    offset = request.offset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || offset % 50 !== 0)
      throw new AppError("invalid_request", 400, "Invalid history page offset");
  }
  if (!(await hasGitObject(project.absolutePath, tip, "commit")))
    throw new AppError("not_found", 404, "This history snapshot is no longer available");
  const output = decoder.decode(
    await runGit(project.absolutePath, [
      "log",
      "--date-order",
      "--full-history",
      "--no-color",
      "--no-decorate",
      "--encoding=UTF-8",
      "--max-count=51",
      `--skip=${offset}`,
      "--format=%H%x00%an%x00%aI%x00%s%x00",
      tip,
      "--",
      ...(ctx.prefix === "" ? [] : ["."]),
    ]),
  );
  const commits = [];
  for (const row of output.split("\0\n")) {
    if (row === "") continue;
    const fields = row.split("\0");
    if (fields.length !== 4) throw new Error("Invalid Git history record");
    const [oid, author, date, subject] = fields;
    if (oid === undefined || subject === undefined)
      throw new Error("Incomplete Git history record");
    objectId(oid, ctx);
    commits.push(parseCommitMetadata({ oid, author, date, subject: subject.slice(0, 1000) }));
  }
  const page = commits.slice(0, 50);
  const totals = await readHistoryStats(
    project,
    page.map((commit) => commit.oid),
  );
  return {
    tip,
    commits: page.map((commit) => {
      const stats = totals.get(commit.oid);
      if (stats === undefined) throw new Error("Missing Git history totals");
      return { ...commit, stats };
    }),
    nextOffset: commits.length > 50 ? offset + 50 : null,
  };
}

function scopedSide(ctx: GitContext, side: GitRawSide): CommitFileSide {
  const { mode, oid, path } = side;
  if (mode === "000000") {
    if (oid !== "0".repeat(ctx.oidLength)) throw new Error("Invalid absent Git side");
    return { kind: "absent" };
  }
  objectId(oid, ctx);
  if (!path.startsWith(ctx.prefix)) return { kind: "absent" };
  return { kind: "present", path: gitPath(path.slice(ctx.prefix.length)), mode, oid };
}

export function parseCommitInventory(output: Buffer, ctx: GitContext): CommitFileChange[] {
  const records = decoder.decode(output).split("\0");
  if (records.pop() !== "") throw new Error("Incomplete Git file inventory");
  const files: CommitFileChange[] = [];
  for (let index = 0; index < records.length;) {
    const record = readRawRecord(records, index);
    index = record.nextIndex;
    if (record.status === "U") throw new Error("Invalid Git raw diff record");
    const old = scopedSide(ctx, record.old);
    const next = scopedSide(ctx, record.new);
    if (old.kind === "absent" && next.kind === "absent") continue;
    const kind =
      old.kind === "absent"
        ? "added"
        : next.kind === "absent"
          ? "deleted"
          : record.status === "R"
            ? "renamed"
            : record.status === "C"
              ? "copied"
              : record.status === "T"
                ? "type_changed"
                : "modified";
    const path = next.kind === "present" ? next.path : old.kind === "present" ? old.path : "";
    files.push({ path, kind, old, new: next });
    if (files.length > 1000)
      throw new AppError(
        "invalid_request",
        422,
        "This commit changes more than 1,000 files in the selected project",
      );
  }
  return files;
}

export async function readCommit(project: Project, requestedOid: string): Promise<CommitDetail> {
  const ctx = await requireGitContext(project.absolutePath);
  const oid = objectId(requestedOid, ctx);
  const key = JSON.stringify([project.absolutePath, ctx.prefix, ctx.oidLength, oid]);
  const cached = commitDetails.read(key);
  try {
    if (!(await hasGitObject(project.absolutePath, oid, "commit")))
      throw new AppError("not_found", 404, "This commit is no longer available in this repository");
    if (cached !== null) {
      if (
        cached.comparison.kind === "empty" ||
        (await hasGitObject(project.absolutePath, cached.comparison.oid, "commit"))
      )
        return cached;
      commitDetails.remove(key);
    }
  } catch (error: unknown) {
    commitDetails.remove(key);
    throw error;
  }
  let raw: Buffer;
  let metadata: Buffer;
  try {
    [raw, metadata] = await Promise.all([
      runGit(project.absolutePath, ["cat-file", "commit", oid], 128 * 1024),
      runGit(
        project.absolutePath,
        [
          "show",
          "--no-patch",
          "--no-notes",
          "--no-color",
          "--no-decorate",
          "--encoding=UTF-8",
          "--format=%H%x00%an%x00%aI%x00%B%x00",
          oid,
          "--",
        ],
        128 * 1024,
      ),
    ]);
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new AppError("invalid_request", 422, "This commit message is too large to display");
    throw error;
  }
  const parents = commitParents(raw, ctx.oidLength);
  const fields = decoder.decode(metadata).split("\0");
  if (fields.length !== 5 || fields[0] !== oid || fields[4] !== "\n")
    throw new Error("Invalid Git commit metadata");
  const message = fields[3];
  if (message === undefined || Buffer.byteLength(message) > 65_536)
    throw new AppError(
      "invalid_request",
      422,
      "This commit message exceeds the 64 KiB display limit",
    );
  const parent = parents[0];
  const comparison: CommitComparison =
    parent === undefined
      ? { kind: "empty" }
      : {
          kind: (await hasGitObject(project.absolutePath, parent, "commit"))
            ? "parent"
            : "missing_parent",
          oid: parent,
        };
  const [files, stats] = await Promise.all([
    comparison.kind === "missing_parent"
      ? Promise.resolve([])
      : runGit(project.absolutePath, [
          "diff-tree",
          "--raw",
          "--no-abbrev",
          "-z",
          "-r",
          "--no-commit-id",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--find-renames",
          ...(comparison.kind === "empty" ? ["--root", oid] : [comparison.oid, oid]),
          "--",
        ]).then((output) => parseCommitInventory(output, ctx)),
    readCommitStats(project, oid, comparison),
  ]);
  const detail = parseCommitDetail({
    oid,
    author: fields[1],
    date: fields[2],
    subject: message.split("\n", 1)[0]?.slice(0, 1000) ?? "",
    message,
    parents,
    comparison,
    files,
    stats,
    scope: ctx.prefix === "" ? "" : ctx.prefix.slice(0, -1),
  });
  if (detail.comparison.kind !== "missing_parent" && detail.stats.kind === "ready")
    commitDetails.remember(key, { ...detail, comparison: detail.comparison, stats: detail.stats });
  return detail;
}

export function commitFile(detail: CommitDetail, path: string): CommitFileChange {
  try {
    gitPath(path);
  } catch {
    throw new AppError("invalid_request", 400, "Invalid commit file path");
  }
  if (detail.comparison.kind === "missing_parent")
    throw new AppError("not_found", 409, "The parent of this commit is missing from local history");
  const file = detail.files.find((file) => file.path === path);
  if (file === undefined)
    throw new AppError("not_found", 404, "This file is not changed in the selected commit");
  return file;
}

export async function readCommitDiff(
  project: Project,
  detail: CommitDetail,
  file: CommitFileChange,
  language: string | null,
): Promise<CommitDiff> {
  if (detail.comparison.kind === "missing_parent")
    throw new AppError("not_found", 409, "The parent of this commit is missing from local history");
  const sides = [file.old, file.new];
  if (sides.some((side) => side.kind === "present" && side.mode === "160000"))
    return { kind: "binary", reason: "submodule" };
  if (sides.some((side) => side.kind === "present" && side.mode === "120000"))
    return { kind: "binary", reason: "symlink" };
  let diff: CommitDiff;
  try {
    if (file.old.kind === "present" && file.new.kind === "present") {
      diff = parseGitPatch(
        await runGit(
          project.absolutePath,
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "--no-prefix",
            file.old.oid,
            file.new.oid,
          ],
          maxPatchBytes + 1024,
        ),
      );
    } else {
      const selected = file.new.kind === "present" ? file.new : file.old;
      if (selected.kind === "absent") throw new Error("Missing commit file content");
      diff = diffFromContent(
        await readGitBlob(project.absolutePath, selected.oid, maxSourceTextBytes + 1),
        file.new.kind === "present" ? "new" : "old",
      );
    }
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { kind: "too_large" };
    throw error;
  }
  if (diff.kind !== "text") return diff;
  const readSide = async (side: CommitFileSide): Promise<string | null> => {
    if (side.kind === "absent") return "";
    try {
      return decodedText(await readGitBlob(project.absolutePath, side.oid, maxSourceTextBytes + 1));
    } catch (error: unknown) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  };
  return withDiffSyntax(
    diff,
    file.path,
    language,
    () => readSide(file.old),
    () => readSide(file.new),
  );
}
