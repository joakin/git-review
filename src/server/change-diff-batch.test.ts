import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testGitText as git, withTempDirectory } from "../test-support.ts";
import {
  parseChangeCheckResponse,
  parseDiffResponse,
  parseProjectResponse,
} from "../shared/api.ts";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchResponse,
  type ChangeDiffRequest,
} from "../shared/change-diff-batch.ts";
import { maxDiffBatchRequestBytes } from "../shared/diff-batch.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("change batches match individual layers, languages and media while isolating file errors", async () => {
  await withTempDirectory("git-review-change-batch-", async (directory) => {
    await withTempDirectory("git-review-change-outside-", async (outside) => {
      const repo = join(directory, "repo");
      await mkdir(repo);
      git(repo, "init", "-q", "-b", "main");
      const path = "odd\n[1].ts";
      await writeFile(join(repo, path), "export const value = 'base';\n");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>base</text></svg>',
      );
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Base");
      await writeFile(join(repo, path), "export const value = 'index';\n");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>index</text></svg>',
      );
      git(repo, "add", ".");
      await writeFile(join(repo, path), "export const value = 'working';\n");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>working</text></svg>',
      );
      await writeFile(
        join(repo, "sound.wav"),
        Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(64)]),
      );
      const handle = createApiHandler(await approveRoot(directory));
      const project = parseProjectResponse(
        (await (
          await handle(
            new Request("http://localhost/api/projects/open", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ path: "repo" }),
            }),
          )
        ).json()) as unknown,
      );
      const base = `http://localhost/api/projects/${project.id}`;
      const status = parseChangeCheckResponse(
        (await (await handle(new Request(`${base}/status?mode=check`))).json()) as unknown,
      );
      if (status.kind !== "git") throw new Error("Expected Git snapshot");
      const files: ChangeDiffRequest[] = [
        { layer: "staged", path, language: null },
        { layer: "unstaged", path, language: null },
        { layer: "unstaged", path, language: "text" },
        { layer: "staged", path: "art.svg", language: null },
        { layer: "unstaged", path: "art.svg", language: null },
        { layer: "untracked", path: "sound.wav", language: null },
        { layer: "unstaged", path: "missing.txt", language: null },
      ];
      const body = { revision: status.revision, changeToken: status.changeToken, files };
      const post = (value: unknown, url = `${base}/diffs`) =>
        handle(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
          }),
        );
      const response = await post(body);
      expect(response.status).toBe(200);
      const batch = parseChangeDiffBatchResponse(
        (await response.json()) as unknown,
        changeDiffBatchSource(project.id, status.revision, status.changeToken),
        files.map(changeDiffRequestKey),
      );
      if (batch.kind !== "ready") throw new Error("Expected current batch");
      for (const [index, file] of files.entries()) {
        const result = batch.results[index];
        if (file.path === "missing.txt") {
          expect(result).toMatchObject({ kind: "error", status: 404 });
          continue;
        }
        const query = new URLSearchParams({
          layer: file.layer,
          path: file.path,
          revision: status.revision,
          changeToken: status.changeToken,
        });
        if (file.language !== null) query.set("language", file.language);
        const single = parseDiffResponse(
          (await (await handle(new Request(`${base}/diff?${query}`))).json()) as unknown,
        );
        if (single.kind === "stale") throw new Error("Individual read unexpectedly became stale");
        expect(result?.kind).toBe("ready");
        if (result?.kind === "ready") expect(result.value).toEqual(single);
      }
      const staged = batch.results[0];
      const unstaged = batch.results[1];
      expect(
        staged?.kind === "ready" &&
          staged.value.kind === "text" &&
          staged.value.hunks[0]?.lines.map((line) => line.text),
      ).toEqual(["export const value = 'base';", "export const value = 'index';"]);
      expect(
        unstaged?.kind === "ready" &&
          unstaged.value.kind === "text" &&
          unstaged.value.hunks[0]?.lines.map((line) => line.text),
      ).toEqual(["export const value = 'index';", "export const value = 'working';"]);
      const audio = batch.results[5];
      if (
        audio?.kind !== "ready" ||
        audio.value.kind !== "media" ||
        audio.value.new.kind !== "ready"
      )
        throw new Error("Expected audio metadata");
      const range = await handle(
        new Request(`http://localhost${audio.value.new.resource.url}`, {
          headers: { range: "bytes=0-11" },
        }),
      );
      expect(range.status).toBe(206);
      expect(await range.text()).toBe("RIFF0000WAVE");
      for (const invalid of [
        { ...body, changeToken: "old" },
        { ...body, files: [] },
        { ...body, files: [{ layer: "unstaged", path, language: "invalid-language" }] },
      ])
        expect((await post(invalid)).status).toBe(400);
      expect((await post(body, `${base}/diffs?extra=1`)).status).toBe(400);
      expect((await post({ padding: "x".repeat(maxDiffBatchRequestBytes) })).status).toBe(413);
      await writeFile(join(repo, path), "export const value = 'edited again';\n");
      const newer = parseChangeCheckResponse(
        (await (await handle(new Request(`${base}/status?mode=check`))).json()) as unknown,
      );
      if (newer.kind !== "git") throw new Error("Expected edited snapshot");
      expect(newer.revision).toBe(status.revision);
      expect(newer.changeToken).not.toBe(status.changeToken);
      expect(await (await post(body)).json()).toEqual({
        kind: "stale",
        source: changeDiffBatchSource(project.id, status.revision, status.changeToken),
      });
      const staleSingle = new URLSearchParams({
        layer: "unstaged",
        path,
        revision: status.revision,
        changeToken: status.changeToken,
      });
      expect(await (await handle(new Request(`${base}/diff?${staleSingle}`))).json()).toEqual({
        kind: "stale",
      });
      expect(
        (await handle(new Request(`${base}/diff?${staleSingle}&changeToken=${status.changeToken}`)))
          .status,
      ).toBe(400);
      expect((await post({ ...body, changeToken: newer.changeToken })).status).toBe(200);
      await rename(repo, join(directory, "moved"));
      await symlink(outside, repo);
      expect((await post(body)).status).toBe(403);
    });
  });
});

