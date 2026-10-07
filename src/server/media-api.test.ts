import { projectApiUrl } from "../shared/project-path.ts";
import { projectRequestUrl } from "../test-support.ts";
import { expect, test } from "bun:test";
import { testGit as git, withTempDirectory } from "../test-support.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseDiffResponse,
  parseFileReadResponse,
  parseProjectResponse,
  parseStatusResponse,
} from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

const mediaCases = [
  {
    path: "art #?.svg",
    kind: "image",
    mime: "image/svg+xml",
    bytes: (label: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`),
  },
  // Minimal container signatures: these checks exercise source bytes, not decoder support.
  {
    path: "sound [1].wav",
    kind: "audio",
    mime: "audio/wav",
    bytes: (label: string) => Buffer.from(`RIFF____WAVE${label}`),
  },
  {
    path: "clip ñ.mp4",
    kind: "video",
    mime: "video/mp4",
    bytes: (label: string) => Buffer.from(`\0\0\0\x18ftypisom${label}`),
  },
] as const;

test("working media with literal backslashes supports raw bytes, HEAD, ranges and stale versions", async () => {
  await withTempDirectory("git-review-literal-media-", async (base) => {
    await mkdir(join(base, "project", "literal\\directory"), { recursive: true });
    const handle = createApiHandler(await approveRoot(base));
    const opened = await handle(
      new Request(
        "http://localhost" + projectApiUrl("", (await approveRoot(base)).realPath + "/project"),
      ),
    );
    const project = parseProjectResponse(await opened.json());
    for (const media of mediaCases) {
      const path = `literal\\directory/odd\\${media.path}`;
      const absolutePath = join(base, "project", path);
      const bytes = media.bytes("working original");
      await writeFile(absolutePath, bytes);
      const query = new URLSearchParams({
        projectPath: project.absolutePath,
        path,
        source: "worktree",
      });
      const response = await handle(
        new Request(
          projectRequestUrl(`http://localhost/api/project/file?${query}`, project.absolutePath),
        ),
      );
      expect(response.status).toBe(200);
      const file = parseFileReadResponse(await response.json());
      if (file.kind !== "media") throw new Error(`Expected ${media.kind} preview`);
      expect(file.resource.kind).toBe(media.kind);
      const rawUrl = `http://localhost${file.resource.url}`;
      const raw = await handle(new Request(rawUrl));
      expect(raw.status).toBe(200);
      expect(Buffer.from(await raw.arrayBuffer())).toEqual(bytes);
      const head = await handle(new Request(rawUrl, { method: "HEAD" }));
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(bytes.length));
      expect(await head.text()).toBe("");
      if (media.kind !== "image") {
        const range = await handle(new Request(rawUrl, { headers: { range: "bytes=0-7" } }));
        expect(range.status).toBe(206);
        expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(0, 8));
      }
      await writeFile(absolutePath, media.bytes("working replacement with different size"));
      expect((await handle(new Request(rawUrl))).status).toBe(409);
      await rm(absolutePath);
      expect((await handle(new Request(rawUrl))).status).toBe(404);
    }
  });
});

