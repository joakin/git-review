import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiffResponse, parseProjectResponse, parseStatusResponse } from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

const mediaCases = [
  { path: "art #?.svg", kind: "image", mime: "image/svg+xml", bytes: (label: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`) },
  // Minimal container signatures: these checks exercise source bytes, not decoder support.
  { path: "sound [1].wav", kind: "audio", mime: "audio/wav", bytes: (label: string) => Buffer.from(`RIFF____WAVE${label}`) },
  { path: "clip ñ.mp4", kind: "video", mime: "video/mp4", bytes: (label: string) => Buffer.from(`\0\0\0\x18ftypisom${label}`) },
] as const;

for (const format of ["sha1", "sha256"] as const) {
  for (const namesake of [true, false]) {
    test(`subfolder media stays scoped across Git layers (${format}, outside namesake: ${namesake})`, async () => {
      const repository = await mkdtemp(join(tmpdir(), "git-review-subfolder-media-"));
      const selected = join(repository, "inside space\nñ");
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
      try {
        await mkdir(selected);
        git("init", "-q", `--object-format=${format}`);
        git("config", "user.name", "Review Test");
        git("config", "user.email", "review@example.test");
        for (const media of mediaCases) {
          await writeFile(join(selected, media.path), media.bytes("HEAD inside"));
          if (namesake) await writeFile(join(repository, media.path), media.bytes("OUTSIDE approved root"));
        }
        git("add", ".");
        git("commit", "-qm", "media baseline");
        for (const media of mediaCases) await writeFile(join(selected, media.path), media.bytes("INDEX inside"));
        git("add", ".");
        for (const media of mediaCases) await writeFile(join(selected, media.path), media.bytes("WORKTREE inside"));

        // Only the subfolder is approved: repository-root namesakes are outside its scope.
        const handle = createApiHandler(await approveRoot(selected));
        const opened = await handle(new Request("http://localhost/api/projects/open", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "" }),
        }));
        expect(opened.status).toBe(200);
        const project = parseProjectResponse(await opened.json() as unknown);
        const base = `http://localhost/api/projects/${project.id}`;
        const status = parseStatusResponse(await (await handle(new Request(`${base}/status`))).json() as unknown);
        if (status.kind !== "git") throw new Error("Expected Git status");

        for (const media of mediaCases) {
          for (const [layer, before, after] of [["staged", "HEAD inside", "INDEX inside"], ["unstaged", "INDEX inside", "WORKTREE inside"]] as const) {
            const query = new URLSearchParams({ layer, path: media.path, revision: status.revision });
            const response = await handle(new Request(`${base}/diff?${query}`));
            expect(response.status).toBe(200);
            const diff = parseDiffResponse(await response.json() as unknown);
            if (diff.kind !== "media" || diff.old.kind !== "ready" || diff.new.kind !== "ready") throw new Error(`Expected ${layer} ${media.kind} sides`);
            for (const [side, label] of [[diff.old, before], [diff.new, after]] as const) {
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
                const range = await handle(new Request(rawUrl, { headers: { range: "bytes=12-15" } }));
                expect(range.status).toBe(206);
                expect(Buffer.from(await range.arrayBuffer())).toEqual(expected.subarray(12, 16));
              }
              if (namesake && layer === "staged" && side === diff.old) {
                const forged = new URL(rawUrl);
                const outsideOid = git("rev-parse", `HEAD:${media.path}`).toString("utf8").trim();
                forged.searchParams.set("version", outsideOid);
                expect((await handle(new Request(forged))).status).toBe(409);
              }
            }
          }
        }
      } finally {
        await rm(repository, { recursive: true, force: true });
      }
    });
  }
}

test("subfolder staged rename and deletion retain their scoped Old image", async () => {
  const repository = await mkdtemp(join(tmpdir(), "git-review-subfolder-renames-"));
  const selected = join(repository, "inside");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
  const renamed = mediaCases[0].bytes("renamed inside");
  const deleted = mediaCases[0].bytes("deleted inside");
  try {
    await mkdir(selected);
    git("init", "-q");
    git("config", "user.name", "Review Test");
    git("config", "user.email", "review@example.test");
    for (const [path, bytes] of [["old name.svg", renamed], ["deleted.svg", deleted]] as const) {
      await writeFile(join(selected, path), bytes);
      await writeFile(join(repository, path), mediaCases[0].bytes("OUTSIDE approved root"));
    }
    git("add", ".");
    git("commit", "-qm", "media baseline");
    git("mv", "inside/old name.svg", "inside/new name.svg");
    git("rm", "-q", "inside/deleted.svg");
    const handle = createApiHandler(await approveRoot(selected));
    const project = parseProjectResponse(await (await handle(new Request("http://localhost/api/projects/open", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "" }),
    }))).json() as unknown);
    const base = `http://localhost/api/projects/${project.id}`;
    const status = parseStatusResponse(await (await handle(new Request(`${base}/status`))).json() as unknown);
    if (status.kind !== "git") throw new Error("Expected Git status");
    expect(status.entries).toContainEqual({ layer: "staged", kind: "renamed", path: "new name.svg", oldPath: "old name.svg", isSubmodule: false });
    for (const [path, expected] of [["new name.svg", renamed], ["deleted.svg", deleted]] as const) {
      const query = new URLSearchParams({ layer: "staged", path, revision: status.revision });
      const diff = parseDiffResponse(await (await handle(new Request(`${base}/diff?${query}`))).json() as unknown);
      if (diff.kind !== "media" || diff.old.kind !== "ready") throw new Error("Expected scoped Old image");
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
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
