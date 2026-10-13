import { expect, test } from "bun:test";
import {
  agentDestinationUrl,
  destinationEndpoint,
  parseAgentDestination,
} from "./agent-navigation.ts";
import type { Route } from "./navigation.ts";

const endpoint = "https://agent.example";
const projectPath = "/work/odd #?% 雪";
test("agent destinations round trip canonical projects and preserve every navigation target and subpath", () => {
  const routes: Route[] = [
    { section: "projects", directory: "nested/root" },
    { section: "settings", projectPath },
    {
      section: "changes",
      projectPath,
      target: { kind: "file", layer: "unstaged", path: "odd β.ts" },
    },
    {
      section: "files",
      projectPath,
      directory: "src",
      target: { kind: "file", path: "src/a.ts", line: 42 },
    },
    {
      section: "search",
      projectPath,
      query: "literal",
      target: { kind: "file", path: "a.ts", line: 2 },
    },
    {
      section: "git",
      projectPath,
      ref: "refs/heads/main",
      target: { kind: "commit", oid: "a".repeat(40) },
    },
  ];
  for (const route of routes) {
    const destination = { kind: "agent" as const, endpoint, route };
    const url = agentDestinationUrl(destination, "/review/");
    expect(url.startsWith("/review/?")).toBe(true);
    expect(parseAgentDestination(url.slice("/review/".length))).toEqual({
      kind: "ready",
      destination,
    });
  }
  const normalized = parseAgentDestination(
    "?section=changes&project=%2Fwork&agent=HTTPS%3A%2F%2FAgent.EXAMPLE%3A443%2F",
  );
  expect(destinationEndpoint(normalized, "https://legacy.example")).toBe(endpoint);
});

test("old links stay explicitly legacy until their intended agent resolves them", () => {
  const state = parseAgentDestination("?section=files&project=repo&file=a.ts");
  expect(state.kind === "ready" && state.destination.kind).toBe("legacy");
  expect(destinationEndpoint(state, "https://legacy.example")).toBe("https://legacy.example");
  expect(parseAgentDestination("?section=changes&project=%2Fwork").kind).toBe("invalid");
  expect(parseAgentDestination("?section=changes&project=repo&agent=" + endpoint).kind).toBe(
    "invalid",
  );
  const oldHttp = "http://100.64.1.2:3000";
  const url = "?section=changes&project=%2Fwork&agent=" + encodeURIComponent(oldHttp);
  expect(parseAgentDestination(url).kind).toBe("invalid");
  expect(parseAgentDestination(url, oldHttp).kind).toBe("ready");
  expect(parseAgentDestination(url, "https://different.example").kind).toBe("invalid");
});

test("agent routes reject ambiguous ownership and malformed or relative project destinations", () => {
  for (const query of [
    "section=changes&project=repo",
    "section=changes&project=%2Fwork%2F..%2Fsecret",
    "section=changes&project=%2Fwork%2F",
    "section=changes&project=%2Fwork&agent=https://other.example",
    "section=changes&project=%2Fwork&extra=x",
    "section=changes&project=%ZZ",
  ])
    expect(parseAgentDestination("?" + query + "&agent=" + endpoint).kind).toBe("invalid");
  for (const address of [
    "",
    "https://user:secret@agent.example",
    "https://agent.example/api",
    "https://agent.example?x",
    "https://agent.example#fragment",
    "http://elsewhere.example",
  ])
    expect(
      parseAgentDestination("?section=projects&agent=" + encodeURIComponent(address)).kind,
    ).toBe("invalid");
  expect(parseAgentDestination("?" + "a".repeat(32_768)).kind).toBe("invalid");
});
