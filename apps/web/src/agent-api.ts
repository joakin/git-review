import type { AgentConnection } from "./agent-connection.ts";
import { createRepositoryApi } from "./api.ts";
import { createChangeDiffReader } from "./change-diff-api.ts";
import { createGitApi } from "./git-api.ts";
import { createDiffContextApi } from "./diff-context-api.ts";
import { createFeedbackSourceChecker } from "./feedback-check-api.ts";

export function createAgentApi(connection: AgentConnection) {
  const repository = createRepositoryApi(connection);
  return Object.freeze({
    connection,
    ...repository,
    ...createGitApi(connection),
    ...createDiffContextApi(connection),
    fetchChangeDiff: createChangeDiffReader(connection, repository),
    checkFeedbackSources: createFeedbackSourceChecker(connection),
  });
}
export type AgentApi = ReturnType<typeof createAgentApi>;
