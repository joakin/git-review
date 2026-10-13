import { expect, test } from "bun:test";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDirectory, testGit, projectRequestUrl } from "../../../qa/test-support.ts";
import { approveRoot, resolveProject } from "./paths.ts";
import { readProjectStatus, readGitInventory, readWorkingPathVersions } from "./git-status.ts";
import { readProjectPatch } from "./git-diff.ts";
import { readWorkingContent } from "./working-text.ts";
import { readGitPath } from "./git-objects.ts";
import { checkFeedbackAnchors } from "./feedback-check.ts";
import { anchorForLine } from "../../web/src/comments.ts";
import { createApiHandler } from "./api.ts";
import {
  parseFeedbackCheckRequest,
  parseFeedbackCheckResponse,
  type CommentAnchor,
} from "@git-review/shared/feedback-check";

const signal = () => new AbortController().signal;
function file(
  path: string,
  sourceText = "source",
  before: string | null = null,
  after: string | null = null,
): CommentAnchor {
  return { kind: "file", source: "worktree", path, line: 1, sourceText, before, after };
}

test("feedback reads five canonical patches with only two inventories and no complete sources", async () => {
  await withTempDirectory("feedback-check-", async (directory) => {
    testGit(directory, "init", "-q");
    for (let i = 0; i < 5; i++)
      await writeFile(join(directory, `${i}.txt`), "before\nold\nafter\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    for (let i = 0; i < 5; i++)
      await writeFile(join(directory, `${i}.txt`), "before\nnew\nafter\n");
    // Unrelated unsafe metadata must not be fingerprinted by feedback.
    await symlink("/", join(directory, "unrelated"));
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const inventory = await readGitInventory(project.absolutePath);
    if (inventory.kind !== "git") throw new Error("Expected Git fixture");
    const anchors: CommentAnchor[] = [];
    for (const entry of inventory.entries.filter((entry) => entry.path.endsWith(".txt"))) {
      const patch = await readProjectPatch(root, project, entry);
      if (patch.kind !== "text") throw new Error("Expected text patch");
      const hunk = patch.hunks[0];
      if (hunk === undefined) throw new Error("Missing hunk");
      for (const [index, row] of hunk.lines.entries())
        if (row.kind === "added") {
          const anchor = anchorForLine(entry.layer, entry.path, hunk, index, "new");
          if (anchor === null) throw new Error("Missing anchor");
          anchors.push(anchor);
        }
    }
    let inventories = 0;
    let patches = 0;
    const paths: string[][] = [];
    const result = await checkFeedbackAnchors(root, project, { anchors }, signal(), {
      inventory: async (path) => {
        inventories++;
        return readGitInventory(path);
      },
      versions: async (path, selected) => {
        paths.push([...selected]);
        return readWorkingPathVersions(path, selected);
      },
      patch: async (...args) => {
        patches++;
        return readProjectPatch(...args);
      },
      working: async () => {
        throw new Error("Canonical anchors must not reread complete working sources");
      },
      blob: async () => {
        throw new Error("Canonical anchors must not reread complete Git sources");
      },
    });
    expect(result).toEqual({ kind: "checked", matches: anchors.map(() => true) });
    expect(inventories).toBe(2);
    expect(patches).toBe(5);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.sort()).toEqual(["0.txt", "1.txt", "2.txt", "3.txt", "4.txt"]);
  });
});

test("file-only batches use no Git and share reads; CRLF and blank/final lines retain Files semantics", async () => {
  await withTempDirectory("feedback-file-check-", async (directory) => {
    await writeFile(join(directory, "file.txt"), "source\r\n\r\nlast");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const anchors = [
      file("file.txt", "source", null, ""),
      file("file.txt", "source", null, ""),
      { ...file("file.txt", "", "source", "last"), line: 2 },
      { ...file("file.txt", "last", "", null), line: 3 },
      file("missing.txt"),
    ];
    let reads = 0;
    const result = await checkFeedbackAnchors(root, project, { anchors }, signal(), {
      inventory: async () => {
        throw new Error("No Git work for file-only feedback");
      },
      versions: readWorkingPathVersions,
      patch: readProjectPatch,
      blob: readGitPath,
      working: async (...args) => {
        reads++;
        return readWorkingContent(...args);
      },
    });
    expect(result).toEqual({ kind: "checked", matches: [true, true, true, true, false] });
    expect(reads).toBe(1);
    await symlink("file.txt", join(directory, "link.txt"));
    expect(
      await checkFeedbackAnchors(root, project, { anchors: [file("link.txt")] }, signal()),
    ).toEqual({ kind: "checked", matches: [false] });
  });
});

