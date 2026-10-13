import { createAgentDataRepository } from "../apps/web/src/agent-data.ts";
import { parseAgentBackupText, serializeAgentBackup } from "../apps/web/src/agent-data-format.ts";
import { projectResourceKey } from "../apps/web/src/agent-project.ts";

export type AgentDataQa = {
  open: () => ReturnType<typeof createAgentDataRepository>;
  parse: typeof parseAgentBackupText;
  serialize: typeof serializeAgentBackup;
};
declare global {
  interface Window {
    agentDataQa: AgentDataQa;
  }
}
// QA-only entry; the production application does not import the dormant foundation.
window.agentDataQa = {
  open: () => createAgentDataRepository(localStorage),
  parse: parseAgentBackupText,
  // Web Storage key enumeration is unordered. Keep draft/history/quote ordering and exact text.
  serialize: (backup) =>
    serializeAgentBackup({
      ...backup,
      reviews: [...backup.reviews].sort((left, right) =>
        projectResourceKey(left.project).localeCompare(projectResourceKey(right.project)),
      ),
    }),
};
