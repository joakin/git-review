import { projectResourceKey } from "./agent-project.ts";
import type { AgentBackup } from "./agent-data-format.ts";
import type { BrowserData } from "./browser-data.ts";

export function BackupSummary({ backup, data }: { backup: AgentBackup; data: BrowserData }) {
  let replacement: { drafts: number; history: number; projects: number } | null = null;
  let error: string | null = null;
  try {
    const incoming = new Set(backup.reviews.map((review) => projectResourceKey(review.project)));
    const matching = data
      .exportBackup()
      .reviews.filter((review) => incoming.has(projectResourceKey(review.project)));
    replacement = matching.reduce(
      (result, review) => ({
        drafts: result.drafts + review.comments.drafts.length,
        history: result.history + review.comments.history.length,
        projects: result.projects + 1,
      }),
      { drafts: 0, history: 0, projects: 0 },
    );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Existing local data could not be checked.";
  }
  const endpoints = [
    ...new Set([
      ...backup.catalog.connections.map((record) => record.endpoint),
      ...backup.catalog.projects.map((record) => record.endpoint),
    ]),
  ];
  const drafts = backup.reviews.reduce((count, review) => count + review.comments.drafts.length, 0);
  const history = backup.reviews.reduce(
    (count, review) => count + review.comments.history.length,
    0,
  );
  return (
    <>
      <p>
        Ready to save {backup.reviews.length} project review{backup.reviews.length === 1 ? "" : "s"}
        , {drafts} draft{drafts === 1 ? "" : "s"} and {history} history{" "}
        {history === 1 ? "entry" : "entries"}.
      </p>
      {endpoints.map((endpoint) => (
        <div class="backup-host" key={endpoint}>
          <p>{endpoint}</p>
          <ul>
            {backup.catalog.projects
              .filter((project) => project.endpoint === endpoint)
              .map((project) => (
                <li key={project.projectPath}>{project.projectPath}</li>
              ))}
          </ul>
        </div>
      ))}
      {replacement !== null && (
        <p>
          Matching local records will be replaced: {replacement.projects} project
          {replacement.projects === 1 ? "" : "s"}, {replacement.drafts} existing draft
          {replacement.drafts === 1 ? "" : "s"} and {replacement.history} history{" "}
          {replacement.history === 1 ? "entry" : "entries"}. Other projects remain here. Appearance,
          code typography and wrapping will use the backup's choices.
        </p>
      )}
      {error !== null && <p role="alert">{error}</p>}
    </>
  );
}