test("mixed feedback shares raw working content, preserves exact diff CRLF, and keeps valid files without Git", async () => {
  await withTempDirectory("feedback-mixed-check-", async (directory) => {
    testGit(directory, "init", "-q");
    await writeFile(join(directory, "file.txt"), "source\r\nafter\r\n");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const anchors: CommentAnchor[] = [
      file("file.txt", "source", null, "after"),
      {
        kind: "diff",
        layer: "untracked",
        path: "file.txt",
        side: "new",
        line: 1,
        sourceText: "source\r",
        before: null,
        after: "after\r",
      },
    ];
    let reads = 0;
    expect(
      await checkFeedbackAnchors(root, project, { anchors }, signal(), {
        inventory: readGitInventory,
        versions: readWorkingPathVersions,
        patch: readProjectPatch,
        blob: readGitPath,
        working: async (...args) => {
          reads++;
          return readWorkingContent(...args);
        },
      }),
    ).toEqual({ kind: "checked", matches: [true, true] });
    expect(reads).toBe(1);
  });
});

test("revealed anchors use required source side only and retain matches beyond patch display limits", async () => {
  await withTempDirectory("feedback-revealed-check-", async (directory) => {
    testGit(directory, "init", "-q");
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    await writeFile(join(directory, "file.txt"), lines.join("\n") + "\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await writeFile(
      join(directory, "file.txt"),
      lines.map((line, i) => (i === 80 ? "changed" : line)).join("\n") + "\n",
    );
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const anchor: CommentAnchor = {
      kind: "diff",
      layer: "unstaged",
      side: "new",
      path: "file.txt",
      line: 40,
      sourceText: "line 39",
      before: "line 38",
      after: "line 40",
    };
    expect(
      await checkFeedbackAnchors(root, project, { anchors: [anchor] }, signal(), {
        inventory: readGitInventory,
        versions: readWorkingPathVersions,
        patch: async () => ({ kind: "too_large" }),
        working: readWorkingContent,
        blob: async () => {
          throw new Error("New-only anchors need no Old source");
        },
      }),
    ).toEqual({ kind: "checked", matches: [true] });
  });
});

test("batch freshness rejects edits behind unchanged status and file-only edits during the read", async () => {
  await withTempDirectory("feedback-mutating-check-", async (directory) => {
    await writeFile(join(directory, "file.txt"), "source\n");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    let versions = 0;
    expect(
      await checkFeedbackAnchors(root, project, { anchors: [file("file.txt")] }, signal(), {
        inventory: readGitInventory,
        patch: readProjectPatch,
        blob: readGitPath,
        working: readWorkingContent,
        versions: async (...args) => {
          if (++versions === 2) await writeFile(join(directory, "file.txt"), "edited\n");
          return readWorkingPathVersions(...args);
        },
      }),
    ).toEqual({ kind: "stale" });
    testGit(directory, "init", "-q");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await writeFile(join(directory, "file.txt"), "source\n");
    const before = await readProjectStatus(project.absolutePath);
    const anchor: CommentAnchor = {
      kind: "diff",
      layer: "unstaged",
      side: "new",
      path: "file.txt",
      line: 1,
      sourceText: "source",
      before: null,
      after: null,
    };
    let inventories = 0;
    expect(
      await checkFeedbackAnchors(root, project, { anchors: [anchor] }, signal(), {
        inventory: async (...args) => {
          if (++inventories === 2) await writeFile(join(directory, "file.txt"), "other!\n");
          return readGitInventory(...args);
        },
        versions: readWorkingPathVersions,
        patch: readProjectPatch,
        blob: readGitPath,
        working: readWorkingContent,
      }),
    ).toEqual({ kind: "stale" });
    const after = await readProjectStatus(project.absolutePath);
    if (before.kind !== "git" || after.kind !== "git") throw new Error("Expected Git fixture");
    expect(after.revision).toBe(before.revision);
  });
});

test("renamed Old sources, absent layers, and subfolder scope retain canonical matching", async () => {
  await withTempDirectory("feedback-rename-check-", async (directory) => {
    testGit(directory, "init", "-q");
    await mkdir(join(directory, "sub"));
    await writeFile(join(directory, "sub", "old.txt"), "first\nsecond\nthird\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await rename(join(directory, "sub", "old.txt"), join(directory, "sub", "new.txt"));
    await writeFile(join(directory, "sub", "new.txt"), "first\nsecond\nchanged\n");
    testGit(directory, "add", ".");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, join(root.realPath, "sub"));
    const anchor: CommentAnchor = {
      kind: "diff",
      layer: "staged",
      side: "old",
      path: "new.txt",
      line: 1,
      sourceText: "first",
      before: null,
      after: "second",
    };
    expect(
      await checkFeedbackAnchors(
        root,
        project,
        { anchors: [anchor, { ...anchor, layer: "unstaged" }] },
        signal(),
      ),
    ).toEqual({ kind: "checked", matches: [true, false] });
  });
});

