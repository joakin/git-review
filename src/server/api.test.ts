import { projectApiUrl } from "../shared/project-path.ts";
import { projectRequestUrl } from "../test-support.ts";
import { expect, test } from "bun:test";
import { testGit as git, withTempDirectory } from "../test-support.ts";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseDiffResponse,
  parseFileReadResponse,
  parseFileTreeResponse,
  parseLanguagesResponse,
  parseProjectResponse,
  parseStatusResponse,
  parseChangeCheckResponse,
} from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

test("status access accepts a project path and rechecks its approved path", async () => {
  await withTempDirectory("git-review-api-root-", async (rootPath) => {
    await withTempDirectory("git-review-api-outside-", async (outsidePath) => {
      const projectPath = join(rootPath, "project");
      await mkdir(projectPath);
      git(projectPath, "init", "-q");
      const handle = createApiHandler(await approveRoot(rootPath));
      expect(
        parseLanguagesResponse(
          (await (await handle(new Request("http://localhost/api/languages"))).json()) as unknown,
        ),
      ).toContainEqual({ id: "c", name: "C" });
      const unknown = await handle(new Request("http://localhost/api/project/status"));
      expect(unknown.status).toBe(400);

      const opened = await handle(
        new Request(
          "http://localhost" +
            projectApiUrl("", (await approveRoot(rootPath)).realPath + "/project"),
        ),
      );
      expect(opened.status).toBe(200);
      const project = parseProjectResponse((await opened.json()) as unknown);
      const url = `http://localhost/api/project/status`;
      const current = await handle(new Request(projectRequestUrl(url, project.absolutePath)));
      expect(current.status).toBe(200);
      const cleanStatus = parseStatusResponse((await current.json()) as unknown);
      expect(cleanStatus.kind).toBe("git");
      if (cleanStatus.kind !== "git") throw new Error("Expected Git status");

      await writeFile(join(projectPath, "new.txt"), "first\n");
      const changedStatus = parseStatusResponse(
        (await (
          await handle(new Request(projectRequestUrl(url, project.absolutePath)))
        ).json()) as unknown,
      );
      if (changedStatus.kind !== "git") throw new Error("Expected Git status");
      expect(changedStatus.entries[0]?.stats).toEqual({ kind: "text", added: 1, deleted: 0 });
      const checkBody: unknown = await (
        await handle(new Request(projectRequestUrl(`${url}?mode=check`, project.absolutePath)))
      ).json();
      expect(checkBody).toEqual(parseChangeCheckResponse(changedStatus));
      expect(() => parseStatusResponse(checkBody)).toThrow();
      for (const query of ["mode=unknown", "mode=check&mode=check", "other=value", "mode="])
        expect(
          (await handle(new Request(projectRequestUrl(`${url}?${query}`, project.absolutePath))))
            .status,
        ).toBe(400);
      const diffUrl = new URL(
        projectRequestUrl(`http://localhost/api/project/diff`, project.absolutePath),
      );
      diffUrl.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "untracked",
        path: "new.txt",
        revision: changedStatus.revision,
        changeToken: changedStatus.changeToken,
      }).toString();
      expect(
        parseDiffResponse((await (await handle(new Request(diffUrl))).json()) as unknown).kind,
      ).toBe("text");
      for (const key of ["revision", "changeToken"])
        for (const value of [null, "", "old", "A".repeat(20), "a".repeat(21)]) {
          const invalid = new URL(diffUrl);
          if (value === null) invalid.searchParams.delete(key);
          else invalid.searchParams.set(key, value);
          expect((await handle(new Request(invalid))).status).toBe(400);
        }
      diffUrl.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "untracked",
        path: "new.txt",
        revision: changedStatus.revision,
        changeToken: changedStatus.changeToken,
        language: "invalid-grammar",
      }).toString();
      expect((await handle(new Request(diffUrl))).status).toBe(400);
      diffUrl.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "untracked",
        path: "other.txt",
        revision: changedStatus.revision,
        changeToken: changedStatus.changeToken,
      }).toString();
      expect((await handle(new Request(diffUrl))).status).toBe(404);
      diffUrl.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer: "untracked",
        path: "new.txt",
        revision: cleanStatus.revision,
        changeToken: cleanStatus.changeToken,
      }).toString();
      expect(
        parseDiffResponse((await (await handle(new Request(diffUrl))).json()) as unknown),
      ).toEqual({ kind: "stale" });

      await rename(projectPath, join(rootPath, "moved"));
      await symlink(outsidePath, projectPath);
      const escaped = await handle(new Request(projectRequestUrl(url, project.absolutePath)));
      expect(escaped.status).toBe(403);
    });
  });
});

