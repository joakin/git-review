import { frontendOrigin } from "./config.ts";

type ApiMethod = "GET" | "HEAD" | "POST";
const readRoutes = new Set([
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
]);
const postRoutes = new Set([
  "/api/transcriptions",
  "/api/project/feedback/check",
  "/api/project/diff-context",
  "/api/project/diffs",
]);

function routeMethods(path: string): readonly ApiMethod[] | null {
  if (
    readRoutes.has(path) ||
    /^\/api\/project\/git\/(?:refs|log|commits\/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:\/diff)?)$/.test(
      path,
    )
  )
    return ["GET"];
  if (
    postRoutes.has(path) ||
    /^\/api\/project\/git\/commits\/(?:[0-9a-f]{40}|[0-9a-f]{64})\/diffs$/.test(path)
  )
    return ["POST"];
  if (/^\/api\/project\/raw\/(?:file|diff|commit)$/.test(path)) return ["GET", "HEAD"];
  return null;
}

function allowedHeaders(path: string, method: string): readonly string[] {
  const headers = ["accept", "accept-language", "content-language"];
  if (method === "POST") headers.push("content-type");
  if (path.startsWith("/api/project/raw/") && (method === "GET" || method === "HEAD"))
    headers.push("range");
  return headers;
}

function vary(headers: Headers, fields: readonly string[]): void {
  const existing = (headers.get("vary") ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (existing.includes("*")) return;
  for (const field of fields)
    if (!existing.some((value) => value.toLowerCase() === field.toLowerCase()))
      existing.push(field);
  headers.set("vary", existing.join(", "));
}

function error(status: number, code: "forbidden" | "invalid_request", message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** CORS never buffers delegated bodies or substitutes for private network access. */
export function createApiHttpBoundary(
  publicOrigin: string | null,
  origins: readonly string[],
  api: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const configured = new Set(origins.map(frontendOrigin));
  return async (request) => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const allowed =
      origin !== null &&
      (origin === url.origin || origin === publicOrigin || configured.has(origin));
    const methods = routeMethods(url.pathname);
    let cors = allowed;
    let response: Response;
    if (origin !== null && !allowed) {
      cors = false;
      response = error(403, "forbidden", "Cross-origin requests are not allowed");
    } else if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const raw = request.headers.get("access-control-request-headers");
      const requested =
        raw === null || raw.length > 512
          ? []
          : raw.split(",").map((name) => name.trim().toLowerCase());
      const permitted = method === null ? [] : allowedHeaders(url.pathname, method);
      if (
        !allowed ||
        methods === null ||
        !methods.some((value) => value === method) ||
        (raw?.length ?? 0) > 512 ||
        requested.length > permitted.length ||
        new Set(requested).size !== requested.length ||
        requested.some((name) => !permitted.includes(name))
      ) {
        cors = false;
        response = error(
          403,
          "forbidden",
          "Preflight method or headers are not allowed for this API route",
        );
      } else {
        response = new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": method ?? "",
            "access-control-allow-headers": permitted.join(", "),
            "access-control-max-age": "600",
            "cache-control": "no-store",
          },
        });
      }
    } else if (
      !["GET", "HEAD", "POST"].includes(request.method) ||
      (methods !== null && !methods.some((method) => method === request.method))
    ) {
      cors = false;
      response = error(405, "invalid_request", "Method is not allowed for this API route");
      if (methods !== null) response.headers.set("allow", methods.join(", "));
    } else {
      response = await api(request);
    }

    const headers = new Headers(response.headers);
    vary(
      headers,
      request.method === "OPTIONS"
        ? ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
        : ["Origin"],
    );
    headers.set("x-content-type-options", "nosniff");
    if (cors && origin !== null) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges");
    }
    if (request.method === "HEAD" && response.body !== null) await response.body.cancel();
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
