import { expect, test } from "bun:test";
import { agentProtocolVersion, parseAgentInfoResponse, type AgentInfo } from "./agent-info.ts";

function information(): AgentInfo {
  return {
    application: "git-review",
    agentVersion: "unreleased-123456abcdef-dirty",
    protocolVersion: agentProtocolVersion,
    readOnly: true,
    capabilities: {
      files: { kind: "available" },
      git: { kind: "available" },
      search: { kind: "unavailable", reason: "missing_ripgrep" },
      transcription: { kind: "unverified", reason: "model_not_verified" },
    },
  };
}

test("information validates compatible capabilities and keeps unsupported protocols explicit", () => {
  const info = information();
  expect(parseAgentInfoResponse(info)).toEqual({ kind: "compatible", info });
  expect(
    parseAgentInfoResponse({
      application: "git-review",
      agentVersion: "2.0.0",
      protocolVersion: agentProtocolVersion + 1,
      capabilities: "a different future schema",
    }),
  ).toEqual({
    kind: "incompatible",
    agentVersion: "2.0.0",
    protocolVersion: agentProtocolVersion + 1,
  });
  for (const transcription of [
    { kind: "unavailable", reason: "missing_ffmpeg" },
    { kind: "unavailable", reason: "missing_handy" },
    { kind: "available", engine: "handy" },
  ]) {
    expect(
      parseAgentInfoResponse({ ...info, capabilities: { ...info.capabilities, transcription } })
        .kind,
    ).toBe("compatible");
  }
});

test("information rejects malformed identity, unsafe protocol values and partial or invented capabilities", () => {
  const info = information();
  for (const value of [
    null,
    [],
    {},
    { ...info, application: "other-service" },
    { ...info, readOnly: false },
  ])
    expect(() => parseAgentInfoResponse(value)).toThrow();
  for (const agentVersion of [null, 1, "", "\nsecret", "a".repeat(129)])
    expect(() => parseAgentInfoResponse({ ...info, agentVersion })).toThrow();
  for (const protocolVersion of [null, "1", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => parseAgentInfoResponse({ ...info, protocolVersion })).toThrow();
  for (const capabilities of [
    null,
    {},
    { ...info.capabilities, files: { kind: "unavailable" } },
    { ...info.capabilities, git: { kind: "unavailable", reason: "maybe" } },
    { ...info.capabilities, search: true },
    { ...info.capabilities, transcription: { kind: "available" } },
    { ...info.capabilities, transcription: { kind: "available", engine: "unknown" } },
  ])
    expect(() => parseAgentInfoResponse({ ...info, capabilities })).toThrow();
});
