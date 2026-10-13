import { projectApiUrl } from "@git-review/shared/project-path";
import { projectRequestUrl } from "../../../qa/test-support.ts";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testGitText as git, withTempDirectory } from "../../../qa/test-support.ts";
import {
  parseChangeCheckResponse,
  parseDiffResponse,
  parseProjectResponse,
  type DiffResult,
} from "@git-review/shared/api";
import type { ChangeSnapshot } from "@git-review/shared/change-snapshot";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchResponse,
  type ChangeDiffRequest,
} from "@git-review/shared/change-diff-batch";
import { maxDiffBatchRequestBytes } from "@git-review/shared/diff-batch";
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
            new Request(
              "http://localhost" +
                projectApiUrl("", (await approveRoot(directory)).realPath + "/repo"),
            ),
          )
        ).json()) as unknown,
      );
      const base = `http://localhost/api/project`;
      const status = parseChangeCheckResponse(
        (await (
          await handle(
            new Request(projectRequestUrl(`${base}/status?mode=check`, project.absolutePath)),
          )
        ).json()) as unknown,
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
      const post = (
        value: unknown,
        url = projectRequestUrl(`${base}/diffs`, project.absolutePath),
      ) =>
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
        changeDiffBatchSource(project.absolutePath, status.revision, status.changeToken),
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
          projectPath: project.absolutePath,
          layer: file.layer,
          path: file.path,
          revision: status.revision,
          changeToken: status.changeToken,
        });
        if (file.language !== null) query.set("language", file.language);
        const single = parseDiffResponse(
          (await (
            await handle(
              new Request(projectRequestUrl(`${base}/diff?${query}`, project.absolutePath)),
            )
          ).json()) as unknown,
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
      expect(
        (await post(body, projectRequestUrl(`${base}/diffs?extra=1`, project.absolutePath))).status,
      ).toBe(400);
      expect((await post({ padding: "x".repeat(maxDiffBatchRequestBytes) })).status).toBe(413);
      await writeFile(join(repo, path), "export const value = 'edited again';\n");
      const newer = parseChangeCheckResponse(
        (await (
          await handle(
            new Request(projectRequestUrl(`${base}/status?mode=check`, project.absolutePath)),
          )
        ).json()) as unknown,
      );
      if (newer.kind !== "git") throw new Error("Expected edited snapshot");
      expect(newer.revision).toBe(status.revision);
      expect(newer.changeToken).not.toBe(status.changeToken);
      expect(await (await post(body)).json()).toEqual({
        kind: "stale",
        source: changeDiffBatchSource(project.absolutePath, status.revision, status.changeToken),
      });
      const staleSingle = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "unstaged",
        path,
        revision: status.revision,
        changeToken: status.changeToken,
      });
      expect(
        await (
          await handle(
            new Request(projectRequestUrl(`${base}/diff?${staleSingle}`, project.absolutePath)),
          )
        ).json(),
      ).toEqual({
        kind: "stale",
      });
      expect(
        (
          await handle(
            new Request(
              projectRequestUrl(
                `${base}/diff?${staleSingle}&changeToken=${status.changeToken}`,
                project.absolutePath,
              ),
            ),
          )
        ).status,
      ).toBe(400);
      expect((await post({ ...body, changeToken: newer.changeToken })).status).toBe(200);
      staleSingle.set("changeToken", newer.changeToken);
      expect(
        parseDiffResponse(
          (await (
            await handle(
              new Request(projectRequestUrl(`${base}/diff?${staleSingle}`, project.absolutePath)),
            )
          ).json()) as unknown,
        ).kind,
      ).toBe("text");
      await rename(repo, join(directory, "moved"));
      await symlink(outside, repo);
      expect((await post(body)).status).toBe(403);
    });
  });
});

for (const mode of ["batch", "individual"] as const)
  test(`an edit during ${mode} diff work invalidates its snapshot and permits a fresh retry`, async () => {
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
          await handle(new Request("http://localhost" + projectApiUrl("", root.realPath + "/repo")))
        ).json()) as unknown,
      );
      const base = `http://localhost/api/project`;
      const snapshot = async () =>
        parseChangeCheckResponse(
          (await (
            await handle(
              new Request(projectRequestUrl(`${base}/status?mode=check`, project.absolutePath)),
            )
          ).json()) as unknown,
        );
      const before = await snapshot();
      if (before.kind !== "git") throw new Error("Expected Git snapshot");
      const files = ["a.txt", "b.txt"].map((path): ChangeDiffRequest => ({
        layer: "unstaged",
        path,
        language: "text",
      }));
      const read = (version: ChangeSnapshot) =>
        mode === "batch"
          ? handle(
              new Request(projectRequestUrl(`${base}/diffs`, project.absolutePath), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  revision: version.revision,
                  changeToken: version.changeToken,
                  files,
                }),
              }),
            )
          : handle(
              new Request(
                "http://localhost" +
                  projectApiUrl("/diff", project.absolutePath, {
                    revision: version.revision,
                    changeToken: version.changeToken,
                    layer: "unstaged",
                    path: "a.txt",
                    language: "text",
                  }),
              ),
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
        pending = read(before);
        const deadline = Date.now() + 5000;
        while (!(await Bun.file(marker).exists())) {
          if (Date.now() > deadline) throw new Error("Diff work did not start");
          await Bun.sleep(5);
        }
        await writeFile(join(repo, "a.txt"), "changed during diff\n");
        await writeFile(gate, "");
        expect(await (await pending).json()).toEqual(
          mode === "batch"
            ? {
                kind: "stale",
                source: changeDiffBatchSource(
                  project.absolutePath,
                  before.revision,
                  before.changeToken,
                ),
              }
            : { kind: "stale" },
        );
        const after = await snapshot();
        if (after.kind !== "git") throw new Error("Expected edited snapshot");
        expect(after.revision).toBe(before.revision);
        expect(after.changeToken).not.toBe(before.changeToken);
        const body: unknown = await (await read(after)).json();
        let diff: DiffResult;
        if (mode === "batch") {
          const current = parseChangeDiffBatchResponse(
            body,
            changeDiffBatchSource(project.absolutePath, after.revision, after.changeToken),
            files.map(changeDiffRequestKey),
          );
          if (current.kind !== "ready") throw new Error("Expected recovery");
          const first = current.results[0];
          if (first?.kind !== "ready") throw new Error("Expected recovered diff");
          diff = first.value;
        } else diff = parseDiffResponse(body);
        expect(diff.kind === "text" && diff.hunks[0]?.lines.map((line) => line.text)).toEqual([
          "base",
          "changed during diff",
        ]);
      } finally {
        await writeFile(gate, "");
        if (oldPath === undefined) delete process.env["PATH"];
        else process.env["PATH"] = oldPath;
        await pending;
      }
    });
  }, 15_000);
