import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { AgentApiProvider } from "./AgentApiProvider.tsx";
import { createAgentConnection, type AgentConnection } from "./agent-connection.ts";
import { createAgentLifetime } from "./agent-lifetime.ts";
import {
  agentDestinationUrl,
  destinationEndpoint,
  parseAgentDestination,
  type AgentDestinationState,
} from "./agent-navigation.ts";
import { NotificationProvider } from "./Notifications.tsx";
import type { ProjectState } from "./project-state.ts";
import { openBrowserData } from "./browser-data.ts";
import { BrowserDataProvider, BrowserDataNotice } from "./BrowserDataProvider.tsx";
import { LegacyDataSetup } from "./LegacyDataSetup.tsx";
import { useNavigationHistory } from "./use-navigation-history.ts";
import type { Route, RouteState } from "./navigation.ts";
import { createClipboardWriter } from "./clipboard-writer.ts";
import { DisconnectedReview } from "./DisconnectedReview.tsx";
import { routeProjectPath } from "./navigation.ts";

type ConfiguredAgent = {
  connection: AgentConnection;
  state: ProjectState;
  positions: Map<string, number>;
  gitRefs: Map<string, string>;
};
export type AppNavigation = {
  state: RouteState;
  legacy: boolean;
  routeRef: { current: Route | null };
  url: (route: Route) => string;
  navigate: (route: Route, mode?: "push" | "replace") => void;
  canonicalize: (route: Route) => void;
  prepare: { current: (() => void) | null };
  history: ReturnType<typeof useNavigationHistory>;
  positions: Map<string, number>;
  gitRefs: Map<string, string>;
  ownsSession: () => boolean;
};