test("an edit after batch work starts invalidates every file and recovers on a new snapshot", async () => {
  await withTempDirectory("git-review-change-race-", async (directory) => {
    const repo = join(directory, "repo");
    const shim = join(directory, "shim");
    await mkdir(repo);
    await mkdir(shim);
    git(repo, "init", "-q", "-b", "main");
    for (const path of ["a.txt", "b.txt"]) await writeFile(join(repo, path), "base\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "Base");
    for (const path of ["a.txt", "b.txt"]) await writeFile(join(repo, path), "before\n");
    const root = await approveRoot(directory);
    const handle = createApiHandler(root);
    const project = parseProjectResponse(
      (await (
        await handle(
          new Request("http://localhost/api/projects/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: "repo" }),
          }),
        )
      ).json()) as unknown,
    );
    const base = `http://localhost/api/projects/${project.id}`;
    const snapshot = async () =>
      parseChangeCheckResponse(
        (await (await handle(new Request(`${base}/status?mode=check`))).json()) as unknown,
      );
    const before = await snapshot();
    if (before.kind !== "git") throw new Error("Expected Git snapshot");
    const files = ["a.txt", "b.txt"].map((path): ChangeDiffRequest => ({
      layer: "unstaged",
      path,
      language: "text",
    }));
    const post = (revision: string, changeToken: string) =>
      handle(
        new Request(`${base}/diffs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision, changeToken, files }),
        }),
      );
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const marker = join(directory, "started");
    const gate = join(directory, "release");
    // Gate real diff subprocesses after the initial snapshot, without changing the API reader.
    await writeFile(
      join(shim, "git"),
      `#!${process.execPath}\nimport { existsSync, writeFileSync } from "node:fs";\nimport { spawnSync } from "node:child_process";\nconst args = process.argv.slice(2);\nif (args.includes("diff")) { writeFileSync(${JSON.stringify(marker)}, ""); const deadline = Date.now() + 5000; while (!existsSync(${JSON.stringify(gate)})) { if (Date.now() > deadline) process.exit(1); await Bun.sleep(5); } }\nconst child = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });\nprocess.exit(child.status ?? 1);\n`,
    );
    await chmod(join(shim, "git"), 0o755);
    const oldPath = process.env["PATH"];
    let pending: Promise<Response> | null = null;
    try {
      process.env["PATH"] = `${shim}:${oldPath ?? ""}`;
      pending = post(before.revision, before.changeToken);
      const deadline = Date.now() + 5000;
      while (!(await Bun.file(marker).exists())) {
        if (Date.now() > deadline) throw new Error("Diff work did not start");
        await Bun.sleep(5);
      }
      await writeFile(join(repo, "a.txt"), "changed during batch\n");
      await writeFile(gate, "");
      expect(await (await pending).json()).toEqual({
        kind: "stale",
        source: changeDiffBatchSource(project.id, before.revision, before.changeToken),
      });
      const after = await snapshot();
      if (after.kind !== "git") throw new Error("Expected edited snapshot");
      expect(after.revision).toBe(before.revision);
      expect(after.changeToken).not.toBe(before.changeToken);
      const current = parseChangeDiffBatchResponse(
        (await (await post(after.revision, after.changeToken)).json()) as unknown,
        changeDiffBatchSource(project.id, after.revision, after.changeToken),
        files.map(changeDiffRequestKey),
      );
      if (current.kind !== "ready") throw new Error("Expected recovery");
      const first = current.results[0];
      expect(
        first?.kind === "ready" &&
          first.value.kind === "text" &&
          first.value.hunks[0]?.lines.map((line) => line.text),
      ).toEqual(["base", "changed during batch"]);
    } finally {
      await writeFile(gate, "");
      if (oldPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = oldPath;
      await pending;
    }
  });
}, 15_000);
