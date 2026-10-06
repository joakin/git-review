import { projectApiUrl } from "../shared/project-path.ts";
import { projectRequestUrl } from "../test-support.ts";
import { expect, test } from "bun:test";
import { testGit as git, withTempDirectory } from "../test-support.ts";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseProjectResponse, parseSearchResponse } from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("search uses literal text and respects project, ignore, and link boundaries", async () => {
  await withTempDirectory("git-review-search-", async (rootPath) => {
    await withTempDirectory("git-review-search-outside-", async (outsidePath) => {
      const projectPath = join(rootPath, "project");
      await mkdir(projectPath);
      git(projectPath, "init", "-q");
      await writeFile(join(projectPath, ".gitignore"), "ignored.txt\n");
      await writeFile(join(projectPath, "source.ts"), "line one\nconst found = '-word';\n");
      await writeFile(join(projectPath, "odd:name.ts"), "-word in an unusual path\n");
      await writeFile(join(projectPath, ".hidden.ts"), "-word hidden\n");
      await writeFile(join(projectPath, "ignored.txt"), "-word ignored\n");
      await writeFile(join(outsidePath, "outside.txt"), "-word outside\n");
      await symlink(join(outsidePath, "outside.txt"), join(projectPath, "linked.txt"));
      const handle = createApiHandler(await approveRoot(rootPath));
      const opened = await handle(
        new Request(
          "http://localhost" +
            projectApiUrl("", (await approveRoot(rootPath)).realPath + "/project"),
        ),
      );
      const project = parseProjectResponse((await opened.json()) as unknown);
      const endpoint = `http://localhost/api/project/search`;
      expect(
        (await handle(new Request(projectRequestUrl(endpoint, project.absolutePath)))).status,
      ).toBe(400);
      expect(
        (
          await handle(
            new Request(projectRequestUrl(`${endpoint}?query=x&query=y`, project.absolutePath)),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await handle(
            new Request(projectRequestUrl(`${endpoint}?query=%0A`, project.absolutePath)),
          )
        ).status,
      ).toBe(400);
      const response = await handle(
        new Request(projectRequestUrl(`${endpoint}?query=-word`, project.absolutePath)),
      );
      expect(response.status).toBe(200);
      const results = parseSearchResponse((await response.json()) as unknown);
      expect(results.query).toBe("-word");
      expect(results.truncated).toBe(false);
      expect(
        results.matches
          .map(({ path, line }) => ({ path, line }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      ).toEqual([
        { path: ".hidden.ts", line: 1 },
        { path: "odd:name.ts", line: 1 },
        { path: "source.ts", line: 2 },
      ]);
      const none = parseSearchResponse(
        (await (
          await handle(
            new Request(projectRequestUrl(`${endpoint}?query=absent-symbol`, project.absolutePath)),
          )
        ).json()) as unknown,
      );
      expect(none.matches).toEqual([]);
      await rm(projectPath, { recursive: true, force: true });
      await symlink(outsidePath, projectPath);
      expect(
        (
          await handle(
            new Request(projectRequestUrl(`${endpoint}?query=-word`, project.absolutePath)),
          )
        ).status,
      ).toBe(403);
    });
  });
});

test("search reports incomplete results when the match limit is reached", async () => {
  await withTempDirectory("git-review-search-limit-", async (rootPath) => {
    await writeFile(
      join(rootPath, "many.txt"),
      Array.from({ length: 120 }, (_, index) => `needle ${index}`).join("\n"),
    );
    const handle = createApiHandler(await approveRoot(rootPath));
    const opened = await handle(
      new Request("http://localhost" + projectApiUrl("", (await approveRoot(rootPath)).realPath)),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const response = await handle(
      new Request(
        projectRequestUrl(`http://localhost/api/project/search?query=needle`, project.absolutePath),
      ),
    );
    expect(response.status).toBe(200);
    const results = parseSearchResponse((await response.json()) as unknown);
    expect(results.matches).toHaveLength(100);
    expect(results.truncated).toBe(true);
  });
});
