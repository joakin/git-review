import { isValidUrlEncoding } from "@git-review/shared/validation";

type RequestOptions = Omit<RequestInit, "credentials" | "redirect">;
type AgentFetcher = (url: string, options: RequestInit) => Promise<Response>;
export type AgentConnection = {
  readonly endpoint: string;
  readonly request: (route: string, options?: RequestOptions) => Promise<Response>;
  readonly url: (route: string) => string;
};

export function normalizeAgentEndpoint(value: unknown, allowLoopbackHttp = false): string {
  const message = "Use an HTTPS agent origin without credentials, a path, query or fragment";
  if (typeof value !== "string" || value.length > 2048) throw new Error(message);
  const input = value.trim();
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(input)) throw new Error(message);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(message);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(allowLoopbackHttp && url.protocol === "http:" && loopback)) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(message);
  return url.origin;
}

function connection(endpoint: string, fetchRequest: AgentFetcher): AgentConnection {
  function url(route: string): string {
    if (
      route.length > 32_768 ||
      !route.startsWith("/api/") ||
      /[\x00-\x20\x7f\\#]/.test(route) ||
      !isValidUrlEncoding(route)
    )
      throw new Error("Expected an agent-relative API route");
    const target = new URL(route, endpoint);
    if (target.origin !== endpoint || target.pathname !== route.split("?", 1)[0])
      throw new Error("API route changes its agent or path");
    return target.href;
  }
  return Object.freeze({
    endpoint,
    url,
    async request(route: string, options: RequestOptions = {}) {
      const target = url(route);
      const response = await fetchRequest(target, {
        ...options,
        credentials: "omit",
        redirect: "error",
      });
      if (response.redirected || (response.url !== "" && response.url !== target)) {
        if (response.body !== null) await response.body.cancel().catch(() => undefined);
        throw new Error("The agent returned a response from a different address");
      }
      return response;
    },
  });
}

export function createAgentConnection(
  endpoint: unknown,
  options: { allowLoopbackHttp?: boolean; fetch?: AgentFetcher } = {},
): AgentConnection {
  return connection(
    normalizeAgentEndpoint(endpoint, options.allowLoopbackHttp ?? false),
    options.fetch ?? ((url, init) => fetch(url, init)),
  );
}

/** Temporary local composition: its agent is the actual page origin, including legacy HTTP. */
export function createPageAgentConnection(): AgentConnection {
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:")
    throw new Error("The local app needs an HTTP(S) page origin");
  return connection(window.location.origin, (url, init) => fetch(url, init));
}
