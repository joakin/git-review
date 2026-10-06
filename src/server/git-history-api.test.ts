import { projectApiUrl } from "../shared/project-path.ts";
import { projectRequestUrl } from "../test-support.ts";
import { expect, test } from "bun:test";
import { testGitText as git, withTempDirectory } from "../test-support.ts";
import { chmod, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseProjectResponse } from "../shared/api.ts";
import {
  parseCommitDetail,
  parseCommitDiff,
  parseGitHistory,
  parseGitRefs,
} from "../shared/git.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("Git APIs validate destinations and serve source-correct committed text and media", async () => {
  await withTempDirectory("git-review-history-api-", async (directory) => {
    await withTempDirectory("git-review-history-outside-", async (outside) => {
      const repo = join(directory, "repo");
      await mkdir(repo);
      git(repo, "init", "-q", "-b", "main");
      const old = '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>';
      const next = '<svg xmlns="http://www.w3.org/2000/svg"><text>new</text></svg>';
      await writeFile(join(repo, "art.svg"), old);
      await writeFile(join(repo, "value.ts"), "export const value = 1;\n");
      await writeFile(join(repo, "mode.sh"), "#!/bin/sh\n");
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Base");
      await writeFile(join(repo, "art.svg"), next);
      await writeFile(join(repo, "value.ts"), "export const value = 2;\n");
      await chmod(join(repo, "mode.sh"), 0o755);
      await writeFile(
        join(repo, "voice.wav"),
        Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(100)]),
      );
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "Updated\n\nComplete commit body.");
      const oid = git(repo, "rev-parse", "HEAD");
      await writeFile(
        join(repo, "art.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><text>working</text></svg>',
      );
      await rm(join(repo, "value.ts"));
      const handle = createApiHandler(await approveRoot(directory));
      expect((await handle(new Request("http://localhost/api/project/git/refs"))).status).toBe(400);
      const opened = await handle(
        new Request(
          "http://localhost" + projectApiUrl("", (await approveRoot(directory)).realPath + "/repo"),
        ),
      );
      const project = parseProjectResponse((await opened.json()) as unknown);
      const base = `http://localhost/api/project`;
      const get = (path: string) =>
        handle(new Request(projectRequestUrl(base + path, project.absolutePath)));
      expect(parseGitRefs((await (await get("/git/refs")).json()) as unknown).kind).toBe("git");
      expect(
        parseGitHistory((await (await get("/git/log?ref=refs/heads/main")).json()) as unknown)
          .commits[0]?.oid,
      ).toBe(oid);
      for (const path of [
        "/git/refs?other=1",
        "/git/log?ref=HEAD&tip=" + oid,
        "/git/log?ref=HEAD&ref=HEAD",
        "/git/log?ref=HEAD~1",
        `/git/log?tip=${oid}&offset=-1`,
        `/git/log?tip=${oid}&offset=1`,
        `/git/commits/${oid}?unknown=1`,
        `/git/commits/${oid}/diff?path=../secret`,
        `/git/commits/${oid}/diff?path=value.ts&language=not-a-language`,
        `/git/commits/${oid}/diff?path=art.svg&language=not-a-language`,
        `/git/commits/${oid}/diff?path=voice.wav&language=not-a-language`,
      ])
        expect((await get(path)).status).toBe(400);
      const detail = parseCommitDetail(
        (await (await get(`/git/commits/${oid}`)).json()) as unknown,
      );
      expect(detail.message).toContain("Complete commit body.");
      expect(detail.stats).toEqual({ kind: "ready", added: 2, deleted: 2, binaryFiles: 1 });
      expect(
        parseGitHistory((await (await get("/git/log?ref=refs/heads/main")).json()) as unknown)
          .commits[0]?.stats,
      ).toEqual(detail.stats);
      const mode = detail.files.find((file) => file.path === "mode.sh");
      expect(mode?.old.kind === "present" && mode.old.mode).toBe("100644");
      expect(mode?.new.kind === "present" && mode.new.mode).toBe("100755");
      const text = parseCommitDiff(
        (await (await get(`/git/commits/${oid}/diff?path=value.ts`)).json()) as unknown,
      );
      expect(text.kind === "text" && text.hunks[0]?.lines.map((line) => line.text)).toEqual([
        "export const value = 1;",
        "export const value = 2;",
      ]);
      const media = parseCommitDiff(
        (await (await get(`/git/commits/${oid}/diff?path=art.svg`)).json()) as unknown,
      );
      if (media.kind !== "media" || media.old.kind !== "ready" || media.new.kind !== "ready")
        throw new Error("Expected both committed media sides");
      const oldResponse = await handle(new Request("http://localhost" + media.old.resource.url));
      expect(await oldResponse.text()).toBe(old);
      const nextResponse = await handle(new Request("http://localhost" + media.new.resource.url));
      expect(await nextResponse.text()).toBe(next);
      expect(nextResponse.headers.get("content-security-policy")).toContain("sandbox");
      const mismatch = new URL("http://localhost" + media.new.resource.url);
      mismatch.searchParams.set("version", "a".repeat(40));
      expect((await handle(new Request(mismatch))).status).toBe(404);
      const audio = parseCommitDiff(
        (await (await get(`/git/commits/${oid}/diff?path=voice.wav`)).json()) as unknown,
      );
      if (audio.kind !== "media" || audio.new.kind !== "ready")
        throw new Error("Expected committed audio");
      const range = await handle(
        new Request("http://localhost" + audio.new.resource.url, {
          headers: { range: "bytes=0-11" },
        }),
      );
      expect(range.status).toBe(206);
      expect(await range.text()).toBe("RIFF0000WAVE");
      const head = await handle(
        new Request("http://localhost" + audio.new.resource.url, { method: "HEAD" }),
      );
      expect(head.headers.get("content-length")).toBe("112");
      expect(await head.text()).toBe("");
      await rename(repo, join(directory, "moved"));
      await symlink(outside, repo);
      expect((await get(`/git/commits/${oid}`)).status).toBe(403);
      expect((await handle(new Request("http://localhost" + media.new.resource.url))).status).toBe(
        403,
      );
    });
  });
});

test("SHA-256 repositories preserve complete IDs throughout Git inspection", async () => {
  await withTempDirectory("git-review-history-sha256-", async (directory) => {
    git(directory, "init", "-q", "-b", "main", "--object-format=sha256");
    await writeFile(join(directory, "file.txt"), "first\n");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "First");
    const handle = createApiHandler(await approveRoot(directory));
    const opened = await handle(
      new Request("http://localhost" + projectApiUrl("", (await approveRoot(directory)).realPath)),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const oid = git(directory, "rev-parse", "HEAD");
    const response = await handle(
      new Request(
        projectRequestUrl(`http://localhost/api/project/git/commits/${oid}`, project.absolutePath),
      ),
    );
    const detail = parseCommitDetail((await response.json()) as unknown);
    expect(detail.oid.length).toBe(64);
    expect(detail.stats).toEqual({ kind: "ready", added: 1, deleted: 0, binaryFiles: 0 });
    expect(detail.files[0]?.new.kind === "present" && detail.files[0].new.oid.length).toBe(64);
  });
});
