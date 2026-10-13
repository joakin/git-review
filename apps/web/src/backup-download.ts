import { serializeAgentBackup, type AgentBackup } from "./agent-data-format.ts";

export function downloadAgentBackup(backup: AgentBackup): void {
  const blob = new Blob([serializeAgentBackup(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "git-review-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
