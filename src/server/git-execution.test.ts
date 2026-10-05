import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommandError, openGitStream, runGit, type GitReadStream } from "./git-execution.ts";

async function collect(stream: GitReadStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk === null) return Buffer.concat(chunks);
      chunks.push(chunk);
    }
  } finally {
    stream.close();
  }
}

test("buffered and streamed Git reads use literal paths, skip fsmonitor and leave the index untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-execution-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
  try {
    git("init", "-q");
    await writeFile(join(directory, "tracked.txt"), "before\n");
    git("add", "tracked.txt");
    const before = await readFile(join(directory, ".git/index"));
    await writeFile(join(directory, "tracked.txt"), "after with changed metadata\n");
    await writeFile(join(directory, "[1].ts"), "literal\n");
    await writeFile(join(directory, "1.ts"), "glob match\n");
    const monitor = join(directory, ".git/hooks/monitor");
    await writeFile(monitor, "#!/bin/sh\ntouch fsmonitor-ran\nprintf '\\0'\n");
    await chmod(monitor, 0o755);
    git("config", "core.fsmonitor", monitor);
    const args = ["status", "--short", "-z", "--", "[1].ts"];
    expect(await runGit(directory, args)).toEqual(Buffer.from("?? [1].ts\0"));
    expect(await collect(openGitStream(directory, args, 4096))).toEqual(Buffer.from("?? [1].ts\0"));
    expect(await readFile(join(directory, ".git/index"))).toEqual(before);
    expect(await readFile(join(directory, "fsmonitor-ran")).catch(() => null)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Git binary reads, output limits, process failures and stream cancellation preserve their boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-stream-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
  try {
    git("init", "-q");
    const bytes = Buffer.alloc(256 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;
    await writeFile(join(directory, "binary.dat"), bytes);
    const oid = git("hash-object", "-w", "binary.dat").toString("utf8").trim();
    const args = ["cat-file", "blob", oid];
    expect(await runGit(directory, args, bytes.length)).toEqual(bytes);
    expect(await collect(openGitStream(directory, args, bytes.length))).toEqual(bytes);
    await expect(runGit(directory, args, 1)).rejects.toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });
    await expect(collect(openGitStream(directory, args, 1))).rejects.toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });
    const missing = ["cat-file", "blob", "f".repeat(40)];
    await expect(runGit(directory, missing)).rejects.toBeInstanceOf(GitCommandError);
    await expect(collect(openGitStream(directory, missing, 4096))).rejects.toMatchObject({
      code: 128,
    });
    const cancelled = openGitStream(directory, args, bytes.length);
    const pending = cancelled.read();
    cancelled.close();
    cancelled.close();
    expect(await pending).toBeNull();
    expect(await cancelled.read()).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stalled buffered and streamed Git reads time out with typed command errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "git-review-timeout-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    const oid = "a".repeat(40);
    await mkdir(join(directory, ".git/objects/aa"));
    // A loose-object FIFO stalls the real Git process opening its source.
    execFileSync("mkfifo", [join(directory, ".git/objects/aa", oid.slice(2))]);
    // Capture both failures before assertions: Bun's async matchers may wait eagerly,
    // leaving the second concurrent rejection temporarily unhandled.
    const failure = (read: Promise<unknown>) =>
      read.then(
        () => null,
        (error: unknown) => error,
      );
    const buffered = failure(runGit(directory, ["cat-file", "--batch"]));
    const streamed = failure(collect(openGitStream(directory, ["cat-file", "blob", oid], 4096)));
    for (const error of await Promise.all([buffered, streamed])) {
      expect(error).toBeInstanceOf(GitCommandError);
      if (!(error instanceof GitCommandError)) throw new Error("Missing Git timeout error");
      expect(error.code).toBe("ETIMEDOUT");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
