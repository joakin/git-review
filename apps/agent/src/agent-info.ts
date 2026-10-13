import {
  agentProtocolVersion,
  type AgentInfo,
  type TranscriptionCapability,
} from "@git-review/shared/agent-info";
import { ripgrepExecutable } from "./search.ts";

declare const __GIT_REVIEW_AGENT_VERSION__: string;
const agentVersion =
  typeof __GIT_REVIEW_AGENT_VERSION__ === "undefined"
    ? "development"
    : __GIT_REVIEW_AGENT_VERSION__;

export function agentInfo(transcription: TranscriptionCapability): AgentInfo {
  let search: AgentInfo["capabilities"]["search"];
  try {
    ripgrepExecutable();
    search = { kind: "available" };
  } catch {
    search = { kind: "unavailable", reason: "missing_ripgrep" };
  }
  return {
    application: "git-review",
    protocolVersion: agentProtocolVersion,
    agentVersion,
    readOnly: true,
    capabilities: {
      files: { kind: "available" },
      git:
        Bun.which("git") === null
          ? { kind: "unavailable", reason: "missing_git" }
          : { kind: "available" },
      search,
      transcription,
    },
  };
}
