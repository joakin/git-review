import { isProjectPath } from "@git-review/shared/project-path";
import { isRecord } from "@git-review/shared/validation";
import { normalizeAgentEndpoint } from "./agent-connection.ts";
import { isNavigationPath } from "./navigation-path.ts";
import type { ProjectReference } from "./agent-project.ts";

export const agentActiveProjectKey = "git-review:agents:v1:active-project";
export type AgentTabSelection = ProjectReference & { version: 1 } & (
    { kind: "canonical" } | { kind: "scoped"; rootPath: string; relativePath: string }
  );
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseAgentTabSelection(value: unknown): AgentTabSelection | null {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !isProjectPath(value["projectPath"]) ||
    (value["kind"] !== "canonical" && value["kind"] !== "scoped" && value["kind"] !== undefined)
  )
    return null;
  try {
    const endpoint = normalizeAgentEndpoint(value["endpoint"], true);
    if (value["kind"] === "canonical" && ("rootPath" in value || "relativePath" in value))
      return null;
    if (value["kind"] === "canonical")
      return { version: 1, kind: "canonical", endpoint, projectPath: value["projectPath"] };
    if (!isProjectPath(value["rootPath"]) || !isNavigationPath(value["relativePath"], true))
      return null;
    const rootPath = value["rootPath"];
    const relativePath = value["relativePath"];
    const projectPath =
      relativePath === "" ? rootPath : (rootPath === "/" ? "" : rootPath) + "/" + relativePath;
    return projectPath !== value["projectPath"]
      ? null
      : { version: 1, kind: "scoped", endpoint, rootPath, relativePath, projectPath };
  } catch {
    return null;
  }
}

export function readAgentTabSelection(storage: TabStorage): AgentTabSelection | null {
  try {
    const raw = storage.getItem(agentActiveProjectKey);
    return raw === null ? null : parseAgentTabSelection(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveAgentTabSelection(storage: TabStorage, value: AgentTabSelection | null): void {
  if (value === null) storage.removeItem(agentActiveProjectKey);
  else {
    const parsed = parseAgentTabSelection(value);
    if (parsed === null) throw new Error("Invalid tab project selection.");
    storage.setItem(agentActiveProjectKey, JSON.stringify(parsed));
  }
}
