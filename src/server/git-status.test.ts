import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProjectStatus } from "./git-status.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

test("Git inventory keeps layers separate and preserves unusual paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-status-"));
  try {
    git(directory, "init", "-q");
    await mkdir(join(directory, "sub"));
    await writeFile(join(directory, "both.txt"), "base\n");
    await writeFile(join(directory, "delete.txt"), "delete me\n");
    await writeFile(join(directory, "old name.txt"), "rename this unchanged content\n");
    await writeFile(join(directory, "sub", "nested.txt"), "nested base\n");
    git(directory, "add", ".");
    git(directory, "-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "base");

    await writeFile(join(directory, "both.txt"), "staged\n");
    git(directory, "add", "both.txt");
    await writeFile(join(directory, "both.txt"), "worktree\n");
    git(directory, "rm", "-q", "delete.txt");
    git(directory, "mv", "old name.txt", "renamed name.txt");
    await writeFile(join(directory, "sub", "nested.txt"), "nested changed\n");
    await writeFile(join(directory, "sub", "odd\nname.txt"), "untracked\n");
    await writeFile(join(directory, "outside.txt"), "outside\n");

    const status = await readProjectStatus(directory);
    expect(status.kind).toBe("git");
    if (status.kind !== "git") return;
    expect(status.entries).toContainEqual({ layer: "staged", kind: "modified", path: "both.txt", oldPath: null, isSubmodule: false });
    expect(status.entries).toContainEqual({ layer: "unstaged", kind: "modified", path: "both.txt", oldPath: null, isSubmodule: false });
    expect(status.entries).toContainEqual({ layer: "staged", kind: "deleted", path: "delete.txt", oldPath: null, isSubmodule: false });
    expect(status.entries).toContainEqual({ layer: "staged", kind: "renamed", path: "renamed name.txt", oldPath: "old name.txt", isSubmodule: false });
    expect(status.entries).toContainEqual({ layer: "untracked", kind: "added", path: "sub/odd\nname.txt", oldPath: null, isSubmodule: false });

    const scoped = await readProjectStatus(join(directory, "sub"));
    expect(scoped.kind).toBe("git");
    if (scoped.kind !== "git") return;
    expect(scoped.entries.map((entry) => entry.path).sort()).toEqual(["nested.txt", "odd\nname.txt"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("non-Git folders and repositories without commits have clear inventory states", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-nongit-"));
  try {
    expect(await readProjectStatus(directory)).toEqual({ kind: "not_git" });
    git(directory, "init", "-q");
    await writeFile(join(directory, "first.txt"), "first file\n");
    const status = await readProjectStatus(directory);
    expect(status.kind).toBe("git");
    if (status.kind === "git") {
      expect(status.entries).toContainEqual({ layer: "untracked", kind: "added", path: "first.txt", oldPath: null, isSubmodule: false });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
