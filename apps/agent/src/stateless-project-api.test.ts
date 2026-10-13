import { expect, test } from "bun:test";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseDiffResponse,
  parseFileReadResponse,
  parseStatusResponse,
} from "@git-review/shared/api";
import { parseCommitDiff } from "@git-review/shared/git";
import { projectApiUrl } from "@git-review/shared/project-path";
import { testGitText as git, withTempDirectory } from "../../../qa/test-support.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("every project resource works on a fresh handler without selection or registration", async () => {
  await withTempDirectory("git-review-stateless-", async (directory) => {
    const root = await approveRoot(directory);
    const projectPath = join(root.realPath, "project : #?% 雪");
    await mkdir(projectPath);
    git(projectPath, "init", "-q", "-b", "main");
    await writeFile(join(projectPath, "value.ts"), "export const value = 1;\n");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>before</text></svg>';
    await writeFile(join(projectPath, "art.svg"), svg);
    git(projectPath, "add", ".");
    git(projectPath, "commit", "-qm", "First");
    const oid = git(projectPath, "rev-parse", "HEAD");
    await writeFile(join(projectPath, "value.ts"), "export const value = 2;\n");
    await writeFile(join(projectPath, "art.svg"), svg.replace("before", "after"));
    git(projectPath, "add", ".");
    // Construct a fresh handler for EACH read, including bytes described by a previous handler.
    const read = (resource: string, fields: Record<string, string> = {}, init?: RequestInit) =>
      createApiHandler(root)(
        new Request("http://localhost" + projectApiUrl(resource, projectPath, fields), init),
      );
    for (const [resource, fields] of [
      ["/tree", { path: "" }],
      ["/file", { path: "value.ts", source: "worktree" }],
      ["/search", { query: "value" }],
      ["/git/refs", {}],
      ["/git/log", { ref: "refs/heads/main" }],
      [`/git/commits/${oid}`, {}],
      [`/git/commits/${oid}/diff`, { path: "value.ts" }],
      ["/status", { mode: "check" }],
    ] satisfies [string, Record<string, string>][])
      expect((await read(resource, fields)).status).toBe(200);
    const status = parseStatusResponse(await (await read("/status")).json());
    if (status.kind !== "git") throw new Error("Expected Git fixture");
    const fields = {
      layer: "staged",
      path: "art.svg",
      revision: status.revision,
      changeToken: status.changeToken,
    };
    const media = parseDiffResponse(await (await read("/diff", fields)).json());
    if (media.kind !== "media" || media.new.kind !== "ready")
      throw new Error("Expected diff media");
    const working = parseFileReadResponse(
      await (await read("/file", { path: "art.svg", source: "worktree" })).json(),
    );
    if (working.kind !== "media") throw new Error("Expected working media");
    const committed = parseCommitDiff(
      await (await read(`/git/commits/${oid}/diff`, { path: "art.svg" })).json(),
    );
    if (committed.kind !== "media" || committed.new.kind !== "ready")
      throw new Error("Expected commit media");
    for (const resource of [working.resource, media.new.resource, committed.new.resource]) {
      expect(new URL(resource.url, "http://localhost").searchParams.get("projectPath")).toBe(
        projectPath,
      );
      for (const method of ["GET", "HEAD"])
        expect(
          (await createApiHandler(root)(new Request("http://localhost" + resource.url, { method })))
            .status,
        ).toBe(200);
    }
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(
      (
        await read(
          "/diffs",
          {},
          json({
            revision: status.revision,
            changeToken: status.changeToken,
            files: [{ layer: "staged", path: "value.ts", language: null }],
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await read(
          `/git/commits/${oid}/diffs`,
          {},
          json({ files: [{ path: "value.ts", language: null }] }),
        )
      ).status,
    ).toBe(200);
  });
});

test("path input and changed folders fail independently of any previous lookup", async () => {
  await withTempDirectory("git-review-stateless-errors-", async (directory) => {
    const root = await approveRoot(directory);
    const path = join(root.realPath, "project");
    await mkdir(path);
    const handle = createApiHandler(root);
    for (const query of [
      "",
      "projectPath=relative",
      "projectPath=%FF",
      "projectPath=%00",
      "projectPath=" + encodeURIComponent(path) + "&projectPath=" + encodeURIComponent(path),
    ])
      expect(
        (await handle(new Request(`http://localhost/api/project/status?${query}`))).status,
      ).toBe(400);
    for (const oldRoute of ["/api/projects/open", "/api/projects/01234567890123456789/status"])
      expect(
        (
          await handle(
            new Request("http://localhost" + oldRoute, {
              method: oldRoute.endsWith("open") ? "POST" : "GET",
            }),
          )
        ).status,
      ).toBe(404);
    const request = () => new Request("http://localhost" + projectApiUrl("/status", path));
    expect((await handle(request())).status).toBe(200);
    await rename(path, join(root.realPath, "moved"));
    const missing = await handle(request());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "project_not_found" } });
    await symlink(join(root.realPath, "moved"), path);
    const changed = await handle(request());
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: "project_changed" } });
    const selected = await handle(new Request("http://localhost" + projectApiUrl("", path)));
    expect(await selected.json()).toMatchObject({
      project: { absolutePath: join(root.realPath, "moved"), relativePath: "moved" },
    });
  });
});
