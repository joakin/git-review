import { expect, test } from "bun:test";
import { createAgentConnection } from "./agent-connection.ts";
import { checkHost } from "./host-check.ts";

const info = {
  application: "git-review",
  agentVersion: "0.1.0",
  protocolVersion: 1,
  readOnly: true,
  capabilities: {
    files: { kind: "available" },
    git: { kind: "available" },
    search: { kind: "available" },
    transcription: { kind: "unavailable", reason: "missing_handy" },
  },
};
test("host checks reject incompatible or malformed agents and perform only an anonymous information read", async () => {
  const seen: string[] = [];
  const connection = (body: unknown) =>
    createAgentConnection("https://agent.example", {
      fetch: async (url, options) => {
        seen.push(url);
        expect(options.credentials).toBe("omit");
        expect(options.redirect).toBe("error");
        return Response.json(body);
      },
    });
  expect((await checkHost(connection(info), new AbortController().signal)).kind).toBe("available");
  expect(
    (await checkHost(connection({ ...info, protocolVersion: 2 }), new AbortController().signal))
      .kind,
  ).toBe("incompatible");
  expect(
    (await checkHost(connection({ ...info, readOnly: false }), new AbortController().signal)).kind,
  ).toBe("unavailable");
  expect(seen).toEqual(Array.from({ length: 3 }, () => "https://agent.example/api/info"));
});
test("a canceled host check cannot publish a late compatible result", async () => {
  const controller = new AbortController();
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const connection = createAgentConnection("https://agent.example", {
    fetch: async () => {
      await waiting;
      return Response.json(info);
    },
  });
  const checked = checkHost(connection, controller.signal);
  controller.abort();
  release();
  await expect(checked).rejects.toThrow();
});
