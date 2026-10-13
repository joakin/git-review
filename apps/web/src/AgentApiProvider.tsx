import { createContext, type ComponentChildren } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { createAgentApi, type AgentApi } from "./agent-api.ts";
import type { AgentLifetime } from "./agent-lifetime.ts";
import type { ProjectState } from "./project-state.ts";
import type { ClipboardWriter } from "./clipboard-writer.ts";

const context = createContext<AgentApi | null>(null);
const stateContext = createContext<ProjectState | null>(null);
const lifetimeContext = createContext<AgentLifetime | null>(null);
const clipboardContext = createContext<ClipboardWriter | null>(null);
export function AgentApiProvider({
  lifetime,
  children,
  projectState,
  clipboard,
}: {
  lifetime: AgentLifetime;
  children: ComponentChildren;
  projectState: ProjectState;
  clipboard: ClipboardWriter;
}) {
  const api = useMemo(() => createAgentApi(lifetime.connection), [lifetime]);
  return (
    <context.Provider value={api}>
      <stateContext.Provider value={projectState}>
        <lifetimeContext.Provider value={lifetime}>
          <clipboardContext.Provider value={clipboard}>{children}</clipboardContext.Provider>
        </lifetimeContext.Provider>
      </stateContext.Provider>
    </context.Provider>
  );
}
export function useClipboardWriter(): ClipboardWriter {
  const clipboard = useContext(clipboardContext);
  if (clipboard === null) throw new Error("Copies require an application clipboard owner");
  return clipboard;
}
export function useAgentLifetime(): AgentLifetime {
  const lifetime = useContext(lifetimeContext);
  if (lifetime === null) throw new Error("Agent work requires an explicitly chosen lifetime");
  return lifetime;
}
export function useProjectState(): ProjectState {
  const state = useContext(stateContext);
  if (state === null) throw new Error("Project state requires an explicitly chosen owner");
  return state;
}
export function useAgentApi(): AgentApi {
  const api = useContext(context);
  if (api === null) throw new Error("Agent operations require an explicitly chosen connection");
  return api;
}
