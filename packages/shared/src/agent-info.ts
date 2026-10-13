import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";

export const agentProtocolVersion = 1;
export type TranscriptionCapability =
  | { kind: "available"; engine: "handy" }
  | { kind: "unverified"; reason: "model_not_verified" }
  | { kind: "unavailable"; reason: "missing_ffmpeg" | "missing_handy" };
export type AgentInfo = {
  application: "git-review";
  agentVersion: string;
  protocolVersion: typeof agentProtocolVersion;
  readOnly: true;
  capabilities: {
    files: { kind: "available" };
    git: { kind: "available" } | { kind: "unavailable"; reason: "missing_git" };
    search: { kind: "available" } | { kind: "unavailable"; reason: "missing_ripgrep" };
    transcription: TranscriptionCapability;
  };
};
export type AgentHandshake =
  | { kind: "compatible"; info: AgentInfo }
  | { kind: "incompatible"; agentVersion: string; protocolVersion: number };

function toolCapability<R extends "missing_git" | "missing_ripgrep">(
  value: unknown,
  reason: R,
): { kind: "available" } | { kind: "unavailable"; reason: R } {
  const record = expectRecord(value, "tool capability");
  if (record["kind"] === "available") return { kind: "available" };
  if (record["kind"] === "unavailable" && record["reason"] === reason)
    return { kind: "unavailable", reason };
  throw new Error("Invalid tool capability");
}

function transcriptionCapability(value: unknown): TranscriptionCapability {
  const record = expectRecord(value, "transcription capability");
  if (record["kind"] === "available" && record["engine"] === "handy")
    return { kind: "available", engine: "handy" };
  if (record["kind"] === "unverified" && record["reason"] === "model_not_verified")
    return { kind: "unverified", reason: "model_not_verified" };
  const reason = record["reason"];
  if (
    record["kind"] === "unavailable" &&
    (reason === "missing_ffmpeg" || reason === "missing_handy")
  )
    return { kind: "unavailable", reason };
  throw new Error("Invalid transcription capability");
}

/** Check compatibility before interpreting capabilities from a different protocol revision. */
export function parseAgentInfoResponse(value: unknown): AgentHandshake {
  const record = expectRecord(value, "agent information");
  if (record["application"] !== "git-review")
    throw new Error("This endpoint is not a git-review agent");
  const agentVersion = expectString(record["agentVersion"], "agent version");
  if (
    agentVersion.length === 0 ||
    agentVersion.length > 128 ||
    !/^[a-zA-Z0-9.+_-]+$/.test(agentVersion)
  )
    throw new Error("Invalid agent version");
  const protocolVersion = expectNonNegativeInteger(
    record["protocolVersion"],
    "agent protocol version",
  );
  if (protocolVersion === 0) throw new Error("Invalid agent protocol version");
  if (protocolVersion !== agentProtocolVersion)
    return { kind: "incompatible", agentVersion, protocolVersion };
  if (record["readOnly"] !== true) throw new Error("Expected a read-only agent");
  const capabilities = expectRecord(record["capabilities"], "agent capabilities");
  if (expectRecord(capabilities["files"], "file capability")["kind"] !== "available")
    throw new Error("Expected the file-read capability");
  return {
    kind: "compatible",
    info: {
      application: "git-review",
      agentVersion,
      protocolVersion,
      readOnly: true,
      capabilities: {
        files: { kind: "available" },
        git: toolCapability(capabilities["git"], "missing_git"),
        search: toolCapability(capabilities["search"], "missing_ripgrep"),
        transcription: transcriptionCapability(capabilities["transcription"]),
      },
    },
  };
}