for (const format of ["sha1", "sha256"] as const) {
  for (const namesake of [true, false]) {
    test(`subfolder media stays scoped across Git layers (${format}, outside namesake: ${namesake})`, async () => {
      await withTempDirectory("git-review-subfolder-media-", async (repository) => {
        const selected = join(repository, "inside space\nñ");
        await mkdir(selected);
        git(repository, "init", "-q", `--object-format=${format}`);
        for (const media of mediaCases) {
          await writeFile(join(selected, media.path), media.bytes("HEAD inside"));
          if (namesake)
            await writeFile(join(repository, media.path), media.bytes("OUTSIDE approved root"));
        }
        git(repository, "add", ".");
        git(repository, "commit", "-qm", "media baseline");
        for (const media of mediaCases)
          await writeFile(join(selected, media.path), media.bytes("INDEX inside"));
        git(repository, "add", ".");
        for (const media of mediaCases)
          await writeFile(join(selected, media.path), media.bytes("WORKTREE inside"));

        // Only the subfolder is approved: repository-root namesakes are outside its scope.
        const handle = createApiHandler(await approveRoot(selected));
        const opened = await handle(
          new Request(
            "http://localhost" + projectApiUrl("", (await approveRoot(selected)).realPath),
          ),
        );
        expect(opened.status).toBe(200);
        const project = parseProjectResponse((await opened.json()) as unknown);
        const base = `http://localhost/api/project`;
        const status = parseStatusResponse(
          (await (
            await handle(new Request(projectRequestUrl(`${base}/status`, project.absolutePath)))
          ).json()) as unknown,
        );
        if (status.kind !== "git") throw new Error("Expected Git status");

        for (const media of mediaCases) {
          for (const [layer, before, after] of [
            ["staged", "HEAD inside", "INDEX inside"],
            ["unstaged", "INDEX inside", "WORKTREE inside"],
          ] as const) {
            const query = new URLSearchParams({
              projectPath: project.absolutePath,
              layer,
              path: media.path,
              revision: status.revision,
              changeToken: status.changeToken,
            });
            const response = await handle(
              new Request(projectRequestUrl(`${base}/diff?${query}`, project.absolutePath)),
            );
            expect(response.status).toBe(200);
            const diff = parseDiffResponse((await response.json()) as unknown);
            if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready")
              throw new Error(`Expected ${layer} ${media.kind} sides`);
            for (const [side, label] of [
              [diff.old, before],
              [diff.new, after],
            ] as const) {
              const expected = media.bytes(label);
              expect(side.path).toBe(media.path);
              expect(side.resource.kind).toBe(media.kind);
              expect(side.resource.byteLength).toBe(expected.length);
              const rawUrl = `http://localhost${side.resource.url}`;
              const raw = await handle(new Request(rawUrl));
              expect(raw.status).toBe(200);
              expect(raw.headers.get("content-type")).toBe(media.mime);
              expect(Buffer.from(await raw.arrayBuffer())).toEqual(expected);
              const head = await handle(new Request(rawUrl, { method: "HEAD" }));
              expect(head.status).toBe(200);
              expect(head.headers.get("content-length")).toBe(String(expected.length));
              expect(await head.text()).toBe("");
              if (media.kind !== "image") {
                const range = await handle(
                  new Request(rawUrl, { headers: { range: "bytes=12-15" } }),
                );
                expect(range.status).toBe(206);
                expect(Buffer.from(await range.arrayBuffer())).toEqual(expected.subarray(12, 16));
              }
              if (namesake && layer === "staged" && side === diff.old) {
                const forged = new URL(rawUrl);
                const outsideOid = git(repository, "rev-parse", `HEAD:${media.path}`)
                  .toString("utf8")
                  .trim();
                forged.searchParams.set("version", outsideOid);
                expect((await handle(new Request(forged))).status).toBe(409);
              }
            }
          }
        }
      });
    });
  }
}

test("subfolder staged rename and deletion retain their scoped Old image", async () => {
  await withTempDirectory("git-review-subfolder-renames-", async (repository) => {
    const selected = join(repository, "inside");
    const renamed = mediaCases[0].bytes("renamed inside");
    const deleted = mediaCases[0].bytes("deleted inside");
    await mkdir(selected);
    git(repository, "init", "-q");
    for (const [path, bytes] of [
      ["old name.svg", renamed],
      ["deleted.svg", deleted],
    ] as const) {
      await writeFile(join(selected, path), bytes);
      await writeFile(join(repository, path), mediaCases[0].bytes("OUTSIDE approved root"));
    }
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "media baseline");
    git(repository, "mv", "inside/old name.svg", "inside/new name.svg");
    git(repository, "rm", "-q", "inside/deleted.svg");
    const handle = createApiHandler(await approveRoot(selected));
    const project = parseProjectResponse(
      (await (
        await handle(
          new Request(
            "http://localhost" + projectApiUrl("", (await approveRoot(selected)).realPath),
          ),
        )
      ).json()) as unknown,
    );
    const base = `http://localhost/api/project`;
    const status = parseStatusResponse(
      (await (
        await handle(new Request(projectRequestUrl(`${base}/status`, project.absolutePath)))
      ).json()) as unknown,
    );
    if (status.kind !== "git") throw new Error("Expected Git status");
    expect(status.entries).toContainEqual({
      layer: "staged",
      kind: "renamed",
      path: "new name.svg",
      oldPath: "old name.svg",
      isSubmodule: false,
      stats: { kind: "text", added: 0, deleted: 0 },
    });
    for (const [path, expected] of [
      ["new name.svg", renamed],
      ["deleted.svg", deleted],
    ] as const) {
      const query = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "staged",
        path,
        revision: status.revision,
        changeToken: status.changeToken,
      });
      const diff = parseDiffResponse(
        (await (
          await handle(
            new Request(projectRequestUrl(`${base}/diff?${query}`, project.absolutePath)),
          )
        ).json()) as unknown,
      );
      if (diff.kind !== "media" || diff.old.kind !== "ready")
        throw new Error("Expected scoped Old image");
      const old = await handle(new Request(`http://localhost${diff.old.resource.url}`));
      expect(old.status).toBe(200);
      expect(Buffer.from(await old.arrayBuffer())).toEqual(expected);
      if (path === "new name.svg") {
        expect(diff.old.path).toBe("old name.svg");
        if (diff.new.kind !== "ready") throw new Error("Expected renamed New image");
        const next = await handle(new Request(`http://localhost${diff.new.resource.url}`));
        expect(next.status).toBe(200);
        expect(Buffer.from(await next.arrayBuffer())).toEqual(renamed);
      } else expect(diff.new.kind).toBe("absent");
    }
  });
});
