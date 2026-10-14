import type { AgentConnection } from "./agent-connection.ts";
import { createRepositoryApi } from "./api.ts";

/** One UI session shares a handshake; failed checks can retry without authorizing source reads. */
export function verifiedAgentConnection(connection: AgentConnection): AgentConnection {
  const api = createRepositoryApi(connection);
  let verified = false;
  let pending: Promise<void> | null = null;
  async function verify(signal: AbortSignal | null | undefined): Promise<void> {
    signal?.throwIfAborted();
    if (verified) return;
    if (pending === null) {
      const timeout = AbortSignal.timeout(10_000);
      const bounded =
        signal === null || signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
      pending = api.fetchAgentInfo(bounded).then((handshake) => {
        bounded.throwIfAborted();
        if (handshake.kind !== "compatible")
          throw new Error(
            `Agent protocol ${handshake.protocolVersion} is incompatible with this client.`,
          );
        verified = true;
      });
    }
    const attempt = pending;
    try {
      await attempt;
      signal?.throwIfAborted();
    } finally {
      if (pending === attempt) pending = null;
    }
  }
  return Object.freeze({
    endpoint: connection.endpoint,
    url: connection.url,
    async request(route, options = {}) {
      if (route !== "/api/info") await verify(options.signal);
      try {
        const response = await connection.request(route, options);
        if (response.status >= 500) verified = false;
        return response;
      } catch (error) {
        if (!options.signal?.aborted) verified = false;
        throw error;
      }
    },
  });
}