test("configured HTTPS proxy origin is accepted without trusting other origins", async () => {
  await withTempDirectory("git-review-origin-root-", async (rootPath) => {
    const handle = createApiHandler(await approveRoot(rootPath), "https://private-host.ts.net");
    const request = (origin: string) =>
      new Request("http://127.0.0.1:39879/api/roots", { headers: { origin } });
    expect((await handle(request("https://private-host.ts.net"))).status).toBe(200);
    expect((await handle(request("http://127.0.0.1:39879"))).status).toBe(200);
    expect((await handle(request("https://other-host.ts.net"))).status).toBe(403);
  });
});

test("file API accepts a project path and serves non-Git working-tree files", async () => {
  await withTempDirectory("git-review-file-api-", async (rootPath) => {
    await mkdir(join(rootPath, "notes"));
    await writeFile(join(rootPath, "notes", "idea.ts"), "export const idea = 1;\n");
    const handle = createApiHandler(await approveRoot(rootPath));
    const unknown = await handle(new Request("http://localhost/api/project/tree?path="));
    expect(unknown.status).toBe(400);
    const opened = await handle(
      new Request(
        "http://localhost" + projectApiUrl("", (await approveRoot(rootPath)).realPath + "/notes"),
      ),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const base = `http://localhost/api/project`;
    const tree = parseFileTreeResponse(
      (await (
        await handle(new Request(projectRequestUrl(`${base}/tree?path=`, project.absolutePath)))
      ).json()) as unknown,
    );
    expect(tree.entries).toEqual([{ name: "idea.ts", path: "idea.ts", kind: "file" }]);
    expect(
      (
        await handle(
          new Request(projectRequestUrl(`${base}/file?path=idea.ts`, project.absolutePath)),
        )
      ).status,
    ).toBe(400);
    const file = parseFileReadResponse(
      (await (
        await handle(
          new Request(
            projectRequestUrl(`${base}/file?path=idea.ts&source=worktree`, project.absolutePath),
          ),
        )
      ).json()) as unknown,
    );
    expect(file.kind).toBe("text");
    const missing = await handle(
      new Request(
        projectRequestUrl(`${base}/file?path=missing.txt&source=worktree`, project.absolutePath),
      ),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "file_not_found" } });
    expect(
      (await handle(new Request(projectRequestUrl(`${base}/tree?path=..`, project.absolutePath))))
        .status,
    ).toBe(400);
  });
});

