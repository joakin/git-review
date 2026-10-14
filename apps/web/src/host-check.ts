import type { AgentInfo } from "@git-review/shared/agent-info";
import type { AgentConnection } from "./agent-connection.ts";
import { createRepositoryApi } from "./api.ts";

export type HostCheck =
  | { kind: "available"; info: AgentInfo }
  | { kind: "incompatible"; message: string }
  | { kind: "unavailable"; message: string };

/** A candidate check never creates a repository session or changes the selected destination. */
export async function checkHost(
  connection: AgentConnection,
  signal: AbortSignal,
): Promise<HostCheck> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  try {
    const result = await createRepositoryApi(connection).fetchAgentInfo(bounded);
    bounded.throwIfAborted();
    return result.kind === "compatible"
      ? { kind: "available", info: result.info }
      : {
          kind: "incompatible",
          message: `Agent protocol ${result.protocolVersion} is incompatible with this client.`,
        };
  } catch (error) {
    signal.throwIfAborted();
    return {
      kind: "unavailable",
      message: error instanceof Error ? error.message : "Could not reach this host.",
    };
  }
}
