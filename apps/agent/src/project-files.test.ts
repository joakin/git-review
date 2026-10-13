import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRoot, resolveProject } from "./paths.ts";
import { readProjectFile, readProjectTree } from "./project-files.ts";
import { maxSourceTextBytes, maxSourceTextLines } from "./source-text.ts";
import { maxAudioVideoBytes, maxImageBytes } from "@git-review/shared/media-types";
import { withTempDirectory } from "../../../qa/test-support.ts";

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

test("Files media keeps empty and rejected headers binary and uses the image prefix window", async () => {
  await withTempDirectory("git-review-file-media-", async (directory) => {
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    for (const path of ["empty.svg", "empty.wav", "rejected.png", "rejected.mp4"]) {
      const bytes = path.startsWith("empty") ? Buffer.alloc(0) : Buffer.from("not a media header");
      await writeFile(join(directory, path), bytes);
      expect(await readProjectFile(root, project, path, null)).toEqual({
        kind: "binary",
        path,
        byteLength: bytes.length,
      });
    }
    const delayedSvg = `<!--${"x".repeat(100)}--><svg xmlns="http://www.w3.org/2000/svg"/>`;
    await writeFile(join(directory, "delayed.svg"), delayedSvg);
    const image = await readProjectFile(root, project, "delayed.svg", null);
    if (image.kind !== "media") throw new Error("Expected image beyond the audio/video prefix");
    expect(image.resource.kind).toBe("image");
    expect(image.byteLength).toBe(Buffer.byteLength(delayedSvg));
    const beyondPrefix = `<!--${"x".repeat(4096)}--><svg/>`;
    await writeFile(join(directory, "beyond.svg"), beyondPrefix);
    expect(await readProjectFile(root, project, "beyond.svg", null)).toEqual({
      kind: "binary",
      path: "beyond.svg",
      byteLength: Buffer.byteLength(beyondPrefix),
    });
  });
});

test("working previews accept exact image and audio/video budgets and reject the next byte", async () => {
  await withTempDirectory("git-review-media-limits-", async (directory) => {
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    for (const [path, header, byteLimit, kind] of [
      ["image.svg", "<svg></svg>", maxImageBytes, "image"],
      ["sound.wav", "RIFF____WAVE", maxAudioVideoBytes, "audio"],
    ] as const) {
      const absolutePath = join(directory, path);
      await writeFile(absolutePath, header);
      // Sparse files exercise metadata limits without allocating or reading a full media body.
      await truncate(absolutePath, byteLimit);
      const preview = await readProjectFile(root, project, path, null);
      if (preview.kind !== "media") throw new Error("Expected media at the exact byte limit");
      expect(preview.resource.kind).toBe(kind);
      expect(preview.byteLength).toBe(byteLimit);
      expect(preview.resource.byteLength).toBe(byteLimit);
      await truncate(absolutePath, byteLimit + 1);
      expect(await readProjectFile(root, project, path, null)).toEqual({
        kind: "too_large",
        path,
        byteLength: byteLimit + 1,
      });
    }
  });
});

test("Files display normalizes only CRLF and preserves blank and unterminated lines", async () => {
  await withTempDirectory("git-review-display-lines-", async (directory) => {
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    for (const [source, expected] of [
      ["", []],
      ["\n", [""]],
      ["\n\n", ["", ""]],
      ["first\r\nlast", ["first", "last"]],
      ["first\r\nlast\r\n", ["first", "last"]],
      ["first\rlast", ["first\rlast"]],
    ] as const) {
      await writeFile(join(directory, "source.txt"), source);
      const result = await readProjectFile(root, project, "source.txt", "text");
      if (result.kind !== "text") throw new Error("Expected displayed source");
      expect(result.byteLength).toBe(Buffer.byteLength(source));
      expect(result.lines.map((line) => line.text)).toEqual([...expected]);
    }
  });
});

test("Files accepts exact UTF-8 byte and display line limits", async () => {
  await withTempDirectory("git-review-file-limits-", async (directory) => {
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const byteSource = "é".repeat(maxSourceTextBytes / 2);
    await writeFile(join(directory, "bytes.txt"), byteSource);
    const bytes = await readProjectFile(root, project, "bytes.txt", "text");
    if (bytes.kind !== "text") throw new Error("Expected source at the exact byte limit");
    expect(bytes.byteLength).toBe(maxSourceTextBytes);
    expect(bytes.lines.map((line) => line.text)).toEqual([byteSource]);
    await writeFile(join(directory, "lines.txt"), "\r\n".repeat(maxSourceTextLines));
    const lines = await readProjectFile(root, project, "lines.txt", "text");
    if (lines.kind !== "text") throw new Error("Expected source at the exact line limit");
    expect(lines.lines.length).toBe(maxSourceTextLines);
    expect(lines.lines.every((line) => line.text === "")).toBe(true);
  });
});

test("Files reads growth within its byte budget and refuses growth beyond it", async () => {
  await withTempDirectory("git-review-file-growth-", async (directory) => {
    for (const exceedsLimit of [false, true]) {
      await writeFile(join(directory, "source.txt"), "first\n");
      // Isolate the descriptor read gate so other tests always use the real filesystem methods.
      const output = execFileSync(
        process.execPath,
        [
          "--eval",
          `
            import { appendFileSync } from "node:fs";
            import { open } from "node:fs/promises";
            import { approveRoot, resolveProject } from ${JSON.stringify(new URL("./paths.ts", import.meta.url).href)};
            import { readProjectFile } from ${JSON.stringify(new URL("./project-files.ts", import.meta.url).href)};
            import { maxSourceTextBytes } from ${JSON.stringify(new URL("./source-text.ts", import.meta.url).href)};
            const directory = ${JSON.stringify(directory)};
            const root = await approveRoot(directory);
            const project = await resolveProject(root, root.realPath);
            const path = directory + "/source.txt";
            const reference = await open(path, "r");
            const identity = await reference.stat();
            const prototype = Object.getPrototypeOf(reference);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, "read");
            if (descriptor === undefined) throw new Error("Missing descriptor read method");
            let appended = false;
            Object.defineProperty(prototype, "read", {
              ...descriptor,
              value: async function (...args) {
                const current = await this.stat();
                if (!appended && current.dev === identity.dev && current.ino === identity.ino) {
                  appended = true;
                  appendFileSync(path, ${exceedsLimit} ? "x".repeat(maxSourceTextBytes) : "last\\n");
                }
                return descriptor.value.apply(this, args);
              },
            });
            try {
              const result = await readProjectFile(root, project, "source.txt", "text");
              console.log(JSON.stringify({ appended, result }));
            } finally {
              Object.defineProperty(prototype, "read", descriptor);
              await reference.close();
            }
          `,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      const observed: unknown = JSON.parse(output);
      expect(observed).toEqual({
        appended: true,
        result: exceedsLimit
          ? { kind: "too_large", path: "source.txt", byteLength: maxSourceTextBytes + 1 }
          : {
              kind: "text",
              path: "source.txt",
              byteLength: 11,
              syntax: { kind: "plain", reason: "selected" },
              lines: [
                { number: 1, text: "first", tokens: [{ text: "first", role: "plain" }] },
                { number: 2, text: "last", tokens: [{ text: "last", role: "plain" }] },
              ],
            },
      });
    }
  });
});
