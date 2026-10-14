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
import { appBasePath } from "./deployment.ts";
import { defaultAgentLabel } from "./agent-data-format.ts";
import { HostManager, HostsDialog } from "./HostManager.tsx";
import { InstallDataDialog } from "./InstallDataDialog.tsx";
import { useAppearancePreferences } from "./appearance-preferences.ts";
import { verifiedAgentConnection } from "./verified-agent-connection.ts";
import { agentCatalogStorageKey } from "./agent-data.ts";
import type { ProjectReference } from "./agent-project.ts";

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
  openHosts: () => void;
  openProject: (reference: ProjectReference) => void;
  hostLabel: string;
};

/** URL ownership and connection transitions live above endpoint-specific UI state. */
export function AgentApplication({
  legacyConnection,
  connections,
  localAgent = true,
}: {
  legacyConnection: AgentConnection;
  connections: readonly AgentConnection[];
  localAgent?: boolean;
}) {
  const [data] = useState(openBrowserData);
  const [temporaryReady, setTemporaryReady] = useState(false);
  const [hostsOpen, setHostsOpen] = useState(false);
  const [installDataOpen, setInstallDataOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const [clipboard] = useState(() =>
    createClipboardWriter(async (text) => {
      if (navigator.clipboard?.writeText === undefined)
        throw new Error(
          "Clipboard access is unavailable here. Select the feedback or history text to copy it manually.",
        );
      await navigator.clipboard.writeText(text);
    }),
  );
  const fixed = useMemo(
    () => (localAgent ? [legacyConnection, ...connections] : [...connections]),
    [localAgent, legacyConnection, connections],
  );
  const builtIn = useMemo(
    () =>
      fixed.map((connection) => ({
        endpoint: connection.endpoint,
        label: defaultAgentLabel(connection.endpoint),
      })),
    [fixed],
  );
  const [configured, setConfigured] = useState(() => {
    const result = new Map<string, ConfiguredAgent>();
    const remembered =
      data.startup.kind === "ready"
        ? data
            .readCatalog()
            .connections.map((record) =>
              createAgentConnection(record.endpoint, { allowLoopbackHttp: true }),
            )
        : [];
    for (const connection of [...fixed, ...remembered]) {
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
  const hub =
    state.kind === "hosts" ||
    state.kind === "prefill" ||
    (!localAgent && (state.kind === "empty" || state.kind === "invalid"));
  const selected = hub ? undefined : configured.get(endpoint);
  const active = useMemo(
    () =>
      selected === undefined
        ? null
        : createAgentLifetime(verifiedAgentConnection(selected.connection)),
    [selected, generation.current],
  );
  const activeRef = useRef(active);
  activeRef.current = active;
  const history = useNavigationHistory(() => prepare.current?.(), legacyConnection.endpoint);

  function accept(next: AgentDestinationState): void {
    prepare.current?.();
    if (
      next.kind === "hosts" ||
      next.kind === "prefill" ||
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

  function syncConnections(): void {
    try {
      const saved = data
        .readCatalog()
        .connections.map((record) =>
          createAgentConnection(record.endpoint, { allowLoopbackHttp: true }),
        );
      const next = new Map<string, ConfiguredAgent>();
      for (const connection of [...fixed, ...saved]) {
        if (next.has(connection.endpoint)) continue;
        next.set(
          connection.endpoint,
          configured.get(connection.endpoint) ?? {
            connection,
            state: data.projectState(connection.endpoint),
            positions: new Map(),
            gitRefs: new Map(),
          },
        );
      }
      if (activeRef.current !== null && !activeRef.current.signal.aborted && !next.has(endpoint)) {
        prepare.current?.();
        activeRef.current?.revoke();
        generation.current += 1;
      }
      setConfigured(next);
    } catch {
      // Existing connections remain usable; the host screen reports unreadable catalog data.
    }
  }
  function selectHost(endpoint: string, projectPath: string | null = null): void {
    const current = latest.current;
    const route: Route =
      projectPath !== null
        ? {
            section: "changes",
            projectPath,
            target: { kind: window.matchMedia("(max-width: 600px)").matches ? "list" : "all" },
          }
        : current.kind === "ready" &&
            current.destination.kind === "agent" &&
            current.destination.endpoint === endpoint &&
            !configured.has(endpoint)
          ? current.destination.route
          : { section: "projects", directory: "" };
    const next = {
      kind: "ready" as const,
      destination: { kind: "agent" as const, endpoint, route },
    };
    setHostsOpen(false);
    accept(next);
    history.write(agentDestinationUrl(next.destination), "push");
  }
  const hostProps = {
    prefill: state.kind === "prefill" ? state.endpoint : prefill,
    builtIn,
    onChanged: syncConnections,
    onConnect: (endpoint: string) => selectHost(endpoint),
    onReview: (reference: { endpoint: string; projectPath: string }) =>
      selectHost(reference.endpoint, reference.projectPath),
  };
  function openHosts(address = ""): void {
    setPrefill(address);
    setHostsOpen(true);
  }
  function openLocalData(): void {
    setHostsOpen(false);
    setInstallDataOpen(true);
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
    const sync = (event: StorageEvent) => {
      if (event.key === agentCatalogStorageKey || event.key === null) syncConnections();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [configured, endpoint]);
  useEffect(() => {
    if (state.kind !== "prefill") return;
    setPrefill(state.endpoint);
    accept({ kind: "hosts" });
    history.write(`${appBasePath}?section=hosts`, "replace");
  }, [state]);
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
              defaultEndpoint={localAgent ? legacyConnection.endpoint : ""}
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

  if (hub)
    return (
      <BrowserDataProvider data={data}>
        <NotificationProvider>
          <BrowserDataNotice />
          <HostHome
            {...hostProps}
            message={state.kind === "invalid" ? state.message : null}
            onInstallData={() => setInstallDataOpen(true)}
          />
          {installDataOpen && (
            <InstallDataDialog
              defaultEndpoint=""
              installPrompt={null}
              onInstallHandled={() => {}}
              onClose={() => setInstallDataOpen(false)}
            />
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
            onChooseHost={() => openHosts(endpoint)}
          />
          {hostsOpen && (
            <HostsDialog
              {...hostProps}
              onClose={() => setHostsOpen(false)}
              onLocalData={openLocalData}
            />
          )}
          {installDataOpen && (
            <InstallDataDialog
              defaultEndpoint={endpoint}
              installPrompt={null}
              onInstallHandled={() => {}}
              onClose={() => setInstallDataOpen(false)}
            />
          )}
        </NotificationProvider>
      </BrowserDataProvider>
    );
  const routeState: RouteState =
    state.kind === "ready"
      ? { kind: "ready", route: state.destination.route }
      : state.kind === "invalid"
        ? state
        : { kind: "empty" };
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
    openHosts: () => openHosts(),
    openProject: (reference) => selectHost(reference.endpoint, reference.projectPath),
    hostLabel: (() => {
      try {
        return (
          data.readCatalog().connections.find((record) => record.endpoint === endpoint)?.label ??
          defaultAgentLabel(endpoint)
        );
      } catch {
        return defaultAgentLabel(endpoint);
      }
    })(),
  };
  return (
    <BrowserDataProvider data={data}>
      <NotificationProvider key={JSON.stringify([endpoint, generation.current])}>
        <BrowserDataNotice />
        <AgentApiProvider lifetime={active} projectState={selected.state} clipboard={clipboard}>
          <App navigation={navigation} />
        </AgentApiProvider>
        {hostsOpen && (
          <HostsDialog
            {...hostProps}
            onClose={() => setHostsOpen(false)}
            onLocalData={openLocalData}
          />
        )}
        {installDataOpen && (
          <InstallDataDialog
            defaultEndpoint={endpoint}
            installPrompt={null}
            onInstallHandled={() => {}}
            onClose={() => setInstallDataOpen(false)}
          />
        )}
      </NotificationProvider>
    </BrowserDataProvider>
  );
}

function HostHome({
  message,
  onInstallData,
  ...props
}: Parameters<typeof HostManager>[0] & { message: string | null; onInstallData: () => void }) {
  useAppearancePreferences();
  return (
    <div class="app">
      <header class="topbar">
        <div class="brand" aria-label="git-review">
          <span class="brand-mark" aria-hidden="true">
            {"{ }"}
          </span>
          <span>
            git<span class="brand-accent">review</span>
          </span>
        </div>
      </header>
      <main class="hosts-home">
        <div class="hosts-home-head">
          <div>
            <p class="eyebrow">THIS DEVICE</p>
            <h1>Hosts & saved reviews</h1>
          </div>
          <button type="button" onClick={onInstallData}>
            Install & local data
          </button>
        </div>
        {message !== null && (
          <p role="alert" class="host-error">
            {message}
          </p>
        )}
        <HostManager {...props} />
      </main>
    </div>
  );
}
