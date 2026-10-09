import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDirectory, testGit } from "../test-support.ts";
import { approveRoot, resolveProject } from "./paths.ts";
import { checkFeedbackAnchors } from "./feedback-check.ts";
import { readGitInventory, readWorkingPathVersions } from "./git-status.ts";
import { readWorkingContent } from "./working-text.ts";
import { readProjectPatch } from "./git-diff.ts";
import { readGitPath } from "./git-objects.ts";
import { anchorForLine } from "../client/comments.ts";
import {
  parseFeedbackCheckRequest,
  type FileCommentAnchor,
  type CommentAnchor,
} from "../shared/feedback-check.ts";

test("overlapping file ranges share one read and any changed interior line invalidates the range", async () => {
  await withTempDirectory("feedback-range-file-", async (directory) => {
    const texts = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
    const path = "range.txt";
    await writeFile(join(directory, path), texts.join("\n"));
    const lines: FileCommentAnchor[] = texts.map((sourceText, index) => ({
      kind: "file",
      source: "worktree",
      path,
      line: index + 1,
      sourceText,
      before: texts[index - 1] ?? null,
      after: texts[index + 1] ?? null,
    }));
    const request = parseFeedbackCheckRequest({
      anchors: [
        { kind: "range", parts: [lines] },
        { kind: "range", parts: [lines.slice(20, 60)] },
        lines[0],
      ],
    });
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    let reads = 0;
    const dependencies = {
      inventory: async (): Promise<never> => {
        throw new Error("File-only ranges need no Git inventory");
      },
      versions: readWorkingPathVersions,
      working: async (...args: Parameters<typeof readWorkingContent>) => {
        reads++;
        return readWorkingContent(...args);
      },
      patch: readProjectPatch,
      blob: readGitPath,
    };
    expect(
      await checkFeedbackAnchors(
        root,
        project,
        request,
        new AbortController().signal,
        dependencies,
      ),
    ).toEqual({ kind: "checked", matches: [true, true, true] });
    expect(reads).toBe(1);
    texts[40] = "changed in the middle";
    await writeFile(join(directory, path), texts.join("\n"));
    expect(
      await checkFeedbackAnchors(
        root,
        project,
        request,
        new AbortController().signal,
        dependencies,
      ),
    ).toEqual({ kind: "checked", matches: [false, false, true] });
    expect(reads).toBe(2);
  });
});

test("mixed Old/New ranges check both parts with one patch and two inventories", async () => {
  await withTempDirectory("feedback-range-diff-", async (directory) => {
    testGit(directory, "init", "-q");
    await writeFile(join(directory, "range.txt"), "before\nold one\nold two\nafter\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await writeFile(join(directory, "range.txt"), "before\nnew one\nnew two\nafter\n");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const inventory = await readGitInventory(project.absolutePath);
    if (inventory.kind !== "git") throw new Error("Expected Git fixture");
    const entry = inventory.entries.find((entry) => entry.path === "range.txt");
    if (entry === undefined) throw new Error("Missing changed file");
    const patch = await readProjectPatch(root, project, entry);
    if (patch.kind !== "text") throw new Error("Missing diff");
    const hunk = patch.hunks[0];
    if (hunk === undefined) throw new Error("Missing hunk");
    const parts = (["old", "new"] as const).map((side) => {
      const anchors: CommentAnchor[] = [];
      for (const [index] of hunk.lines.entries()) {
        const anchor = anchorForLine(entry.layer, entry.path, hunk, index, side);
        if (anchor !== null) anchors.push(anchor);
      }
      return anchors;
    });
    const request = parseFeedbackCheckRequest({ anchors: [{ kind: "range", parts }] });
    let inventories = 0;
    let patches = 0;
    const result = await checkFeedbackAnchors(
      root,
      project,
      request,
      new AbortController().signal,
      {
        inventory: async (path) => {
          inventories++;
          return readGitInventory(path);
        },
        versions: readWorkingPathVersions,
        patch: async (...args) => {
          patches++;
          return readProjectPatch(...args);
        },
        working: async (): Promise<never> => {
          throw new Error("Canonical ranges should not reread full sources");
        },
        blob: async (): Promise<never> => {
          throw new Error("Canonical ranges should not reread Git blobs");
        },
      },
    );
    expect(result).toEqual({ kind: "checked", matches: [true] });
    expect(inventories).toBe(2);
    expect(patches).toBe(1);
    await writeFile(join(directory, "range.txt"), "before\nchanged\nnew two\nafter\n");
    expect(
      await checkFeedbackAnchors(root, project, request, new AbortController().signal),
    ).toEqual({ kind: "checked", matches: [false] });
  });
});

test("range checking bounds expanded line work independently of comment count", () => {
  const lines = Array.from({ length: 200 }, (_, index) => ({
    kind: "file",
    source: "worktree",
    path: "range.txt",
    line: index + 1,
    sourceText: "x",
    before: null,
    after: null,
  }));
  const range = { kind: "range", parts: [lines] };
  expect(
    parseFeedbackCheckRequest({ anchors: Array.from({ length: 20 }, () => range) }).anchors,
  ).toHaveLength(20);
  expect(() =>
    parseFeedbackCheckRequest({ anchors: Array.from({ length: 21 }, () => range) }),
  ).toThrow("too many source lines");
});
