import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDiffResponse, parseLanguagesResponse, parseProjectResponse, parseStatusResponse } from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("status access requires an opened folder and rechecks its approved path", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "git-review-api-root-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "git-review-api-outside-"));
  try {
    const projectPath = join(rootPath, "project");
    await mkdir(projectPath);
    execFileSync("git", ["init", "-q"], { cwd: projectPath, stdio: "pipe" });
    const handle = createApiHandler(await approveRoot(rootPath));
    expect(parseLanguagesResponse(await (await handle(new Request("http://localhost/api/languages"))).json() as unknown)).toContainEqual({ id: "c", name: "C" });
    const unknown = await handle(new Request("http://localhost/api/projects/aaaaaaaaaaaaaaaaaaaa/status"));
    expect(unknown.status).toBe(404);

    const opened = await handle(new Request("http://localhost/api/projects/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "project" }),
    }));
    expect(opened.status).toBe(200);
    const project = parseProjectResponse(await opened.json() as unknown);
    const url = `http://localhost/api/projects/${project.id}/status`;
    const current = await handle(new Request(url));
    expect(current.status).toBe(200);
    const cleanStatus = parseStatusResponse(await current.json() as unknown);
    expect(cleanStatus.kind).toBe("git");
    if (cleanStatus.kind !== "git") throw new Error("Expected Git status");

    await writeFile(join(projectPath, "new.txt"), "first\n");
    const changedStatus = parseStatusResponse(await (await handle(new Request(url))).json() as unknown);
    if (changedStatus.kind !== "git") throw new Error("Expected Git status");
    const diffUrl = new URL(`http://localhost/api/projects/${project.id}/diff`);
    diffUrl.search = new URLSearchParams({ layer: "untracked", path: "new.txt", revision: changedStatus.revision }).toString();
    expect(parseDiffResponse(await (await handle(new Request(diffUrl))).json() as unknown).kind).toBe("text");
    diffUrl.search = new URLSearchParams({ layer: "untracked", path: "new.txt", revision: changedStatus.revision, language: "invalid-grammar" }).toString();
    expect((await handle(new Request(diffUrl))).status).toBe(400);
    diffUrl.search = new URLSearchParams({ layer: "untracked", path: "other.txt", revision: changedStatus.revision }).toString();
    expect((await handle(new Request(diffUrl))).status).toBe(404);
    diffUrl.search = new URLSearchParams({ layer: "untracked", path: "new.txt", revision: cleanStatus.revision }).toString();
    expect(parseDiffResponse(await (await handle(new Request(diffUrl))).json() as unknown)).toEqual({ kind: "stale" });

    await rename(projectPath, join(rootPath, "moved"));
    await symlink(outsidePath, projectPath);
    const escaped = await handle(new Request(url));
    expect(escaped.status).toBe(403);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test("configured HTTPS proxy origin is accepted without trusting other origins", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "git-review-origin-root-"));
  try {
    const handle = createApiHandler(await approveRoot(rootPath), "https://private-host.ts.net");
    const request = (origin: string) => new Request("http://127.0.0.1:39879/api/roots", { headers: { origin } });
    expect((await handle(request("https://private-host.ts.net"))).status).toBe(200);
    expect((await handle(request("http://127.0.0.1:39879"))).status).toBe(200);
    expect((await handle(request("https://other-host.ts.net"))).status).toBe(403);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
