import type { AgentConnection } from "./agent-connection.ts";

/** One active UI session; revocation also rejects late replies from non-cooperative fetchers. */
export function createAgentLifetime(connection: AgentConnection) {
  const controller = new AbortController();
  const bound: AgentConnection = Object.freeze({
    endpoint: connection.endpoint,
    url: connection.url,
    async request(route, options = {}) {
      controller.signal.throwIfAborted();
      const signal =
        options.signal === undefined || options.signal === null
          ? controller.signal
          : AbortSignal.any([controller.signal, options.signal]);
      signal.throwIfAborted();
      const response = await connection.request(route, { ...options, signal });
      if (signal.aborted) {
        await response.body?.cancel().catch(() => undefined);
        signal.throwIfAborted();
      }
      return response;
    },
  });
  return {
    connection: bound,
    revoke: () => controller.abort(),
    signal: controller.signal,
    createController(): AbortController {
      const local = new AbortController();
      return {
        signal: AbortSignal.any([controller.signal, local.signal]),
        abort: (reason?: unknown) => local.abort(reason),
      };
    },
  };
}
export type AgentLifetime = ReturnType<typeof createAgentLifetime>;
