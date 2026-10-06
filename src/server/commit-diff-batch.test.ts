import { expect, test } from "bun:test";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testGitText as git, withTempDirectory } from "../test-support.ts";
import { parseProjectResponse } from "../shared/api.ts";
import { parseCommitDiff } from "../shared/git.ts";
import { commitDiffBatchSource, commitDiffRequestKey } from "../shared/commit-diff-batch.ts";
import {
  maxDiffBatchFiles,
  maxDiffBatchRequestBytes,
  parseDiffBatchResponse,
} from "../shared/diff-batch.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("commit batches match individual source reads, isolate file errors and revalidate roots", async () => {
  await withTempDirectory("git-review-batch-", async (directory) => {
    await withTempDirectory("git-review-batch-outside-", async (outside) => {
      const repo = join(directory, "repo");
      await mkdir(repo);
      git(repo, "init", "-q", "-b", "main");
      const path = "odd\n[1].ts";
      await writeFile(join(repo, path), "export const value = 1;\n");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>before</text></svg>',
      );
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Base");
      await writeFile(join(repo, path), "export const value = 2;\n");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>after</text></svg>',
      );
      await writeFile(
        join(repo, "sound.wav"),
        Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(64)]),
      );
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Changed");
      const oid = git(repo, "rev-parse", "HEAD");
      const handle = createApiHandler(await approveRoot(directory));
      const opened = await handle(
        new Request("http://localhost/api/projects/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "repo" }),
        }),
      );
      const project = parseProjectResponse((await opened.json()) as unknown);
      const base = `http://localhost/api/projects/${project.id}/git/commits/${oid}`;
      const post = (body: unknown, url = `${base}/diffs`) =>
        handle(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      const files = [
        { path, language: null },
        { path, language: "text" },
        { path: "art.svg", language: null },
        { path: "sound.wav", language: null },
        { path: "missing.txt", language: null },
      ];
      const response = await post({ files });
      expect(response.status).toBe(200);
      const batch = parseDiffBatchResponse(
        (await response.json()) as unknown,
        commitDiffBatchSource(project.id, oid),
        files.map(commitDiffRequestKey),
        parseCommitDiff,
      );
      for (const [index, file] of files.entries()) {
        const item = batch.results[index];
        if (file.path === "missing.txt") {
          expect(item).toMatchObject({ kind: "error", status: 404 });
          continue;
        }
        const query = new URLSearchParams({ path: file.path });
        if (file.language !== null) query.set("language", file.language);
        const single = parseCommitDiff(
          (await (await handle(new Request(`${base}/diff?${query}`))).json()) as unknown,
        );
        expect(item?.kind).toBe("ready");
        if (item?.kind === "ready") expect(item.value).toEqual(single);
      }
      const audio = batch.results[3];
      if (
        audio?.kind !== "ready" ||
        audio.value.kind !== "media" ||
        audio.value.new.kind !== "ready"
      )
        throw new Error("Expected batched audio metadata");
      const range = await handle(
        new Request(`http://localhost${audio.value.new.resource.url}`, {
          headers: { range: "bytes=0-11" },
        }),
      );
      expect(range.status).toBe(206);
      expect(await range.text()).toBe("RIFF0000WAVE");
      for (const body of [
        { files: [] },
        { files: [files[0], files[0]] },
        { files: [{ path, language: "invalid-language" }] },
        { files: [{ path: "../outside", language: null }] },
        { files: [{ path, language: null, revision: oid }] },
        {
          files: Array.from({ length: maxDiffBatchFiles + 1 }, (_, i) => ({
            path: `${i}.ts`,
            language: null,
          })),
        },
      ])
        expect((await post(body)).status).toBe(400);
      expect((await post({ files }, `${base}/diffs?extra=1`)).status).toBe(400);
      expect(
        (await post({ files: [], padding: "x".repeat(maxDiffBatchRequestBytes) })).status,
      ).toBe(413);
      await rename(repo, join(directory, "moved"));
      await symlink(outside, repo);
      expect((await post({ files })).status).toBe(403);
    });
  });
});

test("commit batch subfolder scope and shallow-parent recovery match individual inspection", async () => {
  await withTempDirectory("git-review-batch-shallow-", async (directory) => {
    const repo = join(directory, "repo");
    await mkdir(repo);
    await mkdir(join(repo, "inside"));
    git(repo, "init", "-q", "-b", "main");
    await writeFile(join(repo, "inside/value.txt"), "before\n");
    await writeFile(join(repo, "outside.txt"), "outside\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "Base");
    await writeFile(join(repo, "inside/value.txt"), "after\n");
    await writeFile(join(repo, "outside.txt"), "changed outside\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "Changed");
    const oid = git(repo, "rev-parse", "HEAD");
    const clone = join(directory, "clone");
    git(directory, "clone", "-q", "--depth=1", `file://${repo}`, clone);
    const handle = createApiHandler(await approveRoot(clone));
    const opened = await handle(
      new Request("http://localhost/api/projects/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "inside" }),
      }),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const files = [
      { path: "value.txt", language: null },
      { path: "outside.txt", language: null },
    ];
    const post = () =>
      handle(
        new Request(`http://localhost/api/projects/${project.id}/git/commits/${oid}/diffs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files }),
        }),
      );
    expect((await post()).status).toBe(409);
    git(clone, "fetch", "-q", "--unshallow");
    const response = await post();
    expect(response.status).toBe(200);
    const batch = parseDiffBatchResponse(
      (await response.json()) as unknown,
      commitDiffBatchSource(project.id, oid),
      files.map(commitDiffRequestKey),
      parseCommitDiff,
    );
    const first = batch.results[0];
    expect(
      first?.kind === "ready" &&
        first.value.kind === "text" &&
        first.value.hunks[0]?.lines.map((line) => line.text),
    ).toEqual(["before", "after"]);
    expect(batch.results[1]).toMatchObject({ kind: "error", status: 404 });
  });
});
