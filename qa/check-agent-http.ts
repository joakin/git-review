import { cp, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import {
  parseApiError,
  parseFileReadResponse,
  parseProjectResponse,
  parseRootResponse,
  parseStatusResponse,
} from "@git-review/shared/api";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchResponse,
} from "@git-review/shared/change-diff-batch";
import { parseFeedbackCheckResponse } from "@git-review/shared/feedback-check";
import { projectApiUrl } from "@git-review/shared/project-path";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";
import { withTempDirectory } from "./test-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
type ProbeRequest = { method?: string; headers?: Record<string, string>; body?: string };
async function browserFetch(page: Page, url: string, options: ProbeRequest = {}) {
  return page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, {
        ...options,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) throw new Error("Probe response is too large");
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: new TextDecoder().decode(bytes),
        byteLength: bytes.length,
      };
    },
    { url, options },
  );
}
async function rejected(page: Page, url: string, options: ProbeRequest = {}): Promise<void> {
  const result = await page.evaluate(
    async ({ url, options }) => {
      try {
        await fetch(url, { ...options, credentials: "omit", signal: AbortSignal.timeout(10_000) });
        return false;
      } catch (error: unknown) {
        return error instanceof TypeError;
      }
    },
    { url, options },
  );
  assert(result, "Browser unexpectedly received a rejected CORS response");
}

