import { mkdir, readFile, realpath, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApiHandler } from "../apps/agent/src/api.ts";
import { createApiHttpBoundary } from "../apps/agent/src/http.ts";
import { approveRoot } from "../apps/agent/src/paths.ts";
import { testGitText as git, withTempDirectory } from "./test-support.ts";
import {
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";
import { AgentStateFixture } from "./agent-state-fixture.ts";
import { checkAgentDataActivation } from "./check-agent-data-activation.ts";
import { checkAgentState } from "./check-agent-state-browser.ts";
import { checkSavedFeedback } from "./check-saved-feedback.ts";
import { checkHostManagement } from "./check-host-management.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const args = process.argv.slice(2);
const dataCheck = args[0] === "--data";
const recoveryCheck = args[0] === "--recovery";
const hostCheck = args[0] === "--hosts";
const stateCheck = args[0] === "--state" || dataCheck || recoveryCheck || hostCheck;
const captureArgs = stateCheck ? args.slice(1) : args;
const captureLabel =
  captureArgs.length === 2 && captureArgs[0] === "--capture" ? captureArgs[1] : undefined;
assert(
  captureArgs.length === 0 ||
    (captureLabel !== undefined && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(captureLabel)),
  "Usage: bun qa/check-agent-transport.ts [--state | --data | --recovery | --hosts] [--capture <new milestone>]",
);
await withTempDirectory("git-review-agent-transport-", async (temporary) => {
  const directory = await realpath(temporary);
  const fixture = join(directory, "project");
  const prepared = Bun.spawnSync(
    [process.execPath, "qa/prepare-feasibility-fixture.ts", "--root", fixture],
    { stdout: "pipe", stderr: "pipe" },
  );
  assert(prepared.exitCode === 0, new TextDecoder().decode(prepared.stderr));
  const initial = git(fixture, "rev-list", "--max-parents=0", "HEAD");
  const lines = Array.from(
    { length: 200 },
    (_, index) => `export const transportLine${index + 1} = ${index + 1};`,
  );
  await writeFile(join(fixture, "notes.ts"), lines.join("\n") + "\n");
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "Transport fixture");
  const stateCommit = git(fixture, "rev-parse", "HEAD");
  if (stateCheck) await symlink(".", join(fixture, "alias"));
  lines[99] = "export const transportLine100 = 101;";
  await writeFile(join(fixture, "notes.ts"), lines.join("\n") + "\n");
  await writeFile(
    join(fixture, "image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#246b56"/><text x="20" y="100" fill="white" font-size="24">Chosen agent image</text></svg>',
  );
  const files = new Map<string, { body: string | Blob; type: string }>();
  files.set("/", { body: await readFile("apps/web/src/index.html", "utf8"), type: "text/html" });
  for (const [route, path, type] of [
    ["/assets/styles.css", "dist/assets/styles.css", "text/css"],
    ["/assets/theme-bootstrap.js", "dist/assets/theme-bootstrap.js", "text/javascript"],
  ]) {
    assert(
      route !== undefined && path !== undefined && type !== undefined,
      "Missing static fixture path",
    );
    files.set(route, { body: new Blob([new Uint8Array(await readFile(path))]), type });
  }
  const frontend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const file = files.get(url.pathname);
      return file === undefined
        ? new Response("Static frontend has no API", { status: 404 })
        : new Response(file.body, {
            headers: { "content-type": file.type, "cache-control": "no-store" },
          });
    },
  });
  const requests: Array<{
    agent: string;
    method: string;
    path: string;
    cookie: string | null;
    range: string | null;
  }> = [];
  const root = await approveRoot(fixture);
  const stateFixture = stateCheck ? new AgentStateFixture() : null;
  function handler(agent: string, redirect: () => string) {
    const api = createApiHandler(root, null, [frontend.url.origin]);
    return createApiHttpBoundary(null, [frontend.url.origin], async (request) => {
      const path = new URL(request.url).pathname;
      requests.push({
        agent,
        method: request.method,
        path,
        cookie: request.headers.get("cookie"),
        range: request.headers.get("range"),
      });
      if (stateFixture?.agentUnavailable)
        return Response.json(
          { error: { code: "unavailable", message: "Controlled agent unavailable" } },
          { status: 503 },
        );
      if (path === "/api/transcriptions")
        return Response.json({ text: "Controlled transport transcript" });
      if (path === "/api/qa-redirect") return Response.redirect(redirect(), 302);
      const response = await api(request);
      return stateFixture === null ? response : stateFixture.decorate(agent, request, response);
    });
  }
  const b = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler("b", () => frontend.url.href),
  });
  const a = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler("a", () => b.url.origin + "/api/roots"),
  });
  try {
    const build = await Bun.build({
      entrypoints: [resolve("apps/web/src/main.tsx")],
      target: "browser",
      plugins: [
        {
          name: "chosen-agent-qa",
          setup(build) {
            build.onLoad({ filter: /apps\/web\/src\/main\.tsx$/ }, async ({ path }) => {
              const original = await readFile(path, "utf8");
              assert(
                original.includes("createPageAgentConnection()"),
                "Missing page bootstrap adapter",
              );
              return {
                loader: "tsx",
                contents:
                  `import ${JSON.stringify(resolve("qa/agent-transport-browser.ts"))};\n` +
                  original
                    .replace(
                      "import { createPageAgentConnection }",
                      "import { createAgentConnection }",
                    )
                    .replace(
                      "createPageAgentConnection()",
                      "createAgentConnection(__QA_AGENT_A__, { allowLoopbackHttp: true })",
                    )
                    .replace(
                      "connections={localAgentEnabled ? [legacyConnection] : []}",
                      hostCheck
                        ? "connections={[]}"
                        : stateCheck
                          ? "connections={[legacyConnection, createAgentConnection(__QA_AGENT_B__, { allowLoopbackHttp: true })]}"
                          : "connections={[legacyConnection]}",
                    ),
              };
            });
          },
        },
      ],
      jsx: { runtime: "automatic", importSource: "preact" },
      define: {
        __GIT_REVIEW_LOCAL_AGENT__: hostCheck ? "false" : "true",
        __QA_AGENT_A__: JSON.stringify(a.url.origin),
        __QA_AGENT_B__: JSON.stringify(b.url.origin),
        __QA_PROJECT__: JSON.stringify(root.realPath),
        __QA_COMMIT__: JSON.stringify(initial),
      },
    });
    const output = build.outputs[0];
    assert(build.success && output !== undefined, build.logs.join("\n"));
    files.set("/assets/main.js", { body: await output.text(), type: "text/javascript" });
    await withQaBrowser(async (browser) => {
      if (hostCheck && stateFixture !== null) {
        await checkHostManagement(
          browser,
          { frontend: frontend.url.origin, a: a.url.origin, b: b.url.origin },
          root.realPath,
          stateFixture,
          requests,
          captureLabel,
        );
        return;
      }
      if (recoveryCheck && stateFixture !== null)
        await checkSavedFeedback(
          browser,
          { frontend: frontend.url.origin, a: a.url.origin, b: b.url.origin },
          root.realPath,
          stateFixture,
          captureLabel,
        );
      if (dataCheck)
        await checkAgentDataActivation(
          browser,
          { frontend: frontend.url.origin, a: a.url.origin, b: b.url.origin },
          root.realPath,
          captureLabel,
        );
      await withQaContext(browser, qaProfiles.desktop, async (context) => {
        await context.addCookies([
          { url: a.url.origin, name: "transport-qa-cookie", value: "must-be-omitted" },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        await page.goto(frontend.url.href);
        await page.waitForFunction(() => window.agentTransportQa !== undefined);
        await page.evaluate(() => window.agentTransportQa.exercise());
        for (const agent of ["a", "b"]) {
          const paths = new Set(
            requests.filter((request) => request.agent === agent).map((request) => request.path),
          );
          for (const path of [
            "/api/info",
            "/api/roots",
            "/api/directories",
            "/api/project",
            "/api/languages",
            "/api/project/tree",
            "/api/project/file",
            "/api/project/search",
            "/api/project/status",
            "/api/project/diff",
            "/api/project/diffs",
            "/api/project/diff-context",
            "/api/project/feedback/check",
            "/api/project/git/refs",
            "/api/project/git/log",
            `/api/project/git/commits/${initial}`,
            `/api/project/git/commits/${initial}/diffs`,
            "/api/transcriptions",
            "/api/project/raw/file",
            "/api/project/raw/diff",
            "/api/project/raw/commit",
          ])
            assert(paths.has(path), `${agent} missed ${path}`);
        }
        assert(
          requests.every((request) => request.cookie === null),
          "Client API or media forwarded a cookie",
        );
        const before = requests.filter((request) => request.agent === "b").length;
        assert(
          await page.evaluate(() => window.agentTransportQa.rejectRedirect()),
          "Client followed an agent redirect",
        );
        assert(
          requests.filter((request) => request.agent === "b").length === before,
          "Redirect contacted another agent",
        );
        console.log(
          "Browser client APIs: every request family reaches its chosen agent; cookies are omitted and redirects cannot retarget work",
        );
        if (stateFixture !== null) {
          if (!dataCheck && !recoveryCheck)
            await checkAgentState(
              context,
              { frontend: frontend.url.origin, a: a.url.origin, b: b.url.origin },
              root.realPath,
              stateCommit,
              stateFixture,
            );
          const beforeUnknown = requests.length;
          await page.goto(
            frontend.url.origin +
              "/?" +
              new URLSearchParams({
                section: "files",
                project: root.realPath,
                file: "notes.ts",
                agent: "https://not-configured.example",
              }),
          );
          await page.getByRole("heading", { name: "Host connection needed" }).waitFor();
          assert(
            requests.length === beforeUnknown,
            "An unknown destination contacted a configured host",
          );
          await assertNoHorizontalOverflow(page);
          console.log("Unknown host destinations stay visible and make no agent requests");
          const recovery = page.waitForResponse(
            (response) =>
              new URL(response.url()).origin === a.url.origin &&
              new URL(response.url()).pathname === "/api/roots" &&
              response.ok(),
          );
          await page.getByRole("button", { name: "Hosts & saved reviews", exact: true }).click();
          await page
            .locator(".host-record")
            .first()
            .getByRole("button", { name: "Browse folders", exact: true })
            .click();
          await recovery;
          assert(
            new URL(page.url()).searchParams.get("agent") === a.url.origin,
            "Unknown-host recovery did not require the explicit configured-host action",
          );
        }
        await page.goto(frontend.url.origin + "/?section=files&project=&file=image.svg");
        const image = page.locator(".media-preview img");
        await image.waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLImageElement>(".media-preview img")?.naturalWidth === 320,
        );
        assert(
          new URL((await image.getAttribute("src")) ?? "").origin === a.url.origin,
          "Native image used the frontend or another agent",
        );
        assert(
          (await image.getAttribute("crossorigin")) === "anonymous",
          "Native image did not use anonymous CORS",
        );
        const raw = await page.locator(".media-preview a").getAttribute("href");
        assert(
          raw !== null && new URL(raw).origin === a.url.origin,
          "Raw link changed its chosen agent",
        );
        for (const [file, kind] of [
          ["sound.wav", "audio"],
          ["clip.mp4", "video"],
        ] as const) {
          await page.goto(frontend.url.origin + "/?section=files&project=&file=" + file);
          const media = page.locator(`.media-preview ${kind}`);
          await media.waitFor();
          await page.waitForFunction(
            (kind) =>
              (document.querySelector<HTMLMediaElement>(`.media-preview ${kind}`)?.readyState ??
                0) >= 1,
            kind,
          );
          assert(
            new URL((await media.getAttribute("src")) ?? "").origin === a.url.origin,
            "Native playback changed its agent",
          );
          assert(
            (await media.getAttribute("crossorigin")) === "anonymous",
            "Native playback did not use anonymous CORS",
          );
          await media.evaluate(async (element: HTMLMediaElement) => {
            const target = element.duration / 2;
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Seek timed out")), 10_000);
              element.addEventListener(
                "seeked",
                () => {
                  clearTimeout(timeout);
                  resolve();
                },
                { once: true },
              );
              element.currentTime = target;
            });
          });
        }
        await assertNoHorizontalOverflow(page);
        assert(
          requests.every((request) => request.cookie === null),
          "Native cross-origin media forwarded a cookie",
        );
        assert(
          requests.some(
            (request) => request.path === "/api/project/raw/file" && request.range !== null,
          ),
          "Native playback did not request a byte range",
        );
        console.log(
          "Real frontend on a static-only origin: file/image/raw links, anonymous audio/video metadata and seeking passed against a separate agent",
        );
      });
      if (stateCheck)
        await withQaContext(browser, qaProfiles.phone, async (context) => {
          const page = await context.newPage();
          const before = requests.length;
          await page.goto(
            frontend.url.origin +
              "/?" +
              new URLSearchParams({
                section: "files",
                project: root.realPath,
                file: "notes.ts",
                agent: "https://not-configured.example",
              }),
          );
          await page.getByRole("heading", { name: "Host connection needed" }).waitFor();
          assert(requests.length === before, "Phone unknown-host entry made an agent request");
          await assertNoHorizontalOverflow(page);
          const recovery = page.waitForResponse(
            (response) =>
              new URL(response.url()).origin === a.url.origin &&
              new URL(response.url()).pathname === "/api/roots" &&
              response.ok(),
          );
          await page.getByRole("button", { name: "Hosts & saved reviews", exact: true }).tap();
          await page
            .locator(".host-record")
            .first()
            .getByRole("button", { name: "Browse folders", exact: true })
            .tap();
          await recovery;
          await assertNoHorizontalOverflow(page);
          console.log(
            "Phone emulation: unknown-host layout and explicit configured-host recovery tap passed",
          );
        });
    });
    if (captureLabel !== undefined && !dataCheck && !recoveryCheck && !hostCheck) {
      const capture = Bun.spawn(
        [
          process.execPath,
          "run",
          "qa:capture",
          "--url",
          stateCheck
            ? frontend.url.origin +
              "/?" +
              new URLSearchParams({
                section: "files",
                project: root.realPath,
                file: "notes.ts",
                agent: "https://not-configured.example",
              })
            : frontend.url.origin + "/?section=files&project=&file=image.svg",
          "--label",
          captureLabel,
          "--ready",
          stateCheck ? ".connection-required h1" : ".media-preview img",
        ],
        { stdout: "inherit", stderr: "inherit" },
      );
      assert((await capture.exited) === 0, "Responsive transport capture failed");
    }
    await mkdir("qa/.artifacts", { recursive: true });
    await writeFile(
      "qa/.artifacts/agent-transport-requests.json",
      JSON.stringify(requests, null, 2),
    );
  } finally {
    stateFixture?.releaseAll();
    await a.stop(true);
    await b.stop(true);
    await frontend.stop(true);
  }
});
