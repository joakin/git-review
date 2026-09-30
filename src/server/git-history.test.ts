import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCommitDetail, parseCommitSummary, type CommitDetail } from "../shared/git.ts";
import { commitFile, readCommit, readCommitDiff, readGitHistory, readGitRefs } from "./git-history.ts";
import { approveRoot, openProject } from "./paths.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=History QA", "-c", "user.email=history@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function file(detail: CommitDetail, path: string) { return commitFile(detail, path); }

test("commit inspection reads immutable full messages, root/parent diffs and file kinds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    await writeFile(join(directory, "value.ts"), "export const value = 'before';\n");
    await writeFile(join(directory, "old name.txt"), "unchanged rename content\n");
    await writeFile(join(directory, "odd\n[1].ts"), "export const odd = 1;\n");
    const first = commit(directory, "First subject\n\nA complete paragraph.\n\nAnother paragraph.");
    await writeFile(join(directory, "value.ts"), "export const value = 'after';\n");
    git(directory, "mv", "old name.txt", "new name.txt");
    git(directory, "update-index", "--chmod=+x", "odd\n[1].ts");
    await symlink("value.ts", join(directory, "link.ts"));
    const second = commit(directory, "Second");
    await rm(join(directory, "value.ts"));
    const root = await approveRoot(directory);
    const project = await openProject(root, "");
    const refs = await readGitRefs(project);
    expect(refs.kind === "git" && refs.head).toEqual({ kind: "branch", ref: "refs/heads/main", oid: second });
    const original = await readCommit(project, first);
    expect(original.message).toBe("First subject\n\nA complete paragraph.\n\nAnother paragraph.\n");
    expect(original.comparison).toEqual({ kind: "empty" });
    const rootDiff = await readCommitDiff(project, original, file(original, "value.ts"), null);
    expect(rootDiff.kind === "text" && rootDiff.hunks[0]?.lines.map((line) => [line.kind, line.newLine, line.text])).toEqual([["added", 1, "export const value = 'before';"]]);
    const detail = await readCommit(project, second);
    expect(parseCommitDetail(detail)).toEqual(detail);
    expect(detail.comparison).toEqual({ kind: "parent", oid: first });
    const diff = await readCommitDiff(project, detail, file(detail, "value.ts"), null);
    expect(diff.kind === "text" && diff.hunks[0]?.lines.map((line) => line.text)).toEqual(["export const value = 'before';", "export const value = 'after';"]);
    expect(diff.kind === "text" && diff.syntax).toEqual({ kind: "highlighted", language: "typescript" });
    expect(diff.kind === "text" && diff.hunks[0]?.lines.every((line) => line.detail.kind === "word_change")).toBe(true);
    expect(file(detail, "new name.txt").kind).toBe("renamed");
    expect(await readCommitDiff(project, detail, file(detail, "link.ts"), null)).toEqual({ kind: "binary", reason: "symlink" });
    await expect(readCommit(project, "HEAD~1")).rejects.toThrow("object ID");
    await expect(readCommit(project, "a".repeat(64))).rejects.toThrow("object ID");
    expect(() => commitFile(detail, "../secret")).toThrow("Invalid commit file path");
    expect(() => commitFile(detail, "absent.ts")).toThrow("not changed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("branches, detached/unborn states, pagination snapshots, merges and empty commits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-list-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    const root = await approveRoot(directory);
    const project = await openProject(root, "");
    expect(await readGitRefs(project)).toEqual({ kind: "git", head: { kind: "unborn", ref: "refs/heads/main" }, branches: [], scope: "" });
    await writeFile(join(directory, "base.txt"), "base\n");
    const base = commit(directory, "Base");
    git(directory, "checkout", "-qb", "feature");
    await writeFile(join(directory, "feature.ts"), "export const feature = true;\n");
    const feature = commit(directory, "Feature");
    git(directory, "checkout", "-q", "main");
    await writeFile(join(directory, "main.txt"), "main\n");
    const parent = commit(directory, "Main");
    git(directory, "merge", "--no-ff", "-qm", "Merge feature", "feature");
    const merged = git(directory, "rev-parse", "HEAD");
    git(directory, "update-ref", "refs/remotes/origin/main", merged);
    git(directory, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const refs = await readGitRefs(project);
    expect(refs.kind === "git" && refs.branches.map((branch) => branch.ref)).toEqual(["refs/heads/feature", "refs/heads/main", "refs/remotes/origin/main"]);
    const detail = await readCommit(project, merged);
    expect(detail.parents).toEqual([parent, feature]);
    expect(detail.comparison).toEqual({ kind: "parent", oid: parent });
    expect(detail.files.map((file) => file.path)).toEqual(["feature.ts"]);
    expect(detail.stats).toEqual({ kind: "ready", added: 1, deleted: 0, binaryFiles: 0 });
    for (let i = 0; i < 50; i++) git(directory, "commit", "--allow-empty", "-qm", `Empty ${i}`);
    const page = await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" });
    expect(page.commits.length).toBe(50);
    expect(page.nextOffset).toBe(50);
    expect((await readCommit(project, page.tip)).files).toEqual([]);
    expect(page.commits.every((commit) => commit.stats.kind === "ready" && commit.stats.added === 0 && commit.stats.deleted === 0 && commit.stats.binaryFiles === 0)).toBe(true);
    git(directory, "commit", "--allow-empty", "-qm", "After snapshot");
    const older = await readGitHistory(project, { kind: "page", tip: page.tip, offset: 50 });
    expect(older.commits.map((commit) => commit.oid)).toContain(merged);
    expect(older.commits.map((commit) => commit.oid)).toContain(base);
    expect(older.commits.find((commit) => commit.oid === merged)?.stats).toEqual(detail.stats);
    expect(older.commits.some((commit) => page.commits.some((shown) => shown.oid === commit.oid))).toBe(false);
    expect((await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" })).tip).not.toBe(page.tip);
    expect(git(directory, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    await expect(readGitHistory(project, { kind: "ref", ref: "main~2" })).rejects.toThrow("branch is unavailable");
    git(directory, "checkout", "--detach", "-q", feature);
    expect((await readGitRefs(project)).kind === "git").toBe(true);
    const detached = await readGitRefs(project);
    expect(detached.kind === "git" && detached.head).toEqual({ kind: "detached", oid: feature });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("project-subfolder history confines both sides, including renames across its boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-scope-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    await mkdir(join(directory, "inside"));
    await writeFile(join(directory, "outside.txt"), "outside content\n");
    await writeFile(join(directory, "inside", "outbound.txt"), "inside content\n");
    commit(directory, "Base");
    git(directory, "mv", "outside.txt", "inside/inbound.txt");
    git(directory, "mv", "inside/outbound.txt", "outbound.txt");
    const oid = commit(directory, "Cross boundary");
    const root = await approveRoot(join(directory, "inside"));
    const project = await openProject(root, "");
    const detail = await readCommit(project, oid);
    expect(detail.scope).toBe("inside");
    expect(detail.files.map((file) => [file.path, file.kind])).toEqual([["inbound.txt", "added"], ["outbound.txt", "deleted"]]);
    expect(file(detail, "inbound.txt").old).toEqual({ kind: "absent" });
    const diff = await readCommitDiff(project, detail, file(detail, "inbound.txt"), "text");
    expect(diff.kind === "text" && diff.hunks[0]?.lines.map((line) => line.kind)).toEqual(["added"]);
    expect(() => commitFile(detail, "../outbound.txt")).toThrow();
    const history = await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" });
    expect(history.commits[0]?.oid).toBe(oid);
    expect(detail.stats).toEqual({ kind: "ready", added: 1, deleted: 1, binaryFiles: 0 });
    expect(history.commits[0]?.stats).toEqual(detail.stats);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("shallow missing parents stay unavailable and messages respect the explicit limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-shallow-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    await writeFile(join(directory, "value.txt"), "base\n");
    const base = commit(directory, "Base");
    await writeFile(join(directory, "value.txt"), "changed\n");
    const oid = commit(directory, "Changed");
    const clone = join(directory, "clone");
    git(directory, "clone", "-q", "--depth=1", `file://${directory}`, clone);
    const root = await approveRoot(clone);
    const project = await openProject(root, "");
    const detail = await readCommit(project, oid);
    expect(detail.parents).toEqual([base]);
    expect(detail.comparison).toEqual({ kind: "missing_parent", oid: base });
    expect(detail.files).toEqual([]);
    expect(detail.stats).toEqual({ kind: "unavailable", reason: "missing_parent" });
    expect((await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" })).commits[0]?.stats).toEqual(detail.stats);
    git(directory, "commit", "--allow-empty", "-qm", "x".repeat(65_537));
    const original = await openProject(await approveRoot(directory), "");
    await expect(readCommit(original, git(directory, "rev-parse", "HEAD"))).rejects.toThrow("64 KiB");
    await expect(readCommit(original, "a".repeat(40))).rejects.toThrow("no longer available");
    const folder = await openProject(await approveRoot(tmpdir()), "");
    expect(await readGitRefs(folder)).toEqual({ kind: "not_git" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("commit line totals agree across history and detail for text, binary, rename and mode changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-stats-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    await writeFile(join(directory, "value.txt"), "one\ntwo\nthree\n");
    await writeFile(join(directory, "old\tname\n{odd}.txt"), "rename\n");
    await writeFile(join(directory, "mode.sh"), "#!/bin/sh\n");
    await writeFile(join(directory, "blob.dat"), new Uint8Array([0, 1, 2]));
    const first = commit(directory, "Base stats");
    await writeFile(join(directory, "value.txt"), "one\nchanged\nthree\nfour\n");
    git(directory, "mv", "old\tname\n{odd}.txt", "a".repeat(40));
    await chmod(join(directory, "mode.sh"), 0o755);
    await writeFile(join(directory, "blob.dat"), new Uint8Array([0, 3, 4]));
    const second = commit(directory, "Edited stats");
    await rm(join(directory, "value.txt"));
    const deleted = commit(directory, "Deleted text");
    const project = await openProject(await approveRoot(directory), "");
    const history = await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" });
    for (const [oid, stats] of [
      [first, { kind: "ready", added: 5, deleted: 0, binaryFiles: 1 }],
      [second, { kind: "ready", added: 2, deleted: 1, binaryFiles: 1 }],
      [deleted, { kind: "ready", added: 0, deleted: 4, binaryFiles: 0 }],
    ] as const) {
      const summary = history.commits.find((commit) => commit.oid === oid);
      expect(summary?.stats).toEqual(stats);
      expect((await readCommit(project, oid)).stats).toEqual(stats);
    }
    const summary = history.commits[0];
    if (summary === undefined) throw new Error("Missing fixture history");
    for (const stats of [null, {}, { kind: "ready", added: -1, deleted: 0, binaryFiles: 0 }, { kind: "ready", added: 0.5, deleted: 0, binaryFiles: 0 }, { kind: "ready", added: 0, deleted: 0, binaryFiles: Number.MAX_SAFE_INTEGER + 1 }, { kind: "unavailable", reason: "unknown" }]) expect(() => parseCommitSummary({ ...summary, stats })).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("statistics limits preserve readable history instead of fabricating zero totals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-history-stats-limit-"));
  try {
    git(directory, "init", "-q", "-b", "main");
    await writeFile(join(directory, "value.txt"), "base\n");
    const base = commit(directory, "Base");
    const message = join(directory, "message.txt");
    await writeFile(message, "Large body\n\n" + "x".repeat(8 * 1024 * 1024));
    const oid = git(directory, "commit-tree", "HEAD^{tree}", "-p", base, "-F", message);
    git(directory, "update-ref", "refs/heads/main", oid);
    const project = await openProject(await approveRoot(directory), "");
    const history = await readGitHistory(project, { kind: "ref", ref: "refs/heads/main" });
    expect(history.commits[0]?.subject).toBe("Large body");
    expect(history.commits[0]?.stats).toEqual({ kind: "unavailable", reason: "limit" });
    expect(history.commits[1]?.oid).toBe(base);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
