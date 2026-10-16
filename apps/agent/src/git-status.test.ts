import { expect, test } from "bun:test";
import { testGit as git, withTempDirectory } from "../../../qa/test-support.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectStatus } from "./git-status.ts";

test("Git inventory keeps layers separate and preserves unusual paths", async () => {
  await withTempDirectory("git-review-status-", async (directory) => {
    git(directory, "init", "-q");
    await mkdir(join(directory, "sub"));
    await writeFile(join(directory, "both.txt"), "base\n");
    await writeFile(join(directory, "delete.txt"), "delete me\n");
    await writeFile(join(directory, "old name.txt"), "rename this unchanged content\n");
    await writeFile(join(directory, "sub", "nested.txt"), "nested base\n");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");

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
    expect(status.entries).toContainEqual({
      layer: "staged",
      kind: "modified",
      path: "both.txt",
      oldPath: null,
      isSubmodule: false,
    });
    expect(status.entries).toContainEqual({
      layer: "unstaged",
      kind: "modified",
      path: "both.txt",
      oldPath: null,
      isSubmodule: false,
    });
    expect(status.entries).toContainEqual({
      layer: "staged",
      kind: "deleted",
      path: "delete.txt",
      oldPath: null,
      isSubmodule: false,
    });
    expect(status.entries).toContainEqual({
      layer: "staged",
      kind: "renamed",
      path: "renamed name.txt",
      oldPath: "old name.txt",
      isSubmodule: false,
    });
    expect(status.entries).toContainEqual({
      layer: "untracked",
      kind: "added",
      path: "sub/odd\nname.txt",
      oldPath: null,
      isSubmodule: false,
    });

    const scoped = await readProjectStatus(join(directory, "sub"));
    expect(scoped.kind).toBe("git");
    if (scoped.kind !== "git") return;
    expect(scoped.entries.map((entry) => entry.path).sort()).toEqual([
      "nested.txt",
      "odd\nname.txt",
    ]);
  });
});

for (const setting of ["status.renames", "diff.renames"]) {
  test(`staged renames are detected with ${setting}=false`, async () => {
    await withTempDirectory("git-review-status-renames-", async (directory) => {
      git(directory, "init", "-q");
      git(directory, "config", setting, "false");
      await writeFile(join(directory, "old name.txt"), "unchanged content\n");
      git(directory, "add", ".");
      git(directory, "commit", "-qm", "base");
      git(directory, "mv", "old name.txt", "new name.txt");

      const status = await readProjectStatus(directory);
      if (status.kind !== "git") throw new Error("Expected Git status");
      expect(status.entries).toEqual([
        {
          layer: "staged",
          kind: "renamed",
          path: "new name.txt",
          oldPath: "old name.txt",
          isSubmodule: false,
        },
      ]);
    });
  });
}

test("non-Git folders and repositories without commits have clear inventory states", async () => {
  await withTempDirectory("git-review-nongit-", async (directory) => {
    expect(await readProjectStatus(directory)).toEqual({ kind: "not_git" });
    git(directory, "init", "-q");
    await writeFile(join(directory, "first.txt"), "first file\n");
    const status = await readProjectStatus(directory);
    expect(status.kind).toBe("git");
    if (status.kind === "git") {
      expect(status.entries).toContainEqual({
        layer: "untracked",
        kind: "added",
        path: "first.txt",
        oldPath: null,
        isSubmodule: false,
      });
    }
  });
});

test("change token notices edits behind unchanged Git status entries", async () => {
  await withTempDirectory("git-review-change-token-", async (directory) => {
    git(directory, "init", "-q");
    await writeFile(join(directory, "tracked.txt"), "base\n");
    git(directory, "add", "tracked.txt");
    git(directory, "commit", "-qm", "base");

    await writeFile(join(directory, "tracked.txt"), "first\n");
    const trackedBefore = await readProjectStatus(directory);
    await writeFile(join(directory, "tracked.txt"), "other\n");
    const trackedAfter = await readProjectStatus(directory);
    if (trackedBefore.kind !== "git" || trackedAfter.kind !== "git")
      throw new Error("Expected Git statuses");
    expect(trackedAfter.entries).toEqual(trackedBefore.entries);
    expect(trackedAfter.revision).toBe(trackedBefore.revision);
    expect(trackedAfter.changeToken).not.toBe(trackedBefore.changeToken);

    await writeFile(join(directory, "new.txt"), "first\n");
    const untrackedBefore = await readProjectStatus(directory);
    await writeFile(join(directory, "new.txt"), "other\n");
    const untrackedAfter = await readProjectStatus(directory);
    if (untrackedBefore.kind !== "git" || untrackedAfter.kind !== "git")
      throw new Error("Expected Git statuses");
    expect(untrackedAfter.entries).toEqual(untrackedBefore.entries);
    expect(untrackedAfter.revision).toBe(untrackedBefore.revision);
    expect(untrackedAfter.changeToken).not.toBe(untrackedBefore.changeToken);

    git(directory, "add", "tracked.txt");
    const staged = await readProjectStatus(directory);
    if (staged.kind !== "git") throw new Error("Expected Git status");
    expect(staged.revision).not.toBe(untrackedAfter.revision);
    expect(staged.changeToken).not.toBe(untrackedAfter.changeToken);
  });
});
