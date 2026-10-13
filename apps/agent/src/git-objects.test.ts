import { expect, test } from "bun:test";
import { testGitText as git, withTempDirectory } from "../../../qa/test-support.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readGitContext,
  readGitPrefix,
  repositoryPath,
  validateGitObjectId,
} from "./git-context.ts";
import {
  hasGitObject,
  inspectGitBlob,
  readGitBlob,
  readGitPath,
  resolveGitBlob,
} from "./git-objects.ts";

for (const format of ["sha1", "sha256"] as const) {
  test(`Git context and blobs preserve scoped literal sources and ${format} identities`, async () => {
    await withTempDirectory("git-review-objects-", async (directory) => {
      const folder = "inside space\nñ";
      const selected = join(directory, folder);
      const path = "odd [1] #?.txt";
      expect(await readGitContext(directory)).toBeNull();
      git(directory, "init", "-q", `--object-format=${format}`);
      await mkdir(selected);
      await writeFile(join(directory, path), "outside\n");
      await writeFile(join(selected, path), "HEAD inside\r\n");
      git(directory, "add", ".");
      git(directory, "commit", "-qm", "base");
      const context = await readGitContext(selected);
      if (context === null) throw new Error("Missing Git context");
      expect(context).toEqual({ prefix: `${folder}/`, oidLength: format === "sha1" ? 40 : 64 });
      expect(await readGitPrefix(selected)).toBe(`${folder}/`);
      const head = await resolveGitBlob(selected, { kind: "head", path });
      if (head === null) throw new Error("Missing HEAD blob");
      expect(await readGitBlob(selected, head, 4096)).toEqual(Buffer.from("HEAD inside\r\n"));
      expect(await inspectGitBlob(selected, head)).toEqual({ kind: "blob", byteLength: 13 });
      expect(validateGitObjectId(head, context)).toBe(head);
      expect(() => validateGitObjectId("a".repeat(format === "sha1" ? 64 : 40), context)).toThrow();
      expect(await hasGitObject(selected, head, "commit")).toBe(false);
      expect(await hasGitObject(selected, "f".repeat(context.oidLength), "blob")).toBe(false);
      await writeFile(join(selected, path), "INDEX inside\r\n");
      git(directory, "add", ".");
      const index = await resolveGitBlob(selected, { kind: "index", path });
      if (index === null) throw new Error("Missing index blob");
      expect(index).not.toBe(head);
      expect(await readGitBlob(selected, index, 4096)).toEqual(Buffer.from("INDEX inside\r\n"));
      const repository = repositoryPath(context.prefix, path);
      if (repository === null) throw new Error("Missing repository path");
      expect(await readGitPath(selected, { kind: "head", path: repository }, 4096)).toEqual(
        Buffer.from("HEAD inside\r\n"),
      );
      expect(await readGitPath(selected, { kind: "index", path: repository }, 4096)).toEqual(
        Buffer.from("INDEX inside\r\n"),
      );
      expect(repositoryPath(context.prefix, "../../outside.txt")).toBeNull();
      expect(await resolveGitBlob(selected, { kind: "head", path: "missing.txt" })).toBeNull();
      expect(() => readGitBlob(selected, "HEAD", 4096)).toThrow();
    });
  });
}
