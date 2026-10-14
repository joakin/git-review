import { expect, test } from "bun:test";
import { createAgentConnection } from "./agent-connection.ts";
import { verifiedAgentConnection } from "./verified-agent-connection.ts";

const info = {
  application: "git-review",
  agentVersion: "test",
  protocolVersion: 1,
  readOnly: true,
  capabilities: {
    files: { kind: "available" },
    git: { kind: "available" },
    search: { kind: "available" },
    transcription: { kind: "unavailable", reason: "missing_handy" },
  },
};
test("concurrent session reads wait for one compatible handshake before any repository request", async () => {
  const paths: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const connection = verifiedAgentConnection(
    createAgentConnection("https://agent.example", {
      fetch: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === "/api/info") {
          await held;
          return Response.json(info);
        }
        return Response.json({});
      },
    }),
  );
  const root = connection.request("/api/roots");
  const project = connection.request("/api/project?project=%2Fwork");
  expect(paths).toEqual(["/api/info"]);
  release();
  await Promise.all([root, project]);
  expect(paths).toEqual(["/api/info", "/api/roots", "/api/project"]);
  await connection.request("/api/languages");
  expect(paths.filter((path) => path === "/api/info")).toHaveLength(1);
});
test("an incompatible session makes no repository reads and can retry a later compatible agent", async () => {
  let protocolVersion = 2;
  const paths: string[] = [];
  const connection = verifiedAgentConnection(
    createAgentConnection("https://agent.example", {
      fetch: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        return Response.json(path === "/api/info" ? { ...info, protocolVersion } : {});
      },
    }),
  );
  await expect(connection.request("/api/roots")).rejects.toThrow("incompatible");
  expect(paths).toEqual(["/api/info"]);
  protocolVersion = 1;
  await connection.request("/api/roots");
  expect(paths).toEqual(["/api/info", "/api/info", "/api/roots"]);
});
test("a canceled handshake cannot authorize later reads from a stale response", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths: string[] = [];
  const connection = verifiedAgentConnection(
    createAgentConnection("https://agent.example", {
      fetch: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        await held;
        return Response.json(info);
      },
    }),
  );
  const controller = new AbortController();
  const root = connection.request("/api/roots", { signal: controller.signal });
  controller.abort();
  release();
  await expect(root).rejects.toThrow();
  expect(paths).toEqual(["/api/info"]);
});
test("a server outage invalidates verification before a later repository retry", async () => {
  let protocolVersion = 1;
  let unavailable = false;
  const paths: string[] = [];
  const connection = verifiedAgentConnection(
    createAgentConnection("https://agent.example", {
      fetch: async (url) => {
        const path = new URL(url).pathname;
        paths.push(path);
        return path === "/api/info"
          ? Response.json({ ...info, protocolVersion })
          : Response.json({}, { status: unavailable ? 503 : 200 });
      },
    }),
  );
  await connection.request("/api/roots");
  unavailable = true;
  expect((await connection.request("/api/roots")).status).toBe(503);
  unavailable = false;
  protocolVersion = 2;
  await expect(connection.request("/api/project?project=%2Fwork")).rejects.toThrow("incompatible");
  expect(paths).toEqual(["/api/info", "/api/roots", "/api/roots", "/api/info"]);
});
