import type { ProjectReference } from "./agent-project.ts";
import {
  formatFeedback,
  snapshotFeedback,
  type DraftComment,
  type CommentStore,
  type CheckedComments,
} from "./comments.ts";
import { parseAgentBackup, type AgentBackup } from "./agent-data-format.ts";
import { projectResourceKey } from "./agent-project.ts";

export function formatAgentFeedback(
  reference: ProjectReference,
  drafts: readonly DraftComment[],
  mode: "checked" | "recovery",
): string {
  const text = formatFeedback(reference.projectPath, drafts, mode);
  if (text === "") return "";
  return [
    `Agent: ${JSON.stringify(reference.endpoint)}`,
    ...(mode === "recovery"
      ? [
          "Saved feedback recovery — source freshness is unverified.",
          "Includes all saved drafts, including outdated comments. Quotes are captured source, not current fetched code.",
        ]
      : []),
    text,
  ].join("\n");
}

export function snapshotAgentFeedback(
  reference: ProjectReference,
  store: CommentStore,
  checked: CheckedComments,
) {
  if (reference.projectPath !== store.projectPath)
    throw new Error("Saved feedback belongs to a different project.");
  const snapshot = snapshotFeedback(reference.projectPath, store, checked);
  return { ...snapshot, text: formatAgentFeedback(reference, snapshot.drafts, "checked") };
}

export function projectReviewBackup(backup: AgentBackup, reference: ProjectReference): AgentBackup {
  const key = projectResourceKey(reference);
  const projects = backup.catalog.projects.filter((project) => projectResourceKey(project) === key);
  return parseAgentBackup({
    ...backup,
    catalog: {
      ...backup.catalog,
      connections: backup.catalog.connections.filter(
        (item) => item.endpoint === reference.endpoint,
      ),
      projects,
      workspaces: [],
    },
    reviews: backup.reviews.filter((review) => projectResourceKey(review.project) === key),
  });
}
