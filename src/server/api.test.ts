import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseProjectResponse } from "../shared/api.ts";
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
    expect((await current.json() as { kind: string }).kind).toBe("git");

    await rename(projectPath, join(rootPath, "moved"));
    await symlink(outsidePath, projectPath);
    const escaped = await handle(new Request(url));
    expect(escaped.status).toBe(403);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
