import { expect, test } from "bun:test";
import { testGit as git, withTempDirectory } from "../test-support.ts";
import { rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseDiffResponse,
  type ChangeEntry,
  type DiffResult,
  type ProjectInventory,
} from "../shared/api.ts";
import { readProjectDiff } from "./git-diff.ts";
import { readProjectStatus } from "./git-status.ts";
import { approveRoot, resolveProject } from "./paths.ts";
import { readProjectFile } from "./project-files.ts";

function changed(status: ProjectInventory, layer: ChangeEntry["layer"], path: string): ChangeEntry {
  if (status.kind !== "git") throw new Error("Expected a Git fixture");
  const entry = status.entries.find((item) => item.layer === layer && item.path === path);
  if (entry === undefined) throw new Error(`Missing ${layer} change for ${path}`);
  return entry;
}

function textDiff(diff: DiffResult): Extract<DiffResult, { kind: "text" }> {
  if (diff.kind !== "text") throw new Error(`Expected text diff, got ${diff.kind}`);
  return diff;
}

test("working-file consumers preserve CRLF anchors and literal names while classifying missing and oversized content", async () => {
  await withTempDirectory("git-review-working-diff-", async (directory) => {
    git(directory, "init", "-q");
    const path = "odd\\name.ts";
    await writeFile(join(directory, path), "const first = 1;\r\nconst last = 2;\r\n");
    await writeFile(join(directory, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await writeFile(join(directory, "invalid.txt"), Buffer.from([0xff]));
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    const entry = changed(status, "untracked", path);
    const diff = textDiff(await readProjectDiff(root, project, entry));
    expect(diff.hunks[0]?.lines.map((line) => [line.newLine, line.text])).toEqual([
      [1, "const first = 1;\r"],
      [2, "const last = 2;\r"],
    ]);
    expect(
      diff.hunks[0]?.lines.every(
        (line) => line.tokens.map((token) => token.text).join("") === line.text,
      ),
    ).toBe(true);
    const file = await readProjectFile(root, project, path, null);
    if (file.kind !== "text") throw new Error("Expected Files text");
    expect(file.lines.map((line) => line.text)).toEqual(["const first = 1;", "const last = 2;"]);
    expect(await readProjectDiff(root, project, changed(status, "untracked", "large.txt"))).toEqual(
      { kind: "too_large" },
    );
    expect(
      await readProjectDiff(root, project, changed(status, "untracked", "invalid.txt")),
    ).toEqual({ kind: "binary", reason: "binary" });
    await rm(join(directory, path));
    expect(await readProjectDiff(root, project, entry)).toEqual({ kind: "stale" });
    await expect(readProjectFile(root, project, path, null)).rejects.toMatchObject({
      code: "file_not_found",
      status: 404,
    });
  });
});

test("diffs show each Git layer's content and preserve line anchors", async () => {
  await withTempDirectory("git-review-diff-", async (directory) => {
    git(directory, "init", "-q");
    await writeFile(join(directory, "both.ts"), "const value = 'base';\n");
    await writeFile(join(directory, "literal[1].ts"), "before\n");
    await writeFile(join(directory, "old name.md"), "This content remains after the rename.\n");
    await writeFile(join(directory, "removed.ts"), "export const removed = true;\n");
    await writeFile(
      join(directory, "multiline.ts"),
      `/*\n${Array.from({ length: 14 }, (_, index) => `comment ${index + 1}`).join("\n")}\n*/\nexport const done = true;\n`,
    );
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");

    await writeFile(join(directory, "both.ts"), "const value = 'staged';\n");
    git(directory, "add", "both.ts");
    await writeFile(join(directory, "both.ts"), "const value = 'working';\n");
    git(directory, "mv", "old name.md", "new name.md");
    git(directory, "rm", "-q", "removed.ts");
    await writeFile(join(directory, "literal[1].ts"), "after\n");
    git(directory, "add", "literal[1].ts");
    await writeFile(
      join(directory, "multiline.ts"),
      `/*\n${Array.from({ length: 14 }, (_, index) => `comment ${index === 10 ? "edited" : index + 1}`).join("\n")}\n*/\nexport const done = true;\n`,
    );
    await writeFile(join(directory, "new.ts"), "const fresh = true;");
    await writeFile(join(directory, "math.c"), "int main(void) { return 0; }\n");
    await writeFile(join(directory, "mystery.unknown_ext"), "some text\n");
    await writeFile(join(directory, "odd\nname.ts"), "odd path\n");
    await writeFile(join(directory, "binary.dat"), Buffer.from([0, 1, 2]));
    await symlink("both.ts", join(directory, "link.ts"));

    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    const staged = textDiff(
      await readProjectDiff(root, project, changed(status, "staged", "both.ts")),
    );
    const unstaged = textDiff(
      await readProjectDiff(root, project, changed(status, "unstaged", "both.ts")),
    );
    expect(
      staged.hunks[0]?.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text]),
    ).toEqual([
      ["removed", 1, null, "const value = 'base';"],
      ["added", null, 1, "const value = 'staged';"],
    ]);
    expect(unstaged.hunks[0]?.lines.map((line) => line.text)).toEqual([
      "const value = 'staged';",
      "const value = 'working';",
    ]);
    expect(staged.hunks[0]?.lines.map((line) => line.detail)).toEqual([
      { kind: "word_change", spans: [{ start: 15, end: 19 }] },
      { kind: "word_change", spans: [{ start: 15, end: 21 }] },
    ]);
    expect(
      textDiff(await readProjectDiff(root, project, changed(status, "staged", "new name.md")))
        .hunks,
    ).toEqual([]);
    expect(
      textDiff(await readProjectDiff(root, project, changed(status, "staged", "removed.ts")))
        .hunks[0]?.lines[0]?.kind,
    ).toBe("removed");
    expect(
      textDiff(
        await readProjectDiff(root, project, changed(status, "staged", "literal[1].ts")),
      ).hunks[0]?.lines.map((line) => line.text),
    ).toEqual(["before", "after"]);
    const commentDiff = textDiff(
      await readProjectDiff(root, project, changed(status, "unstaged", "multiline.ts")),
    );
    expect(commentDiff.syntax.kind).toBe("highlighted");
    expect(commentDiff.hunks[0]?.oldStart).toBeGreaterThan(1);
    expect(
      commentDiff.hunks[0]?.lines.find((line) => line.text === "comment edited")?.tokens,
    ).toEqual([{ text: "comment edited", role: "comment" }]);
    const newLine = textDiff(
      await readProjectDiff(root, project, changed(status, "untracked", "new.ts")),
    ).hunks[0]?.lines[0];
    expect(newLine?.kind).toBe("added");
    expect(newLine?.text).toBe("const fresh = true;");
    expect(newLine?.tokens.map((token) => token.text).join("")).toBe(newLine?.text);
    expect(newLine?.noNewlineAtEnd).toBe(true);
    const cDiff = textDiff(
      await readProjectDiff(root, project, changed(status, "untracked", "math.c")),
    );
    expect(cDiff.syntax).toEqual({ kind: "highlighted", language: "c" });
    expect(cDiff.hunks[0]?.lines[0]?.tokens.some((token) => token.role !== "plain")).toBe(true);
    expect(
      textDiff(
        await readProjectDiff(root, project, changed(status, "untracked", "mystery.unknown_ext")),
      ).syntax,
    ).toEqual({ kind: "plain", reason: "unknown_language" });
    expect(
      textDiff(await readProjectDiff(root, project, changed(status, "untracked", "math.c"), "text"))
        .syntax,
    ).toEqual({ kind: "plain", reason: "selected" });
    const malformed = structuredClone(cDiff);
    const firstToken = malformed.hunks[0]?.lines[0]?.tokens[0];
    if (firstToken === undefined) throw new Error("Missing C token");
    firstToken.text = "changed";
    expect(() => parseDiffResponse(malformed)).toThrow("Syntax tokens do not match");
    expect(
      textDiff(await readProjectDiff(root, project, changed(status, "untracked", "odd\nname.ts")))
        .hunks[0]?.lines[0]?.text,
    ).toBe("odd path");
    expect(
      await readProjectDiff(root, project, changed(status, "untracked", "binary.dat")),
    ).toEqual({ kind: "binary", reason: "binary" });
    expect(await readProjectDiff(root, project, changed(status, "untracked", "link.ts"))).toEqual({
      kind: "binary",
      reason: "symlink",
    });
  });
});

test("staged content in a repository without a first commit is an addition", async () => {
  await withTempDirectory("git-review-unborn-diff-", async (directory) => {
    git(directory, "init", "-q");
    await writeFile(join(directory, "first.txt"), "first\n");
    git(directory, "add", "first.txt");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    const diff = textDiff(
      await readProjectDiff(root, project, changed(status, "staged", "first.txt")),
    );
    expect(diff.hunks[0]?.lines).toContainEqual({
      kind: "added",
      oldLine: null,
      newLine: 1,
      text: "first",
      tokens: [{ text: "first", role: "plain" }],
      detail: { kind: "none" },
      noNewlineAtEnd: false,
    });
  });
});