test("feedback API validates anchors, response shape, containment, authorization and errors", async () => {
  await withTempDirectory("feedback-api-check-", async (directory) => {
    const root = await approveRoot(directory);
    const handle = createApiHandler(root);
    const post = (project: string, anchors: unknown) =>
      handle(
        new Request(projectRequestUrl("http://localhost/api/project/feedback/check", project), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ anchors }),
        }),
      );
    await writeFile(join(directory, "file.txt"), "source\n");
    const response = await post(root.realPath, [file("file.txt")]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(parseFeedbackCheckResponse(await response.json(), 1)).toEqual({
      kind: "checked",
      matches: [true],
    });
    for (const anchors of [
      [],
      [file("../outside")],
      [file(".git/config")],
      [{ ...file("file.txt"), line: 0 }],
      Array.from({ length: 201 }, () => file("file.txt")),
    ])
      expect((await post(root.realPath, anchors)).status).toBe(400);
    expect((await post("/", [file("file.txt")])).status).toBe(403);
    expect(() => parseFeedbackCheckResponse({ kind: "checked", matches: [1] }, 1)).toThrow();
    expect(() => parseFeedbackCheckResponse({ kind: "checked", matches: [] }, 1)).toThrow();
    expect(
      parseFeedbackCheckRequest({ anchors: Array.from({ length: 200 }, () => file("file.txt")) })
        .anchors,
    ).toHaveLength(200);
    await symlink("/", join(directory, "escape"));
    expect((await post(root.realPath, [file("escape/anything")])).status).toBe(403);
  });
});

test("source classification preserves file limits, non-Git mixed feedback, and blocking diff limits", async () => {
  await withTempDirectory("feedback-limits-check-", async (directory) => {
    await writeFile(join(directory, "good.txt"), "source\n");
    await writeFile(join(directory, "binary.txt"), Buffer.from([0]));
    await writeFile(join(directory, "huge.txt"), "x".repeat(1024 * 1024 + 1));
    await writeFile(join(directory, "lines.txt"), "\n".repeat(20_001));
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const diff: CommentAnchor = {
      kind: "diff",
      layer: "unstaged",
      path: "good.txt",
      side: "new",
      line: 1,
      sourceText: "source",
      before: null,
      after: null,
    };
    expect(
      await checkFeedbackAnchors(
        root,
        project,
        {
          anchors: [
            file("good.txt"),
            diff,
            file("binary.txt"),
            file("huge.txt"),
            file("lines.txt", "", null, ""),
          ],
        },
        signal(),
      ),
    ).toEqual({ kind: "checked", matches: [true, false, false, false, false] });
    testGit(directory, "init", "-q");
    await expect(
      checkFeedbackAnchors(
        root,
        project,
        { anchors: [{ ...diff, layer: "untracked", path: "huge.txt" }] },
        signal(),
      ),
    ).rejects.toThrow("source exceeds the check limit");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      checkFeedbackAnchors(root, project, { anchors: [file("good.txt")] }, aborted.signal),
    ).rejects.toThrow();
  });
});

test("cancellation after final inventory schedules no further metadata work", async () => {
  await withTempDirectory("feedback-cancel-check-", async (directory) => {
    testGit(directory, "init", "-q");
    await writeFile(join(directory, "file.txt"), "source\n");
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const controller = new AbortController();
    let inventories = 0;
    let versions = 0;
    const anchor: CommentAnchor = {
      kind: "diff",
      layer: "untracked",
      path: "file.txt",
      side: "new",
      line: 1,
      sourceText: "source",
      before: null,
      after: null,
    };
    await expect(
      checkFeedbackAnchors(root, project, { anchors: [anchor] }, controller.signal, {
        inventory: async (path) => {
          const result = await readGitInventory(path);
          if (++inventories === 2) controller.abort();
          return result;
        },
        versions: async (...args) => {
          versions++;
          expect(controller.signal.aborted).toBe(false);
          return readWorkingPathVersions(...args);
        },
        patch: readProjectPatch,
        working: readWorkingContent,
        blob: readGitPath,
      }),
    ).rejects.toThrow();
    expect(versions).toBe(1);
  });
});
