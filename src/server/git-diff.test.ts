import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChangeEntry, DiffResult, ProjectStatus } from "../shared/api.ts";
import { parseGitPatch, readProjectDiff } from "./git-diff.ts";
import { readProjectStatus } from "./git-status.ts";
import { approveRoot, openProject } from "./paths.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function changed(status: ProjectStatus, layer: ChangeEntry["layer"], path: string): ChangeEntry {
  if (status.kind !== "git") throw new Error("Expected a Git fixture");
  const entry = status.entries.find((item) => item.layer === layer && item.path === path);
  if (entry === undefined) throw new Error(`Missing ${layer} change for ${path}`);
  return entry;
}

function textDiff(diff: DiffResult): Extract<DiffResult, { kind: "text" }> {
  if (diff.kind !== "text") throw new Error(`Expected text diff, got ${diff.kind}`);
  return diff;
}

test("diffs show each Git layer's content and preserve line anchors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-diff-"));
  try {
    git(directory, "init", "-q");
    await writeFile(join(directory, "both.ts"), "const value = 'base';\n");
    await writeFile(join(directory, "literal[1].ts"), "before\n");
    await writeFile(join(directory, "old name.md"), "This content remains after the rename.\n");
    await writeFile(join(directory, "removed.ts"), "export const removed = true;\n");
    git(directory, "add", ".");
    git(directory, "-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "base");

    await writeFile(join(directory, "both.ts"), "const value = 'staged';\n");
    git(directory, "add", "both.ts");
    await writeFile(join(directory, "both.ts"), "const value = 'working';\n");
    git(directory, "mv", "old name.md", "new name.md");
    git(directory, "rm", "-q", "removed.ts");
    await writeFile(join(directory, "literal[1].ts"), "after\n");
    git(directory, "add", "literal[1].ts");
    await writeFile(join(directory, "new.ts"), "const fresh = true;");
    await writeFile(join(directory, "odd\nname.ts"), "odd path\n");
    await writeFile(join(directory, "binary.dat"), Buffer.from([0, 1, 2]));
    await symlink("both.ts", join(directory, "link.ts"));

    const root = await approveRoot(directory);
    const project = await openProject(root, "");
    const status = await readProjectStatus(project.absolutePath);
    const staged = textDiff(await readProjectDiff(root, project, changed(status, "staged", "both.ts")));
    const unstaged = textDiff(await readProjectDiff(root, project, changed(status, "unstaged", "both.ts")));
    expect(staged.hunks[0]?.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text])).toEqual([
      ["removed", 1, null, "const value = 'base';"],
      ["added", null, 1, "const value = 'staged';"],
    ]);
    expect(unstaged.hunks[0]?.lines.map((line) => line.text)).toEqual(["const value = 'staged';", "const value = 'working';"]);
    expect(textDiff(await readProjectDiff(root, project, changed(status, "staged", "new name.md"))).hunks).toEqual([]);
    expect(textDiff(await readProjectDiff(root, project, changed(status, "staged", "removed.ts"))).hunks[0]?.lines[0]?.kind).toBe("removed");
    expect(textDiff(await readProjectDiff(root, project, changed(status, "staged", "literal[1].ts"))).hunks[0]?.lines.map((line) => line.text)).toEqual(["before", "after"]);
    expect(textDiff(await readProjectDiff(root, project, changed(status, "untracked", "new.ts"))).hunks[0]?.lines[0]).toEqual({
      kind: "added", oldLine: null, newLine: 1, text: "const fresh = true;", noNewlineAtEnd: true,
    });
    expect(textDiff(await readProjectDiff(root, project, changed(status, "untracked", "odd\nname.ts"))).hunks[0]?.lines[0]?.text).toBe("odd path");
    expect(await readProjectDiff(root, project, changed(status, "untracked", "binary.dat"))).toEqual({ kind: "binary", reason: "binary" });
    expect(await readProjectDiff(root, project, changed(status, "untracked", "link.ts"))).toEqual({ kind: "binary", reason: "symlink" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("staged content in a repository without a first commit is an addition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-unborn-diff-"));
  try {
    git(directory, "init", "-q");
    await writeFile(join(directory, "first.txt"), "first\n");
    git(directory, "add", "first.txt");
    const root = await approveRoot(directory);
    const project = await openProject(root, "");
    const status = await readProjectStatus(project.absolutePath);
    const diff = textDiff(await readProjectDiff(root, project, changed(status, "staged", "first.txt")));
    expect(diff.hunks[0]?.lines).toContainEqual({ kind: "added", oldLine: null, newLine: 1, text: "first", noNewlineAtEnd: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed Git hunks fail before reaching the UI", () => {
  expect(() => parseGitPatch(Buffer.from("@@ -1 +1 @@\n-old\n"))).toThrow("incomplete hunk");
});

test("diff source lines retain CRLF content", () => {
  const patch = Buffer.from("@@ -1 +1 @@\n-before\r\n+after\r\n");
  const diff = textDiff(parseGitPatch(patch));
  expect(diff.hunks[0]?.lines.map((line) => line.text)).toEqual(["before\r", "after\r"]);
});
