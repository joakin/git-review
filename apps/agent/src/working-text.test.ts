import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDirectory } from "../../../qa/test-support.ts";
import { approveRoot, resolveProject } from "./paths.ts";
import { readWorkingContent } from "./working-text.ts";

test("working reads reserve their snapshot plus a growth sentinel and preserve raw source bytes", async () => {
  await withTempDirectory("git-review-working-text-", async (directory) => {
    const content = Buffer.from("first\r\nlast");
    await writeFile(join(directory, "source.txt"), content);
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const reservations: number[] = [];
    expect(
      await readWorkingContent(root, project, "source.txt", content.byteLength, (capacity) => {
        reservations.push(capacity);
        return true;
      }),
    ).toEqual({ kind: "content", content });
    expect(reservations).toEqual([content.byteLength + 1]);
    expect(
      await readWorkingContent(root, project, "source.txt", content.byteLength, () => false),
    ).toEqual({ kind: "too_large" });
    expect(await readWorkingContent(root, project, "source.txt", content.byteLength - 1)).toEqual({
      kind: "too_large",
    });
    expect(await readWorkingContent(root, project, "missing.txt")).toEqual({ kind: "stale" });
  });
});

test("working reads reject growth after metadata and recover with a fresh snapshot", async () => {
  await withTempDirectory("git-review-working-growth-", async (directory) => {
    const path = join(directory, "source.txt");
    const original = "first\r\n";
    const appended = "last\r\n";
    await writeFile(path, original);
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    let reservations = 0;
    // This existing budget callback runs after descriptor metadata, before the first read.
    expect(
      await readWorkingContent(root, project, "source.txt", 100, (capacity) => {
        reservations += 1;
        expect(capacity).toBe(Buffer.byteLength(original) + 1);
        appendFileSync(path, appended);
        return true;
      }),
    ).toEqual({ kind: "stale" });
    expect(reservations).toBe(1);
    expect(await readWorkingContent(root, project, "source.txt")).toEqual({
      kind: "content",
      content: Buffer.from(original + appended),
    });
  });
});
