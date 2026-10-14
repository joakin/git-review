import { isValidUrlEncoding } from "@git-review/shared/validation";
import { normalizeAgentEndpoint } from "./agent-connection.ts";
import { appBasePath } from "./deployment.ts";
import { parseNavigationSearch, routeUrl, type Route } from "./navigation.ts";

export type AgentDestination =
  { kind: "legacy"; route: Route } | { kind: "agent"; endpoint: string; route: Route };
export type AgentDestinationState =
  | { kind: "empty" }
  | { kind: "hosts" }
  | { kind: "prefill"; endpoint: string }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; destination: AgentDestination };

export function parseAgentDestination(
  search: string,
  legacyEndpoint: string | null = null,
): AgentDestinationState {
  const invalid = {
    kind: "invalid" as const,
    message: "This link has invalid navigation information. Choose a project to continue.",
  };
  if (search.length > 32_768 || !isValidUrlEncoding(search)) return invalid;
  const params = new URLSearchParams(search);
  if (params.size === 1 && params.get("section") === "hosts") return { kind: "hosts" };
  if (params.has("connect")) {
    if (params.size !== 1) return invalid;
    try {
      return { kind: "prefill", endpoint: normalizeAgentEndpoint(params.get("connect"), true) };
    } catch {
      return invalid;
    }
  }
  const agents = params.getAll("agent");
  if (agents.length > 1) return invalid;
  const address = agents[0];
  if (address === undefined) {
    const state = parseNavigationSearch(search);
    return state.kind === "ready"
      ? { kind: "ready", destination: { kind: "legacy", route: state.route } }
      : state;
  }
  let endpoint: string;
  try {
    // A legacy HTTP origin is allowed only when explicitly configured by the composition.
    endpoint =
      legacyEndpoint !== null && (address === legacyEndpoint || address === legacyEndpoint + "/")
        ? legacyEndpoint
        : normalizeAgentEndpoint(address, true);
  } catch {
    return invalid;
  }
  params.delete("agent");
  const state = parseNavigationSearch("?" + params.toString(), true);
  return state.kind === "ready"
    ? { kind: "ready", destination: { kind: "agent", endpoint, route: state.route } }
    : invalid;
}

export function agentDestinationUrl(destination: AgentDestination, basePath = appBasePath): string {
  const relative = routeUrl(destination.route, basePath);
  if (destination.kind === "legacy") return relative;
  const params = new URLSearchParams(relative.slice(basePath.length + 1));
  params.set("agent", destination.endpoint);
  return `${basePath}?${params.toString()}`;
}

export function destinationEndpoint(state: AgentDestinationState, legacyEndpoint: string): string {
  return state.kind === "ready" && state.destination.kind === "agent"
    ? state.destination.endpoint
    : legacyEndpoint;
}
