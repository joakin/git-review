/** Bounded experiment around the existing read-only API; not the production CORS boundary. */
export function probeOrigin(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    value !== url.origin ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error("--origin must be an exact HTTPS origin, or HTTP localhost for local QA");
  return url.origin;
}

const routes = new Map<string, readonly string[]>([
  ["/probe/health", ["GET"]],
  ["/api/roots", ["GET"]],
  ["/api/project", ["GET"]],
  ["/api/project/status", ["GET"]],
  ["/api/project/file", ["GET"]],
  ["/api/project/feedback/check", ["POST"]],
  ["/api/project/raw/file", ["GET", "HEAD"]],
]);

export function createProbeHandler(
  origin: string,
  api: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  probeOrigin(origin);
  const startedAt = new Date().toISOString();
  return async (request) => {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("origin");
    const allowed = requestOrigin === origin;
    const headers = new Headers({
      "cache-control": "no-store",
      vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      "x-content-type-options": "nosniff",
    });
    if (requestOrigin !== null && !allowed)
      return Response.json(
        { error: "Origin is not allowed by this probe" },
        { status: 403, headers },
      );
    if (allowed) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges");
    }
    const methods = routes.get(url.pathname);
    if (methods === undefined)
      return Response.json({ error: "Route is outside this probe" }, { status: 404, headers });
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const rawHeaders = request.headers.get("access-control-request-headers") ?? "";
      const requested =
        rawHeaders === ""
          ? []
          : rawHeaders
              .toLowerCase()
              .split(",")
              .map((part) => part.trim());
      if (
        !allowed ||
        method === null ||
        !methods.includes(method) ||
        rawHeaders.length > 256 ||
        requested.length > 2 ||
        requested.some((name) => name !== "content-type" && name !== "range")
      )
        return Response.json(
          { error: "Preflight is outside this probe" },
          { status: 403, headers },
        );
      headers.set("access-control-allow-methods", methods.join(", "));
      headers.set("access-control-allow-headers", "Content-Type, Range");
      return new Response(null, { status: 204, headers });
    }
    if (!methods.includes(request.method))
      return Response.json({ error: "Method is outside this probe" }, { status: 405, headers });
    if (request.method === "POST" && !allowed)
      return Response.json(
        { error: "POST requires the configured origin" },
        { status: 403, headers },
      );
    if (url.pathname === "/probe/health")
      return Response.json(
        { kind: "git-review-feasibility", startedAt, time: new Date().toISOString() },
        { headers },
      );
    const response = await api(request);
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  };
}
