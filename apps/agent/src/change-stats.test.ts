import { expect, test } from "bun:test";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseStatusResponse,
  type ChangeLineStats,
  type ProjectInventory,
  type ProjectStatus,
} from "@git-review/shared/api";
import { testGit as git, testGitText, withTempDirectory } from "../../../qa/test-support.ts";
import { parseChangeStats, readReviewSnapshot, readReviewStatus } from "./change-stats.ts";
import { readProjectDiff } from "./git-diff.ts";
import { approveRoot, resolveProject } from "./paths.ts";

function stats(status: ProjectStatus, layer: string, path: string): ChangeLineStats {
  if (status.kind !== "git") throw new Error("Expected Git status");
  const entry = status.entries.find((entry) => entry.layer === layer && entry.path === path);
  if (entry === undefined) throw new Error(`Missing ${layer} ${path}`);
  return entry.stats;
}

test("bundled counts match staged, unstaged and untracked cards while preserving non-text states", async () => {
  await withTempDirectory("git-review-change-stats-", async (directory) => {
    git(directory, "init", "-q");
    for (const [path, text] of [
      ["both.txt", "one\ntwo\n"],
      ["old.txt", "rename\nunchanged\n"],
      ["delete.txt", "remove\nboth\n"],
      ["mode.txt", "mode\n"],
      ["odd\tname\n.txt", "old\n"],
      ["image.svg", '<svg id="old"/>\n'],
      ["type.txt", "regular\n"],
    ] as const)
      await writeFile(join(directory, path), text);
    await writeFile(join(directory, "binary.dat"), Buffer.from([1, 0, 2]));
    await symlink("both.txt", join(directory, "link"));
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");
    await writeFile(join(directory, "both.txt"), "one\nstaged\nextra\n");
    await writeFile(join(directory, "odd\tname\n.txt"), "new\n");
    await writeFile(join(directory, "image.svg"), '<svg id="new"/>\n');
    await writeFile(join(directory, "binary.dat"), Buffer.from([2, 0, 3]));
    await chmod(join(directory, "mode.txt"), 0o755);
    git(directory, "rm", "-q", "type.txt");
    await symlink("both.txt", join(directory, "type.txt"));
    git(directory, "add", ".");
    git(directory, "rm", "-q", "delete.txt");
    git(directory, "mv", "old.txt", "renamed.txt");
    git(
      directory,
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      testGitText(directory, "rev-parse", "HEAD"),
      "submodule",
    );
    await writeFile(join(directory, "both.txt"), "one\nworking\nextra\nlast");
    await writeFile(join(directory, "empty.txt"), "");
    await writeFile(join(directory, "new\tline\n.txt"), "first\r\nlast");
    await writeFile(join(directory, "new-binary.dat"), Buffer.from([0xff]));
    await writeFile(join(directory, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await writeFile(join(directory, "many-lines.txt"), "x\n".repeat(20_001));
    await symlink("/etc/passwd", join(directory, "outside-link"));
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = parseStatusResponse(await readReviewStatus(root, project));
    expect(stats(status, "staged", "both.txt")).toEqual({ kind: "text", added: 2, deleted: 1 });
    expect(stats(status, "unstaged", "both.txt")).toEqual({ kind: "text", added: 2, deleted: 1 });
    expect(stats(status, "staged", "renamed.txt")).toEqual({ kind: "text", added: 0, deleted: 0 });
    expect(stats(status, "staged", "delete.txt")).toEqual({ kind: "text", added: 0, deleted: 2 });
    expect(stats(status, "staged", "mode.txt")).toEqual({ kind: "text", added: 0, deleted: 0 });
    expect(stats(status, "staged", "image.svg")).toEqual({ kind: "text", added: 1, deleted: 1 });
    expect(stats(status, "staged", "binary.dat")).toEqual({ kind: "binary" });
    expect(stats(status, "staged", "type.txt")).toEqual({
      kind: "not_applicable",
      reason: "symlink",
    });
    expect(stats(status, "staged", "submodule")).toEqual({
      kind: "not_applicable",
      reason: "submodule",
    });
    expect(stats(status, "untracked", "empty.txt")).toEqual({ kind: "text", added: 0, deleted: 0 });
    expect(stats(status, "untracked", "new\tline\n.txt")).toEqual({
      kind: "text",
      added: 2,
      deleted: 0,
    });
    expect(stats(status, "untracked", "new-binary.dat")).toEqual({ kind: "binary" });
    expect(stats(status, "untracked", "outside-link")).toEqual({
      kind: "not_applicable",
      reason: "symlink",
    });
    for (const path of ["large.txt", "many-lines.txt"])
      expect(stats(status, "untracked", path)).toEqual({ kind: "unavailable", reason: "limit" });
    if (status.kind !== "git") throw new Error("Expected Git");
    for (const entry of status.entries) {
      if (entry.stats.kind !== "text") continue;
      const diff = await readProjectDiff(root, project, entry, "plain");
      if (diff.kind !== "text") throw new Error(`Expected text diff for ${entry.path}`);
      const lines = diff.hunks.flatMap((hunk) => hunk.lines);
      expect(entry.stats.added).toBe(lines.filter((line) => line.kind === "added").length);
      expect(entry.stats.deleted).toBe(lines.filter((line) => line.kind === "removed").length);
    }
  });
});

test("scoped renames and approved-root boundaries preserve the inventory's card comparison", async () => {
  await withTempDirectory("git-review-scoped-stats-", async (directory) => {
    git(directory, "init", "-q");
    await mkdir(join(directory, "sub"));
    await writeFile(join(directory, "outside.txt"), "incoming\nrename\n");
    await writeFile(join(directory, "sub", "leave.txt"), "outgoing\n");
    await writeFile(join(directory, "sub", "old.txt"), "within\nsubfolder\n");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");
    git(directory, "mv", "outside.txt", "sub/incoming.txt");
    git(directory, "mv", "sub/leave.txt", "outgoing.txt");
    git(directory, "mv", "sub/old.txt", "sub/renamed.txt");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath + "/sub");
    expect(stats(await readReviewStatus(root, project), "staged", "incoming.txt")).toEqual({
      kind: "text",
      added: 2,
      deleted: 0,
    });
    expect(stats(await readReviewStatus(root, project), "staged", "renamed.txt")).toEqual({
      kind: "text",
      added: 0,
      deleted: 0,
    });
    expect(stats(await readReviewStatus(root, project), "staged", "leave.txt")).toEqual({
      kind: "text",
      added: 0,
      deleted: 1,
    });
    const narrowRoot = await approveRoot(join(directory, "sub"));
    expect(
      stats(
        await readReviewStatus(narrowRoot, await resolveProject(narrowRoot, narrowRoot.realPath)),
        "staged",
        "incoming.txt",
      ),
    ).toEqual({ kind: "text", added: 2, deleted: 0 });
  });
});

test("unborn repositories, SHA-256 objects, and conflicts retain explicit statistics", async () => {
  await withTempDirectory("git-review-unborn-stats-", async (directory) => {
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    expect(await readReviewStatus(root, project)).toEqual({ kind: "not_git" });
    git(directory, "init", "-q", "--object-format=sha256", "-b", "main");
    await writeFile(join(directory, "first.txt"), "first\nlast");
    await writeFile(join(directory, "ordinary.txt"), "before\n");
    git(directory, "add", ".");
    expect(stats(await readReviewStatus(root, project), "staged", "first.txt")).toEqual({
      kind: "text",
      added: 2,
      deleted: 0,
    });
    git(directory, "commit", "-qm", "base");
    git(directory, "checkout", "-qb", "other");
    await writeFile(join(directory, "first.txt"), "other\n");
    git(directory, "commit", "-qam", "other");
    git(directory, "checkout", "-q", "main");
    await writeFile(join(directory, "first.txt"), "main\n");
    git(directory, "commit", "-qam", "main");
    try {
      git(directory, "merge", "--no-edit", "other");
    } catch {
      /* Expected conflict. */
    }
    await writeFile(join(directory, "ordinary.txt"), "after\n");
    const conflicted = parseStatusResponse(await readReviewStatus(root, project));
    expect(stats(conflicted, "conflict", "first.txt")).toEqual({
      kind: "not_applicable",
      reason: "conflict",
    });
    expect(stats(conflicted, "unstaged", "ordinary.txt")).toEqual({
      kind: "text",
      added: 1,
      deleted: 1,
    });
  });
});

test("unreadable source files preserve the inventory with explicit unavailable counts", async () => {
  await withTempDirectory("git-review-unreadable-stats-", async (directory) => {
    git(directory, "init", "-q");
    const tracked = join(directory, "tracked.txt");
    const untracked = join(directory, "untracked.txt");
    await writeFile(tracked, "before\n");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");
    await writeFile(tracked, "after\n");
    await writeFile(untracked, "new\n");
    await chmod(tracked, 0);
    await chmod(untracked, 0);
    try {
      const root = await approveRoot(directory);
      const status = parseStatusResponse(
        await readReviewStatus(root, await resolveProject(root, root.realPath)),
      );
      expect(stats(status, "unstaged", "tracked.txt")).toEqual({
        kind: "unavailable",
        reason: "read_error",
      });
      expect(stats(status, "untracked", "untracked.txt")).toEqual({
        kind: "unavailable",
        reason: "read_error",
      });
    } finally {
      await chmod(tracked, 0o644);
      await chmod(untracked, 0o644);
    }
  });
});

test("an aggregate untracked read limit preserves known counts and labels the remainder", async () => {
  await withTempDirectory("git-review-stats-budget-", async (directory) => {
    git(directory, "init", "-q");
    for (let index = 0; index < 9; index += 1)
      await writeFile(join(directory, `file-${index}.txt`), "x".repeat(1024 * 1024 - 1));
    const root = await approveRoot(directory);
    const status = await readReviewStatus(root, await resolveProject(root, root.realPath));
    for (let index = 0; index < 8; index += 1)
      expect(stats(status, "untracked", `file-${index}.txt`)).toEqual({
        kind: "text",
        added: 1,
        deleted: 0,
      });
    expect(stats(status, "untracked", "file-8.txt")).toEqual({
      kind: "unavailable",
      reason: "limit",
    });
  });
});

test("numeric records reject malformed paths, modes, unsafe counts and incomplete rename data", () => {
  const oid = "a".repeat(40);
  const raw = `:100644 100644 ${oid} ${oid} M\0file.txt\0`;
  expect(parseChangeStats(Buffer.from(raw + "12\t3\tfile.txt\0")).get("file.txt")).toEqual({
    kind: "text",
    added: 12,
    deleted: 3,
  });
  for (const output of [
    raw + "1\t1\tfile.txt",
    raw + "-\t0\tfile.txt\0",
    raw + "01\t1\tfile.txt\0",
    raw + "9007199254740992\t0\tfile.txt\0",
    raw + "1\t1\t../escape\0",
    raw + "1\t1\tunknown.txt\0",
    raw + "1\t1\t\0old.txt\0",
    raw.replace("100644", "100600") + "1\t1\tfile.txt\0",
    raw.replace(`${oid} ${oid}`, `${oid} ${"b".repeat(64)}`) + "1\t1\tfile.txt\0",
    `:100644 100644 ${oid} ${oid} R100\0old.txt\0file.txt\0` + "0\t0\t\0different.txt\0file.txt\0",
    raw,
  ])
    expect(() => parseChangeStats(Buffer.from(output))).toThrow();
});

test("statistics retain conflict and zero-ID handling without immutable absent-side policy", () => {
  for (const length of [40, 64]) {
    const oid = "a".repeat(length);
    const zero = "0".repeat(length);
    const output =
      `:000000 000000 ${zero} ${zero} U\0conflict\0` +
      `:000000 100644 ${oid} ${zero} A\0addition\0` +
      `:100644 100755 ${zero} ${zero} M\0working\0` +
      "0\t0\tconflict\0" +
      "3\t0\taddition\0" +
      "1\t1\tworking\0";
    expect([...parseChangeStats(Buffer.from(output))]).toEqual([
      ["conflict", { kind: "text", added: 0, deleted: 0 }],
      ["addition", { kind: "text", added: 3, deleted: 0 }],
      ["working", { kind: "text", added: 1, deleted: 1 }],
    ]);
  }
});

test("statistics match repeated ordinary, rename and copy origins before aggregating counts", () => {
  const oid = "a".repeat(40);
  const output =
    `:100644 100644 ${oid} ${oid} M\0:target\nname\0` +
    `:100644 100644 ${oid} ${oid} R100\0old\tname\0:target\nname\0` +
    `:100644 100644 ${oid} ${oid} C000\0copied\0:target\nname\0` +
    "1\t1\t:target\nname\0" +
    "2\t0\t\0old\tname\0:target\nname\0" +
    "0\t1\t\0copied\0:target\nname\0";
  expect(parseChangeStats(Buffer.from(output)).get(":target\nname")).toEqual({
    kind: "text",
    added: 3,
    deleted: 2,
  });
  expect(() =>
    parseChangeStats(Buffer.from(output.replace("copied\0:target", "wrong\0:target"))),
  ).toThrow();
});

test("combined snapshots retry once and never attach counts to another inventory version", async () => {
  const inventory = (token: string): Extract<ProjectInventory, { kind: "git" }> => ({
    kind: "git",
    revision: "same-revision",
    changeToken: token,
    entries: [
      {
        layer: "untracked",
        kind: "added",
        path: `${token}.txt`,
        oldPath: null,
        isSubmodule: false,
      },
    ],
  });
  const revisions = [inventory("first"), inventory("second"), inventory("second")];
  const counted: string[] = [];
  const result = await readReviewSnapshot(
    async () => {
      const next = revisions.shift();
      if (next === undefined) throw new Error("Too many reads");
      return next;
    },
    async (snapshot) => {
      counted.push(snapshot.changeToken);
      return {
        ...snapshot,
        entries: snapshot.entries.map((entry) => ({
          ...entry,
          stats: { kind: "text", added: snapshot.changeToken === "first" ? 1 : 2, deleted: 0 },
        })),
      };
    },
  );
  expect(counted).toEqual(["first", "second"]);
  expect(stats(result, "untracked", "second.txt")).toEqual({ kind: "text", added: 2, deleted: 0 });
  const changing = [inventory("first"), inventory("second"), inventory("third")];
  const fallback = await readReviewSnapshot(
    async () => {
      const next = changing.shift();
      if (next === undefined) throw new Error("Too many reads");
      return next;
    },
    async (snapshot) => ({
      ...snapshot,
      entries: snapshot.entries.map((entry) => ({
        ...entry,
        stats: { kind: "text", added: 99, deleted: 0 },
      })),
    }),
  );
  expect(stats(fallback, "untracked", "third.txt")).toEqual({
    kind: "unavailable",
    reason: "changed",
  });
});