const built = Bun.spawnSync([process.execPath, "scripts/build-agent.ts"], {
  stdout: "pipe",
  stderr: "pipe",
});
assert(built.exitCode === 0, new TextDecoder().decode(built.stderr));
await withTempDirectory("git-review-agent-http-", async (temporary) => {
  const directory = await realpath(temporary);
  const artifact = join(directory, "agent");
  await cp(resolve("dist/agent"), artifact, { recursive: true });
  const root = join(directory, "fixture");
  const fixture = Bun.spawnSync(
    [process.execPath, "qa/prepare-feasibility-fixture.ts", "--root", root],
    { stdout: "pipe", stderr: "pipe" },
  );
  assert(fixture.exitCode === 0, new TextDecoder().decode(fixture.stderr));
  const frontend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        '<!doctype html><meta charset="utf-8"><title>Agent HTTP QA</title><body>Static cross-origin transport check</body>',
        { headers: { "content-type": "text/html", "cache-control": "no-store" } },
      ),
  });
  const frontendOrigin = frontend.url.origin;
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.startsWith("GIT_REVIEW_")) delete environment[key];
  const child = Bun.spawn([process.execPath, "agent.js", "--root", root, "--port", "0"], {
    cwd: artifact,
    env: {
      ...environment,
      GIT_REVIEW_ALLOWED_ORIGINS: JSON.stringify([frontendOrigin]),
      GIT_REVIEW_FFMPEG_PATH: join(directory, "missing-ffmpeg"),
      GIT_REVIEW_HANDY_PATH: join(directory, "missing-handy"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const timeout = setTimeout(() => child.kill(), 120_000);
  const reader = child.stdout.getReader();
  try {
    let output = "";
    let address: string | undefined;
    while (address === undefined) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Packaged agent did not start: ${await stderr}`);
      output += new TextDecoder().decode(chunk.value);
      assert(output.length < 65_536, "Excessive agent startup output");
      address = /git-review agent: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
    }
    const agent = new URL(address).origin;
    await withQaBrowser(async (browser) => {
      await withQaContext(browser, qaProfiles.desktop, async (context) => {
        const page = await context.newPage();
        await page.goto(frontend.url.href);
        assert(new URL(page.url()).origin !== agent, "Probe must use different origins");
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        let preflights = 0;
        cdp.on("Network.requestWillBeSent", (value: unknown) => {
          const request = expectRecord(
            expectRecord(value, "network event")["request"],
            "network request",
          );
          if (
            request["method"] === "OPTIONS" &&
            expectString(request["url"], "request URL").startsWith(agent + "/")
          )
            preflights++;
        });
        async function json(path: string, options: ProbeRequest = {}): Promise<unknown> {
          const response = await browserFetch(page, agent + path, options);
          assert(response.status === 200, `${path} failed: ${response.status} ${response.body}`);
          return JSON.parse(response.body) as unknown;
        }
        const handshake = parseAgentInfoResponse(await json("/api/info"));
        assert(
          handshake.kind === "compatible" &&
            handshake.info.capabilities.transcription.kind === "unavailable",
          "Information/capability handshake failed",
        );
        const project = parseRootResponse(await json("/api/roots")).path;
        assert(
          parseProjectResponse(await json(projectApiUrl("", project))).absolutePath === project,
          "Project lookup failed",
        );
        const status = parseStatusResponse(await json(projectApiUrl("/status", project)));
        assert(status.kind === "git", "Fixture has no Git status");
        const files = [{ layer: "unstaged", path: "review.txt", language: null }] as const;
        const batchBody = { revision: status.revision, changeToken: status.changeToken, files };
        const response = await browserFetch(page, agent + projectApiUrl("/diffs", project), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batchBody),
        });
        assert(response.status === 200, "JSON batch POST failed after preflight");
        const batch = parseChangeDiffBatchResponse(
          JSON.parse(response.body) as unknown,
          changeDiffBatchSource(project, status.revision, status.changeToken),
          files.map(changeDiffRequestKey),
        );
        assert(
          batch.kind === "ready" && batch.results[0]?.kind === "ready",
          "Diff batch body was not delivered",
        );
        const feedback = parseFeedbackCheckResponse(
          await json(projectApiUrl("/feedback/check", project), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              anchors: [
                {
                  kind: "file",
                  source: "worktree",
                  path: "review.txt",
                  line: 1,
                  sourceText: "git-review feasibility",
                  before: null,
                  after: "This file is read from the agent workspace.",
                },
              ],
            }),
          }),
          1,
        );
        assert(feedback.kind === "checked" && feedback.matches[0] === true, "Feedback POST failed");
        console.log(
          "Cross-origin browser: compatible information, canonical project reads and JSON batch/feedback POSTs passed",
        );

        const media = new Map<string, string>();
        for (const path of ["image.svg", "sound.wav", "clip.mp4"]) {
          const file = parseFileReadResponse(
            await json(projectApiUrl("/file", project, { path, source: "worktree" })),
          );
          assert(file.kind === "media", "Fixture media descriptor missing");
          media.set(path, agent + file.resource.url);
        }
        const audio = media.get("sound.wav");
        const video = media.get("clip.mp4");
        const image = media.get("image.svg");
        assert(
          audio !== undefined && video !== undefined && image !== undefined,
          "Missing media routes",
        );
        const head = await browserFetch(page, audio, { method: "HEAD" });
        assert(
          head.status === 200 && head.byteLength === 0 && head.headers["accept-ranges"] === "bytes",
          "Cross-origin media HEAD failed",
        );
        for (const range of ["bytes=0-63", "bytes=-64"]) {
          const response = await browserFetch(page, audio, { headers: { range } });
          assert(
            response.status === 206 &&
              response.byteLength === 64 &&
              response.headers["content-range"]?.startsWith("bytes ") === true &&
              response.headers["content-length"] === "64",
            "Ranged stream or exposed headers failed",
          );
        }
        const unsatisfiable = await browserFetch(page, audio, {
          headers: { range: "bytes=99999999-" },
        });
        assert(
          unsatisfiable.status === 416 &&
            unsatisfiable.headers["content-range"]?.startsWith("bytes */") === true,
          "Range error was hidden by CORS",
        );
        await page.evaluate(async (url) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          document.body.append(image);
          try {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Image timed out")), 10_000);
              image.onload = () => {
                clearTimeout(timeout);
                resolve();
              };
              image.onerror = () => {
                clearTimeout(timeout);
                reject(new Error("Image failed"));
              };
              image.src = url;
            });
            if (image.naturalWidth === 0) throw new Error("Image is empty");
          } finally {
            image.remove();
          }
        }, image);
        for (const [kind, url] of [
          ["audio", audio],
          ["video", video],
        ] as const) {
          await page.evaluate(
            async ({ kind, url }) => {
              const element = document.createElement(kind);
              element.crossOrigin = "anonymous";
              element.preload = "metadata";
              document.body.append(element);
              async function event(name: string, action: () => void): Promise<void> {
                await new Promise<void>((resolve, reject) => {
                  const timeout = setTimeout(() => finish(new Error(`${name} timed out`)), 15_000);
                  const success = () => finish();
                  const failure = () => finish(new Error(`${kind} failed`));
                  function finish(error?: Error) {
                    clearTimeout(timeout);
                    element.removeEventListener(name, success);
                    element.removeEventListener("error", failure);
                    if (error === undefined) resolve();
                    else reject(error);
                  }
                  element.addEventListener(name, success, { once: true });
                  element.addEventListener("error", failure, { once: true });
                  action();
                });
              }
              try {
                await event("loadedmetadata", () => {
                  element.src = url;
                  element.load();
                });
                if (!Number.isFinite(element.duration) || element.duration <= 0)
                  throw new Error("Missing media duration");
                const target = Math.min(element.duration / 2, 1);
                await event("seeked", () => {
                  element.currentTime = target;
                });
                if (Math.abs(element.currentTime - target) > 0.1)
                  throw new Error("Media seek failed");
              } finally {
                element.pause();
                element.removeAttribute("src");
                element.load();
                element.remove();
              }
            },
            { kind, url },
          );
        }
        console.log(
          "Cross-origin media: image display, audio/video metadata and seeking, HEAD, streamed prefix/suffix ranges and readable 416 headers passed",
        );

        for (const [path, options, status] of [
          [
            projectApiUrl("/diffs", project),
            { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
            400,
          ],
          [
            "/api/transcriptions",
            { method: "POST", headers: { "content-type": "audio/wav" }, body: "sample" },
            503,
          ],
          ["/api/unknown", {}, 404],
          [
            projectApiUrl("/file", project, { path: "../outside.txt", source: "worktree" }),
            {},
            400,
          ],
          ["/api/info?unexpected=1", {}, 400],
        ] satisfies Array<[string, ProbeRequest, number]>) {
          const response = await browserFetch(page, agent + path, options);
          assert(
            response.status === status &&
              parseApiError(JSON.parse(response.body) as unknown) !== null,
            "Allowed-origin error was hidden by CORS",
          );
        }
        await writeFile(join(root, "review.txt"), "Fixture changed during browser check\n");
        const stale = expectRecord(
          await json(projectApiUrl("/diffs", project), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(batchBody),
          }),
          "stale batch",
        );
        assert(stale["kind"] === "stale", "Stale result was not readable");
        await rejected(page, agent + "/api/roots", { method: "DELETE" });
        await rejected(page, agent + "/api/roots", { headers: { authorization: "not-supported" } });
        await rejected(page, agent + "/api/roots", {
          headers: { "x-unexpected": "not-supported" },
        });
        assert(preflights >= 4, "Browser did not issue real preflights");
        await page.goto(`http://localhost:${frontend.port}/`);
        await rejected(page, agent + "/api/info");
        console.log(
          "Cross-origin failures: 400/404/503/stale responses remain readable; unsupported methods/headers and unconfigured origin are blocked by the browser",
        );
        await cdp.detach();
      });
    });
  } finally {
    clearTimeout(timeout);
    child.kill();
    await child.exited;
    await reader.cancel();
    reader.releaseLock();
    await frontend.stop(true);
    assert((await stderr) === "", "Packaged agent logged unexpected errors");
  }
});