test("image previews keep HEAD, index, and working-tree versions separate and gate raw access", async () => {
  await withTempDirectory("git-review-images-", async (rootPath) => {
    const projectPath = join(rootPath, "project");
    await mkdir(projectPath);
    git(projectPath, "init", "-q");
    const old = '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>';
    const staged = '<svg xmlns="http://www.w3.org/2000/svg"><text>staged</text></svg>';
    const current =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.attack()</script><text>current</text></svg>';
    await writeFile(join(projectPath, "art.svg"), old);
    await writeFile(join(projectPath, "deleted.svg"), old);
    git(projectPath, "add", "art.svg", "deleted.svg");
    git(projectPath, "commit", "-qm", "image");
    await writeFile(join(projectPath, "art.svg"), staged);
    git(projectPath, "add", "art.svg");
    await writeFile(join(projectPath, "art.svg"), current);
    git(projectPath, "rm", "-q", "deleted.svg");
    await writeFile(join(projectPath, "untracked.svg"), current);
    await writeFile(
      join(projectPath, "exported.svg"),
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    const handle = createApiHandler(await approveRoot(rootPath));
    const opened = await handle(
      new Request(
        "http://localhost" + projectApiUrl("", (await approveRoot(rootPath)).realPath + "/project"),
      ),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const base = `http://localhost/api/project`;
    const status = parseStatusResponse(
      (await (
        await handle(new Request(projectRequestUrl(`${base}/status`, project.absolutePath)))
      ).json()) as unknown,
    );
    if (status.kind !== "git") throw new Error("Expected Git status");
    const rawText = async (url: string) => {
      const response = await handle(new Request(`http://localhost${url}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      return response.text();
    };
    for (const [layer, before, after] of [
      ["staged", old, staged],
      ["unstaged", staged, current],
    ] as const) {
      const url = new URL(projectRequestUrl(`${base}/diff`, project.absolutePath));
      url.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer,
        path: "art.svg",
        revision: status.revision,
        changeToken: status.changeToken,
      }).toString();
      const diff = parseDiffResponse(
        (await (
          await handle(new Request(projectRequestUrl(url, project.absolutePath)))
        ).json()) as unknown,
      );
      if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready")
        throw new Error(`Expected ${layer} image sides`);
      expect(await rawText(diff.old.resource.url)).toBe(before);
      expect(await rawText(diff.new.resource.url)).toBe(after);
      const head = await handle(
        new Request(`http://localhost${diff.new.resource.url}`, { method: "HEAD" }),
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(after)));
      expect(await head.text()).toBe("");
    }
    const file = parseFileReadResponse(
      (await (
        await handle(
          new Request(
            projectRequestUrl(`${base}/file?path=art.svg&source=worktree`, project.absolutePath),
          ),
        )
      ).json()) as unknown,
    );
    if (file.kind !== "media") throw new Error("Expected current image");
    expect(await rawText(file.resource.url)).toBe(current);
    expect(
      parseFileReadResponse(
        (await (
          await handle(
            new Request(
              projectRequestUrl(
                `${base}/file?path=exported.svg&source=worktree`,
                project.absolutePath,
              ),
            ),
          )
        ).json()) as unknown,
      ).kind,
    ).toBe("media");
    for (const [layer, path, expectedSide] of [
      ["staged", "deleted.svg", "old"],
      ["untracked", "untracked.svg", "new"],
    ] as const) {
      const url = new URL(projectRequestUrl(`${base}/diff`, project.absolutePath));
      url.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer,
        path,
        revision: status.revision,
        changeToken: status.changeToken,
      }).toString();
      const diff = parseDiffResponse(
        (await (
          await handle(new Request(projectRequestUrl(url, project.absolutePath)))
        ).json()) as unknown,
      );
      if (diff.kind !== "media") throw new Error(`Expected ${layer} media`);
      expect(diff[expectedSide].kind).toBe("ready");
      expect(diff[expectedSide === "old" ? "new" : "old"].kind).toBe("absent");
    }
    await symlink(join(rootPath, "outside.svg"), join(projectPath, "escape.svg"));
    const escapedRaw = new URL(`http://localhost${file.resource.url}`);
    escapedRaw.searchParams.set("path", "escape.svg");
    expect((await handle(new Request(escapedRaw))).status).toBe(404);
    const bad = new URL(`http://localhost${file.resource.url}`);
    bad.searchParams.set("path", "../outside.svg");
    expect((await handle(new Request(bad))).status).toBe(400);
    bad.searchParams.set("path", "art.svg");
    bad.searchParams.append("path", "art.svg");
    expect((await handle(new Request(bad))).status).toBe(400);
    await writeFile(join(projectPath, "art.svg"), "<svg>changed</svg>");
    expect((await handle(new Request(`http://localhost${file.resource.url}`))).status).toBe(409);
  });
});

