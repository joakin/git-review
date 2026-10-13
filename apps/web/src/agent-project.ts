import type { Project } from "@git-review/shared/api";

export type AgentProject = Project & { endpoint: string };
export type ProjectReference = { endpoint: string; projectPath: string };
export function projectResourceKey(
  reference: ProjectReference,
  ...resource: readonly unknown[]
): string {
  return JSON.stringify([reference.endpoint, reference.projectPath, ...resource]);
}
