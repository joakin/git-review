import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { createApiHandler } from "../src/server/api.ts";
import { approveRoot } from "../src/server/paths.ts";
import { parseFileReadResponse } from "../src/shared/api.ts";
import { projectApiUrl } from "../src/shared/project-path.ts";
import { withTempDirectory } from "../src/test-support.ts";
import { createProbeHandler, probeOrigin } from "./feasibility-http.ts";

const origin = "https://probe.example.test";
function request(path: string, options: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:39961${path}`, {
    ...options,
    headers: { origin, ...options.headers },
  });
}

test("probe configuration requires an exact HTTPS origin or explicit localhost QA", () => {
  expect(probeOrigin(origin)).toBe(origin);
  expect(probeOrigin("http://127.0.0.1:39962")).toBe("http://127.0.0.1:39962");
  for (const invalid of [
    "null",
    "http://probe.example.test",
    `${origin}/`,
    `${origin}/probe`,
    "https://user:secret@probe.example.test",
    "https://probe.example.test?query",
  ])
    expect(() => probeOrigin(invalid)).toThrow();
});

test("valid JSON preflight does not touch repository state and disallowed methods/headers fail", async () => {
  let calls = 0;
  const handle = createProbeHandler(origin, async () => {
    calls += 1;
    return Response.json({});
  });
  const preflight = (method: string, names: string) =>
    request("/api/project/feedback/check", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": method,
        "access-control-request-headers": names,
      },
    });
  const allowed = await handle(preflight("POST", "content-type"));
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
  expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
  expect((await handle(preflight("DELETE", "content-type"))).status).toBe(403);
  expect((await handle(preflight("POST", "authorization"))).status).toBe(403);
  expect((await handle(preflight("POST", "content-type,"))).status).toBe(403);
  expect(calls).toBe(0);
});

test("origin lookalikes and unrelated API routes never reach the delegated API", async () => {
  let calls = 0;
  const handle = createProbeHandler(origin, async () => {
    calls += 1;
    return Response.json({});
  });
  for (const untrusted of [
    "null",
    "https://probe.example.test.evil.test",
    "https://probe.example.test:8443",
  ])
    expect(
      (await handle(request("/api/roots", { headers: { origin: untrusted } }))).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
  expect((await handle(request("/api/transcriptions", { method: "POST" }))).status).toBe(404);
  expect(calls).toBe(0);
});

test("allowed-origin repository errors retain CORS while containment stays enforced", async () => {
  await withTempDirectory("git-review-feasibility-", async (directory) => {
    await writeFile(`${directory}/review.txt`, "A disposable source line\n");
    const root = await approveRoot(directory);
    const handle = createProbeHandler(origin, createApiHandler(root, origin));
    const valid = await handle(
      request(projectApiUrl("/file", root.realPath, { path: "review.txt", source: "worktree" })),
    );
    const body: unknown = await valid.json();
    expect(parseFileReadResponse(body).kind).toBe("text");
    const invalid = await handle(
      request(
        projectApiUrl("/file", root.realPath, { path: "../outside.txt", source: "worktree" }),
      ),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await invalid.json()).toHaveProperty("error.code");
    expect(invalid.headers.get("vary")).toContain("Origin");
  });
});

test("media HEAD and range responses preserve body semantics and expose diagnostic headers", async () => {
  const handle = createProbeHandler(
    origin,
    async (request) =>
      new Response(request.method === "HEAD" ? null : "test", {
        status: request.method === "HEAD" ? 200 : 206,
        headers: {
          "content-range": "bytes 0-3/100",
          "content-length": "4",
          "accept-ranges": "bytes",
        },
      }),
  );
  const range = await handle(
    request("/api/project/raw/file", { headers: { origin, range: "bytes=0-3" } }),
  );
  expect(range.status).toBe(206);
  expect(await range.text()).toBe("test");
  expect(range.headers.get("content-range")).toBe("bytes 0-3/100");
  expect(range.headers.get("access-control-expose-headers")).toContain("Content-Range");
  const head = await handle(request("/api/project/raw/file", { method: "HEAD" }));
  expect(head.status).toBe(200);
  expect(head.body).toBeNull();
});