test("audio ranges read the correct Git side and support seeking, HEAD, and stale versions", async () => {
  await withTempDirectory("git-review-audio-", async (rootPath) => {
    const projectPath = join(rootPath, "project");
    await mkdir(projectPath);
    git(projectPath, "init", "-q");
    const wav = (marker: number) => {
      const bytes = Buffer.alloc(48);
      bytes.write("RIFF", 0);
      bytes.writeUInt32LE(40, 4);
      bytes.write("WAVEfmt ", 8);
      bytes.writeUInt32LE(16, 16);
      bytes.writeUInt16LE(1, 20);
      bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(8000, 24);
      bytes.writeUInt32LE(16000, 28);
      bytes.writeUInt16LE(2, 32);
      bytes.writeUInt16LE(16, 34);
      bytes.write("data", 36);
      bytes.writeUInt32LE(4, 40);
      bytes.writeInt16LE(marker, 44);
      bytes.writeInt16LE(marker, 46);
      return bytes;
    };
    const old = wav(100);
    const staged = wav(200);
    const current = wav(300);
    await writeFile(join(projectPath, "sound.wav"), old);
    git(projectPath, "add", "sound.wav");
    git(projectPath, "commit", "-qm", "sound");
    await writeFile(join(projectPath, "sound.wav"), staged);
    git(projectPath, "add", "sound.wav");
    await writeFile(join(projectPath, "sound.wav"), current);
    const handle = createApiHandler(await approveRoot(rootPath));
    const opened = await handle(
      new Request(
        "http://localhost" + projectApiUrl("", (await approveRoot(rootPath)).realPath + "/project"),
      ),
    );
    const project = parseProjectResponse((await opened.json()) as unknown);
    const base = `http://localhost/api/project`;
    const status = parseStatusResponse(
      (await (
        await handle(new Request(projectRequestUrl(`${base}/status`, project.absolutePath)))
      ).json()) as unknown,
    );
    if (status.kind !== "git") throw new Error("Expected Git status");
    for (const [layer, before, after] of [
      ["staged", old, staged],
      ["unstaged", staged, current],
    ] as const) {
      const url = new URL(projectRequestUrl(`${base}/diff`, project.absolutePath));
      url.search = new URLSearchParams({
        projectPath: project.absolutePath,
        layer,
        path: "sound.wav",
        revision: status.revision,
        changeToken: status.changeToken,
      }).toString();
      const diff = parseDiffResponse(
        (await (
          await handle(new Request(projectRequestUrl(url, project.absolutePath)))
        ).json()) as unknown,
      );
      if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready")
        throw new Error(`Expected ${layer} audio sides`);
      for (const [side, expected] of [
        [diff.old, before],
        [diff.new, after],
      ] as const) {
        expect(side.resource.kind).toBe("audio");
        const raw = `http://localhost${side.resource.url}`;
        const full = await handle(new Request(raw));
        expect(full.status).toBe(200);
        expect(full.headers.get("accept-ranges")).toBe("bytes");
        expect(Buffer.from(await full.arrayBuffer())).toEqual(expected);
        const range = await handle(new Request(raw, { headers: { range: "bytes=44-45" } }));
        expect(range.status).toBe(206);
        expect(range.headers.get("content-range")).toBe("bytes 44-45/48");
        expect(Buffer.from(await range.arrayBuffer())).toEqual(expected.subarray(44, 46));
        const tail = await handle(new Request(raw, { headers: { range: "bytes=-2" } }));
        expect(Buffer.from(await tail.arrayBuffer())).toEqual(expected.subarray(46));
        const head = await handle(
          new Request(raw, { method: "HEAD", headers: { range: "bytes=0-3" } }),
        );
        expect(head.status).toBe(206);
        expect(head.headers.get("content-length")).toBe("4");
        expect(await head.text()).toBe("");
        const invalid = await handle(new Request(raw, { headers: { range: "bytes=99-100" } }));
        expect(invalid.status).toBe(416);
        expect(invalid.headers.get("content-range")).toBe("bytes */48");
      }
    }
    const file = parseFileReadResponse(
      (await (
        await handle(
          new Request(
            projectRequestUrl(`${base}/file?path=sound.wav&source=worktree`, project.absolutePath),
          ),
        )
      ).json()) as unknown,
    );
    if (file.kind !== "media") throw new Error("Expected audio in Files");
    expect(file.resource.kind).toBe("audio");
    const rawFileUrl = `http://localhost${file.resource.url}`;
    const rawFile = await handle(new Request(rawFileUrl));
    expect(rawFile.status).toBe(200);
    expect(Buffer.from(await rawFile.arrayBuffer())).toEqual(current);
    const fileRange = await handle(new Request(rawFileUrl, { headers: { range: "bytes=44-45" } }));
    expect(fileRange.status).toBe(206);
    expect(Buffer.from(await fileRange.arrayBuffer())).toEqual(current.subarray(44, 46));
    const fileHead = await handle(new Request(rawFileUrl, { method: "HEAD" }));
    expect(fileHead.status).toBe(200);
    expect(fileHead.headers.get("content-length")).toBe(String(current.length));
    expect(await fileHead.text()).toBe("");
    const invalidFileRange = await handle(
      new Request(rawFileUrl, { headers: { range: "bytes=99-100" } }),
    );
    expect(invalidFileRange.status).toBe(416);
    expect(invalidFileRange.headers.get("content-range")).toBe(`bytes */${current.length}`);
    await writeFile(join(projectPath, "sound.wav"), wav(400));
    expect((await handle(new Request(`http://localhost${file.resource.url}`))).status).toBe(409);
  });
});
