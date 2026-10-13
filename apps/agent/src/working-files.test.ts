import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRoot, resolveProject } from "./paths.ts";
import { workingVersion } from "./image-types.ts";
import { audioVideoResponse } from "./media-stream.ts";
import {
  checkedProjectPath,
  openCheckedWorkingFile,
  withCheckedWorkingFile,
} from "./working-files.ts";

async function expectClosed(handles: FileHandle[]) {
  expect(handles.length).toBe(1);
  for (const handle of handles)
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
}

test("streaming ownership closes checked descriptors after completion, HEAD, invalid ranges, cancellation and changed content", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-checked-stream-"));
  try {
    await mkdir(join(base, "project"));
    const root = await approveRoot(base);
    const project = await resolveProject(root, root.realPath + "/project");
    const bytes = Buffer.alloc(128 * 1024, 42);
    const path = "sound.wav";
    const absolutePath = join(project.absolutePath, path);
    for (const outcome of ["full", "range", "HEAD", "invalid", "cancel", "changed"] as const) {
      await writeFile(absolutePath, bytes);
      const opened = await openCheckedWorkingFile(root, project, path);
      const version = workingVersion(opened.metadata);
      if (outcome === "changed") await writeFile(absolutePath, bytes.subarray(0, 12));
      const request = new Request("http://localhost/raw", {
        method: outcome === "HEAD" ? "HEAD" : "GET",
        headers:
          outcome === "range"
            ? { range: "bytes=8-15" }
            : outcome === "invalid"
              ? { range: "bytes=999999-" }
              : {},
      });
      const response = await audioVideoResponse(request, {
        source: { kind: "file", file: opened.file, version },
        path,
        mimeType: "audio/wav",
        byteLength: opened.metadata.size,
      });
      if (outcome === "cancel") {
        if (response.body === null) throw new Error("Expected a stream");
        await response.body.cancel();
      } else if (outcome === "changed") {
        await expect(response.arrayBuffer()).rejects.toThrow("Media file changed");
      } else {
        expect(response.status).toBe(outcome === "range" ? 206 : outcome === "invalid" ? 416 : 200);
        const actual = Buffer.from(await response.arrayBuffer());
        expect(actual).toEqual(
          outcome === "full"
            ? bytes
            : outcome === "range"
              ? bytes.subarray(8, 16)
              : Buffer.alloc(0),
        );
      }
      await expectClosed([opened.file]);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("checked reads preserve literal names and bytes and close on success or consumer failure", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-checked-read-"));
  try {
    await mkdir(join(base, "project", "src\\literal"), { recursive: true });
    const root = await approveRoot(base);
    const project = await resolveProject(root, root.realPath + "/project");
    const path = "src\\literal/odd\\name.txt";
    const bytes = Buffer.from("first\r\nsecond\r\n");
    await writeFile(join(project.absolutePath, path), bytes);
    const handles: FileHandle[] = [];
    const actual = await withCheckedWorkingFile(root, project, path, async ({ file, metadata }) => {
      handles.push(file);
      expect(metadata.isFile()).toBe(true);
      return file.readFile();
    });
    expect(actual).toEqual(bytes);
    await expectClosed(handles);

    const failedHandles: FileHandle[] = [];
    const failure = new Error("Consumer failed");
    await expect(
      withCheckedWorkingFile(root, project, path, async ({ file }) => {
        failedHandles.push(file);
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expectClosed(failedHandles);

    // Streaming ownership deliberately outlives open; the receiving owner closes the descriptor.
    const opened = await openCheckedWorkingFile(root, project, path);
    try {
      expect(await opened.file.readFile()).toEqual(bytes);
    } finally {
      await opened.file.close();
    }
    await expectClosed([opened.file]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("checked paths reject traversal and intermediate links, and classify links and special files without opening them", async () => {
  const base = await mkdtemp(join(tmpdir(), "git-review-checked-path-"));
  try {
    await mkdir(join(base, "project", "src"), { recursive: true });
    await mkdir(join(base, "outside"));
    await writeFile(join(base, "outside", "secret.txt"), "secret");
    await writeFile(join(base, "project", "src", "safe.txt"), "safe");
    await symlink(join(base, "outside", "secret.txt"), join(base, "project", "final.txt"));
    await symlink(join(base, "outside"), join(base, "project", "external"));
    await symlink(join(base, "project", "src"), join(base, "project", "internal"));
    execFileSync("mkfifo", [join(base, "project", "pipe")]);
    const root = await approveRoot(base);
    const project = await resolveProject(root, root.realPath + "/project");
    expect((await checkedProjectPath(root, project, "final.txt")).kind).toBe("symlink");
    expect((await checkedProjectPath(root, project, "pipe")).kind).toBe("other");
    for (const path of ["final.txt", "pipe", "src", ""])
      await expect(openCheckedWorkingFile(root, project, path)).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    for (const path of ["external/secret.txt", "internal/safe.txt"])
      await expect(openCheckedWorkingFile(root, project, path)).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
    for (const path of [
      "../outside/secret.txt",
      "/outside/secret.txt",
      "src/../safe.txt",
      "src//safe.txt",
      "src/./safe.txt",
      "bad\0name",
    ])
      await expect(openCheckedWorkingFile(root, project, path)).rejects.toMatchObject({
        code: "invalid_request",
        status: 400,
      });
    await expect(openCheckedWorkingFile(root, project, ".git/config")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(openCheckedWorkingFile(root, project, "missing.txt")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

for (const change of [
  "replacement",
  "symlink",
  "deletion",
  "parent replacement",
  "parent symlink",
] as const) {
  test(`checked reads reject ${change} during access and release the descriptor`, async () => {
    const base = await mkdtemp(join(tmpdir(), "git-review-checked-change-"));
    try {
      await mkdir(join(base, "project", "src"), { recursive: true });
      const root = await approveRoot(base);
      const project = await resolveProject(root, root.realPath + "/project");
      const path = "src/odd\\name.txt";
      const absolutePath = join(project.absolutePath, path);
      await writeFile(absolutePath, "original\r\n");
      const handles: FileHandle[] = [];
      const reading = withCheckedWorkingFile(root, project, path, async ({ file }) => {
        handles.push(file);
        const bytes = await file.readFile();
        expect(bytes.toString()).toBe("original\r\n");
        if (change === "deletion") {
          await rm(absolutePath);
        } else if (change === "replacement" || change === "symlink") {
          await rename(absolutePath, join(project.absolutePath, "original.txt"));
          if (change === "replacement") await writeFile(absolutePath, "replacement\r\n");
          else await symlink(join(project.absolutePath, "original.txt"), absolutePath);
        } else {
          const saved = join(project.absolutePath, "saved");
          await rename(join(project.absolutePath, "src"), saved);
          if (change === "parent replacement") {
            await mkdir(join(project.absolutePath, "src"));
            // The leaf still has the same inode. The changed parent must also be detected.
            await link(join(saved, "odd\\name.txt"), absolutePath);
          } else await symlink(saved, join(project.absolutePath, "src"));
        }
        return bytes;
      });
      await expect(reading).rejects.toMatchObject(
        change === "parent symlink"
          ? { code: "forbidden", status: 403 }
          : { code: "not_found", status: change === "deletion" ? 404 : 409 },
      );
      await expectClosed(handles);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
}