/** URL ownership and connection transitions live above endpoint-specific UI state. */
export function AgentApplication({
  legacyConnection,
  connections,
}: {
  legacyConnection: AgentConnection;
  connections: readonly AgentConnection[];
}) {
  const [data] = useState(openBrowserData);
  const [temporaryReady, setTemporaryReady] = useState(false);
  const [clipboard] = useState(() =>
    createClipboardWriter(async (text) => {
      if (navigator.clipboard?.writeText === undefined)
        throw new Error(
          "Clipboard access is unavailable here. Select the feedback or history text to copy it manually.",
        );
      await navigator.clipboard.writeText(text);
    }),
  );
  const [configured] = useState(() => {
    const result = new Map<string, ConfiguredAgent>();
    const remembered =
      data.startup.kind === "ready"
        ? data
            .readCatalog()
            .connections.map((record) =>
              createAgentConnection(record.endpoint, { allowLoopbackHttp: true }),
            )
        : [];
    for (const connection of [legacyConnection, ...connections, ...remembered]) {
      if (result.has(connection.endpoint)) continue;
      result.set(connection.endpoint, {
        connection,
        state: data.projectState(connection.endpoint),
        positions: new Map(),
        gitRefs: new Map(),
      });
    }
    return result;
  });
  const [state, setState] = useState<AgentDestinationState>(() => {
    const parsed = parseAgentDestination(window.location.search, legacyConnection.endpoint);
    const selected = data.startup.kind === "ready" ? data.readLastSelection() : null;
    return parsed.kind !== "empty" || selected === null
      ? parsed
      : {
          kind: "ready",
          destination: {
            kind: "agent",
            endpoint: selected.endpoint,
            route: {
              section: "changes",
              projectPath: selected.projectPath,
              target: { kind: window.matchMedia("(max-width: 600px)").matches ? "list" : "all" },
            },
          },
        };
  });
  const latest = useRef(state);
  const generation = useRef(0);
  const prepare = useRef<(() => void) | null>(null);
  const routeRef = useRef<Route | null>(state.kind === "ready" ? state.destination.route : null);
  const endpoint = destinationEndpoint(state, legacyConnection.endpoint);
  const selected = configured.get(endpoint);
  const active = useMemo(
    () => (selected === undefined ? null : createAgentLifetime(selected.connection)),
    [selected, generation.current],
  );
  const activeRef = useRef(active);
  activeRef.current = active;
  const history = useNavigationHistory(() => prepare.current?.(), legacyConnection.endpoint);

  function accept(next: AgentDestinationState): void {
    prepare.current?.();
    if (
      destinationEndpoint(next, legacyConnection.endpoint) !==
      destinationEndpoint(latest.current, legacyConnection.endpoint)
    ) {
      activeRef.current?.revoke();
      generation.current += 1;
    }
    latest.current = next;
    routeRef.current = next.kind === "ready" ? next.destination.route : null;
    setState(next);
  }

  function navigate(route: Route, mode: "push" | "replace" = "push"): void {
    if (!ownsSession()) return;
    const destination = { kind: "agent" as const, endpoint, route };
    accept({ kind: "ready", destination });
    history.write(agentDestinationUrl(destination), mode);
  }

  function canonicalize(route: Route): void {
    if (!ownsSession()) return;
    const destination = { kind: "agent" as const, endpoint, route };
    const next = { kind: "ready" as const, destination };
    latest.current = next;
    routeRef.current = route;
    history.write(agentDestinationUrl(destination), "replace");
    setState(next);
  }

  function ownsSession(): boolean {
    return (
      active !== null &&
      activeRef.current === active &&
      !active.signal.aborted &&
      destinationEndpoint(latest.current, legacyConnection.endpoint) === endpoint
    );
  }

  useLayoutEffect(() => () => active?.revoke(), [active]);
  useEffect(() => {
    window.history.scrollRestoration = "manual";
    const pop = () => {
      history.acceptCurrent();
      accept(parseAgentDestination(window.location.search, legacyConnection.endpoint));
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (state.kind !== "ready" || latest.current !== state) return;
    const url = agentDestinationUrl(state.destination);
    if (window.location.pathname + window.location.search !== url) history.write(url, "replace");
  }, [state]);

  if (!temporaryReady && data.startup.kind !== "ready")
    return (
      <BrowserDataProvider data={data}>
        <NotificationProvider>
          {data.startup.kind === "legacy" ? (
            <LegacyDataSetup
              data={data}
              snapshot={data.startup.snapshot}
              defaultEndpoint={legacyConnection.endpoint}
            />
          ) : (
            <main class="local-data-setup">
              <section class="install-data-content">
                <h1>Local review data unavailable</h1>
                <p>{data.startup.message}</p>
                <button type="button" onClick={() => window.location.reload()}>
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    data.continueTemporarily();
                    setTemporaryReady(true);
                  }}
                >
                  Continue with temporary reviews
                </button>
                <p>
                  Temporary reviews stay in this tab. Export them before closing or reloading.
                  Existing saved data is untouched.
                </p>
              </section>
            </main>
          )}
        </NotificationProvider>
      </BrowserDataProvider>
    );

  if (selected === undefined || active === null)
    return (
      <BrowserDataProvider data={data}>
        <NotificationProvider key={JSON.stringify([endpoint, generation.current])}>
          <BrowserDataNotice />
          <DisconnectedReview
            key={JSON.stringify([endpoint, state])}
            endpoint={endpoint}
            projectPath={state.kind === "ready" ? routeProjectPath(state.destination.route) : null}
            clipboard={clipboard}
            onChooseHost={() => {
              const destination = {
                kind: "agent" as const,
                endpoint: legacyConnection.endpoint,
                route: { section: "projects" as const, directory: "" },
              };
              accept({ kind: "ready", destination });
              history.write(agentDestinationUrl(destination), "push");
            }}
          />
        </NotificationProvider>
      </BrowserDataProvider>
    );
  const routeState: RouteState =
    state.kind === "ready" ? { kind: "ready", route: state.destination.route } : state;
  const navigation: AppNavigation = {
    state: routeState,
    legacy: state.kind !== "ready" || state.destination.kind === "legacy",
    routeRef,
    prepare,
    history,
    navigate,
    canonicalize,
    url: (route) => agentDestinationUrl({ kind: "agent", endpoint, route }),
    positions: selected.positions,
    gitRefs: selected.gitRefs,
    ownsSession,
  };
  return (
    <BrowserDataProvider data={data}>
      <NotificationProvider key={JSON.stringify([endpoint, generation.current])}>
        <BrowserDataNotice />
        <AgentApiProvider lifetime={active} projectState={selected.state} clipboard={clipboard}>
          <App navigation={navigation} />
        </AgentApiProvider>
      </NotificationProvider>
    </BrowserDataProvider>
  );
}
