import { createContext, type ComponentChildren } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { createAgentApi, type AgentApi } from "./agent-api.ts";
import type { AgentConnection } from "./agent-connection.ts";

const context = createContext<AgentApi | null>(null);
export function AgentApiProvider({
  connection,
  children,
}: {
  connection: AgentConnection;
  children: ComponentChildren;
}) {
  const api = useMemo(() => createAgentApi(connection), [connection]);
  return <context.Provider value={api}>{children}</context.Provider>;
}
export function useAgentApi(): AgentApi {
  const api = useContext(context);
  if (api === null) throw new Error("Agent operations require an explicitly chosen connection");
  return api;
}
