import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDiffResponse, parseFileReadResponse, parseFileTreeResponse, parseLanguagesResponse, parseProjectResponse, parseStatusResponse } from "../shared/api.ts";
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

test("file API requires an opened project and serves non-Git working-tree files", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "git-review-file-api-"));
  try {
    await mkdir(join(rootPath, "notes"));
    await writeFile(join(rootPath, "notes", "idea.ts"), "export const idea = 1;\n");
    const handle = createApiHandler(await approveRoot(rootPath));
    const unknown = await handle(new Request("http://localhost/api/projects/aaaaaaaaaaaaaaaaaaaa/tree?path="));
    expect(unknown.status).toBe(404);
    const opened = await handle(new Request("http://localhost/api/projects/open", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "notes" }),
    }));
    const project = parseProjectResponse(await opened.json() as unknown);
    const base = `http://localhost/api/projects/${project.id}`;
    const tree = parseFileTreeResponse(await (await handle(new Request(`${base}/tree?path=`))).json() as unknown);
    expect(tree.entries).toEqual([{ name: "idea.ts", path: "idea.ts", kind: "file" }]);
    expect((await handle(new Request(`${base}/file?path=idea.ts`))).status).toBe(400);
    const file = parseFileReadResponse(await (await handle(new Request(`${base}/file?path=idea.ts&source=worktree`))).json() as unknown);
    expect(file.kind).toBe("text");
    expect((await handle(new Request(`${base}/tree?path=..`))).status).toBe(400);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("image previews keep HEAD, index, and working-tree versions separate and gate raw access", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "git-review-images-"));
  try {
    const projectPath = join(rootPath, "project");
    await mkdir(projectPath);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: projectPath, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.name", "Review Test");
    git("config", "user.email", "review@example.test");
    const old = '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>';
    const staged = '<svg xmlns="http://www.w3.org/2000/svg"><text>staged</text></svg>';
    const current = '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.attack()</script><text>current</text></svg>';
    await writeFile(join(projectPath, "art.svg"), old);
    await writeFile(join(projectPath, "deleted.svg"), old);
    git("add", "art.svg", "deleted.svg");
    git("commit", "-qm", "image");
    await writeFile(join(projectPath, "art.svg"), staged);
    git("add", "art.svg");
    await writeFile(join(projectPath, "art.svg"), current);
    git("rm", "-q", "deleted.svg");
    await writeFile(join(projectPath, "untracked.svg"), current);
    await writeFile(join(projectPath, "exported.svg"), '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>');
    const handle = createApiHandler(await approveRoot(rootPath));
    const opened = await handle(new Request("http://localhost/api/projects/open", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "project" }),
    }));
    const project = parseProjectResponse(await opened.json() as unknown);
    const base = `http://localhost/api/projects/${project.id}`;
    const status = parseStatusResponse(await (await handle(new Request(`${base}/status`))).json() as unknown);
    if (status.kind !== "git") throw new Error("Expected Git status");
    const rawText = async (url: string) => {
      const response = await handle(new Request(`http://localhost${url}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      return response.text();
    };
    for (const [layer, before, after] of [["staged", old, staged], ["unstaged", staged, current]] as const) {
      const url = new URL(`${base}/diff`);
      url.search = new URLSearchParams({ layer, path: "art.svg", revision: status.revision }).toString();
      const diff = parseDiffResponse(await (await handle(new Request(url))).json() as unknown);
      if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready") throw new Error(`Expected ${layer} image sides`);
      expect(await rawText(diff.old.resource.url)).toBe(before);
      expect(await rawText(diff.new.resource.url)).toBe(after);
      const head = await handle(new Request(`http://localhost${diff.new.resource.url}`, { method: "HEAD" }));
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(after)));
      expect(await head.text()).toBe("");
    }
    const file = parseFileReadResponse(await (await handle(new Request(`${base}/file?path=art.svg&source=worktree`))).json() as unknown);
    if (file.kind !== "media") throw new Error("Expected current image");
    expect(await rawText(file.resource.url)).toBe(current);
    expect(parseFileReadResponse(await (await handle(new Request(`${base}/file?path=exported.svg&source=worktree`))).json() as unknown).kind).toBe("media");
    for (const [layer, path, expectedSide] of [["staged", "deleted.svg", "old"], ["untracked", "untracked.svg", "new"]] as const) {
      const url = new URL(`${base}/diff`);
      url.search = new URLSearchParams({ layer, path, revision: status.revision }).toString();
      const diff = parseDiffResponse(await (await handle(new Request(url))).json() as unknown);
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
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("audio ranges read the correct Git side and support seeking, HEAD, and stale versions", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "git-review-audio-"));
  try {
    const projectPath = join(rootPath, "project");
    await mkdir(projectPath);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: projectPath, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.name", "Review Test");
    git("config", "user.email", "review@example.test");
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
    git("add", "sound.wav");
    git("commit", "-qm", "sound");
    await writeFile(join(projectPath, "sound.wav"), staged);
    git("add", "sound.wav");
    await writeFile(join(projectPath, "sound.wav"), current);
    const handle = createApiHandler(await approveRoot(rootPath));
    const opened = await handle(new Request("http://localhost/api/projects/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "project" }) }));
    const project = parseProjectResponse(await opened.json() as unknown);
    const base = `http://localhost/api/projects/${project.id}`;
    const status = parseStatusResponse(await (await handle(new Request(`${base}/status`))).json() as unknown);
    if (status.kind !== "git") throw new Error("Expected Git status");
    for (const [layer, before, after] of [["staged", old, staged], ["unstaged", staged, current]] as const) {
      const url = new URL(`${base}/diff`);
      url.search = new URLSearchParams({ layer, path: "sound.wav", revision: status.revision }).toString();
      const diff = parseDiffResponse(await (await handle(new Request(url))).json() as unknown);
      if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready") throw new Error(`Expected ${layer} audio sides`);
      for (const [side, expected] of [[diff.old, before], [diff.new, after]] as const) {
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
        const head = await handle(new Request(raw, { method: "HEAD", headers: { range: "bytes=0-3" } }));
        expect(head.status).toBe(206);
        expect(head.headers.get("content-length")).toBe("4");
        expect(await head.text()).toBe("");
        const invalid = await handle(new Request(raw, { headers: { range: "bytes=99-100" } }));
        expect(invalid.status).toBe(416);
        expect(invalid.headers.get("content-range")).toBe("bytes */48");
      }
    }
    const file = parseFileReadResponse(await (await handle(new Request(`${base}/file?path=sound.wav&source=worktree`))).json() as unknown);
    if (file.kind !== "media") throw new Error("Expected audio in Files");
    expect(file.resource.kind).toBe("audio");
    await writeFile(join(projectPath, "sound.wav"), wav(400));
    expect((await handle(new Request(`http://localhost${file.resource.url}`))).status).toBe(409);
  } finally { await rm(rootPath, { recursive: true, force: true }); }
});
