import { expect, test } from "bun:test";
import { createApiHttpBoundary } from "./http.ts";

const frontend = "https://review.example";
const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers: { origin: frontend, ...init.headers },
  });
function preflight(path: string, method: string, names: string | null = "content-type"): Request {
  return request(path, {
    method: "OPTIONS",
    headers: {
      origin: frontend,
      "access-control-request-method": method,
      ...(names === null ? {} : { "access-control-request-headers": names }),
    },
  });
}

test("preflights cover every API family without dispatching work", async () => {
  let calls = 0;
  const handle = createApiHttpBoundary(null, [frontend], async () => {
    calls++;
    return Response.json({});
  });
  const oid = "a".repeat(40);
  const reads = [
    "/api/info",
    "/api/roots",
    "/api/languages",
    "/api/directories",
    "/api/project",
    "/api/project/tree",
    "/api/project/file",
    "/api/project/search",
    "/api/project/status",
    "/api/project/diff",
    "/api/project/git/refs",
    "/api/project/git/log",
    `/api/project/git/commits/${oid}`,
    `/api/project/git/commits/${oid}/diff`,
  ];
  const posts = [
    "/api/transcriptions",
    "/api/project/feedback/check",
    "/api/project/diff-context",
    "/api/project/diffs",
    `/api/project/git/commits/${oid}/diffs`,
  ];
  for (const path of reads) {
    const response = await handle(preflight(path, "GET", null));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe(frontend);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  }
  for (const path of posts) expect((await handle(preflight(path, "POST"))).status).toBe(204);
  for (const path of ["/api/project/raw/file", "/api/project/raw/diff", "/api/project/raw/commit"])
    for (const method of ["GET", "HEAD"])
      expect((await handle(preflight(path, method, "Range, Accept"))).status).toBe(204);
  expect(calls).toBe(0);
});

test("invalid origin/method/header preflights have no permissive headers and never dispatch", async () => {
  let calls = 0;
  const handle = createApiHttpBoundary(null, [frontend], async () => {
    calls++;
    return Response.json({});
  });
  const invalid = [
    preflight("/api/project/diffs", "DELETE"),
    preflight("/api/roots", "POST"),
    preflight("/api/project/diffs", "POST", "authorization"),
    preflight("/api/project/diffs", "POST", "content-type,"),
    preflight("/api/project/diffs", "POST", "Content-Type, content-type"),
    preflight("/api/project/diffs", "POST", "content-type;other"),
    preflight("/api/project/diffs", "POST", "x-".repeat(300)),
    preflight("/api/project/diffs", "POST", ""),
    preflight("/api/project/file", "GET", "range"),
    preflight("/api/unknown", "GET", null),
    request("/api/project/diffs", { method: "OPTIONS" }),
    new Request("http://127.0.0.1:3000/api/project/diffs", {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    }),
  ];
  for (const origin of [
    "null",
    `${frontend}.evil`,
    `${frontend}:8443`,
    "https://other.example",
    `${frontend}, https://other.example`,
  ])
    invalid.push(
      request("/api/project/diffs", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      }),
    );
  for (const req of invalid) {
    const response = await handle(req);
    expect(response.status).toBe(403);
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-allow-credentials",
    ])
      expect(response.headers.get(name)).toBeNull();
    expect(response.headers.get("vary")).toBe(
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    );
  }
  expect(calls).toBe(0);
});

test("all delegated statuses keep CORS and Vary while unsupported actual methods cannot dispatch", async () => {
  for (const status of [200, 206, 400, 403, 404, 409, 413, 415, 416, 429, 500, 503]) {
    const handle = createApiHttpBoundary(null, [frontend], async () =>
      Response.json({}, { status, headers: { vary: "Accept-Encoding, origin" } }),
    );
    const response = await handle(request("/api/roots"));
    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(frontend);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding, origin");
  }
  let calls = 0;
  const handle = createApiHttpBoundary(null, [frontend], async () => {
    calls++;
    return Response.json({});
  });
  for (const req of [
    request("/api/roots", { method: "DELETE" }),
    request("/api/roots", { method: "POST", body: "{}" }),
    request("/api/project/diffs", { method: "GET" }),
  ]) {
    const response = await handle(req);
    expect(response.status).toBe(405);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }
  expect(calls).toBe(0);
});

test("CORS preserves ranged stream ownership, cancellation, HEAD and existing cache headers", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull() {},
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const handle = createApiHttpBoundary(
    null,
    [frontend],
    async () =>
      new Response(body, {
        status: 206,
        headers: {
          "content-range": "bytes 0-3/100",
          "content-length": "4",
          "accept-ranges": "bytes",
          "cache-control": "no-store",
          vary: "Range",
        },
      }),
  );
  const response = await handle(request("/api/project/raw/file"));
  expect(response.body).toBe(body);
  expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
  expect(response.headers.get("content-length")).toBe("4");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Range, Origin");
  expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
  await response.body?.cancel();
  expect(cancelled).toBe(true);
  const head = await createApiHttpBoundary(null, [frontend], async () =>
    Response.json({ error: "stale" }, { status: 409 }),
  )(request("/api/project/raw/file", { method: "HEAD" }));
  expect(head.status).toBe(409);
  expect(head.body).toBeNull();
  expect(head.headers.get("access-control-allow-origin")).toBe(frontend);
});

test("no-Origin, local same-origin and HTTPS proxy access retain their boundaries", async () => {
  const handle = createApiHttpBoundary("https://private.ts.net", [], async () => Response.json({}));
  const absent = await handle(new Request("http://127.0.0.1:3000/api/roots"));
  expect(absent.status).toBe(200);
  expect(absent.headers.get("access-control-allow-origin")).toBeNull();
  for (const origin of ["http://127.0.0.1:3000", "https://private.ts.net"]) {
    const response = await handle(request("/api/roots", { headers: { origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  }
  const denied = await handle(request("/api/roots"));
  expect(denied.status).toBe(403);
  expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  expect(() => createApiHttpBoundary(null, ["*"], async () => Response.json({}))).toThrow();
});
