import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRoot, resolveProject } from "./paths.ts";
import { readProjectFile, readProjectTree } from "./project-files.ts";

test("working-tree browsing stays in a non-Git project and never follows links", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-files-"));
  try {
    await mkdir(join(base, "project", "src"), { recursive: true });
    await mkdir(join(base, "sibling"));
    await mkdir(join(base, "project", ".git"));
    await writeFile(
      join(base, "project", "src", "main.c"),
      "int main(void) {\r\n  return 0;\r\n}\r\n",
    );
    await writeFile(join(base, "project", "src", "odd\\name.txt"), "unusual name\n");
    await writeFile(join(base, "sibling", "secret.txt"), "secret");
    await symlink(join(base, "sibling"), join(base, "project", "external"));
    await symlink(join(base, "project", "src"), join(base, "project", "linked-src"));
    const root = await approveRoot(base);
    const project = await resolveProject(root, root.realPath + "/project");

    const tree = await readProjectTree(root, project, "");
    expect(tree.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["src", "directory"],
      ["external", "symlink"],
      ["linked-src", "symlink"],
    ]);
    expect(tree.entries.some((entry) => entry.name === ".git")).toBe(false);
    expect((await readProjectTree(root, project, "src")).parentPath).toBe("");
    expect((await readProjectFile(root, project, "src/odd\\name.txt", null)).kind).toBe("text");
    const file = await readProjectFile(root, project, "src/main.c", null);
    expect(file.kind).toBe("text");
    if (file.kind !== "text") throw new Error("Expected a text file");
    expect(file.lines.map((line) => [line.number, line.text])).toEqual([
      [1, "int main(void) {"],
      [2, "  return 0;"],
      [3, "}"],
    ]);
    expect(file.syntax).toEqual({ kind: "highlighted", language: "c" });
    expect(
      file.lines.every((line) => line.tokens.map((token) => token.text).join("") === line.text),
    ).toBe(true);
    expect((await readProjectFile(root, project, "external", null)).kind).toBe("symlink");
    await expect(readProjectTree(root, project, "linked-src")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(readProjectFile(root, project, "linked-src/main.c", null)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      readProjectFile(root, project, "../sibling/secret.txt", null),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(readProjectFile(root, project, ".git/config", null)).rejects.toMatchObject({
      code: "forbidden",
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("file reader classifies binary, oversized, empty, and disappeared files", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-file-kinds-"));
  try {
    await mkdir(join(base, "project"));
    const root = await approveRoot(base);
    const project = await resolveProject(root, root.realPath + "/project");
    await writeFile(join(project.absolutePath, "nul.dat"), Buffer.from([65, 0, 66]));
    await writeFile(join(project.absolutePath, "invalid.dat"), Buffer.from([0xff]));
    await writeFile(join(project.absolutePath, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await writeFile(join(project.absolutePath, "many.txt"), "x\n".repeat(20_001));
    await writeFile(join(project.absolutePath, "empty.txt"), "");
    expect((await readProjectFile(root, project, "nul.dat", null)).kind).toBe("binary");
    expect((await readProjectFile(root, project, "invalid.dat", null)).kind).toBe("binary");
    expect((await readProjectFile(root, project, "large.txt", null)).kind).toBe("too_large");
    expect((await readProjectFile(root, project, "many.txt", null)).kind).toBe("too_large");
    const empty = await readProjectFile(root, project, "empty.txt", null);
    expect(empty.kind === "text" ? empty.lines : null).toEqual([]);
    await rm(join(project.absolutePath, "empty.txt"));
    await expect(readProjectFile(root, project, "empty.txt", null)).rejects.toMatchObject({
      code: "file_not_found",
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
