import { expect, test } from "bun:test";
import { createAgentConnection, normalizeAgentEndpoint } from "./agent-connection.ts";

test("agent addresses normalize origins and require explicit development HTTP", () => {
  expect(normalizeAgentEndpoint(" HTTPS://Agent.EXAMPLE:443/ ")).toBe("https://agent.example");
  expect(normalizeAgentEndpoint("https://agent.example:8443")).toBe("https://agent.example:8443");
  for (const address of [
    null,
    4,
    "",
    "agent.example",
    "https:agent.example",
    "https://user:secret@agent.example",
    "https://agent.example/api",
    "https://agent.example/./",
    "https://agent.example/../",
    "https://agent.example?",
    "https://agent.example#",
    "https://agent.example\\api",
    "http://agent.example",
    "http://127.0.0.1:3000",
    "https://" + "a".repeat(2048),
  ])
    expect(() => normalizeAgentEndpoint(address)).toThrow();
  for (const address of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"])
    expect(normalizeAgentEndpoint(address, true)).toBe(address);
  for (const address of ["http://100.64.1.2:3000", "http://127.0.0.2:3000", "http://agent.example"])
    expect(() => normalizeAgentEndpoint(address, true)).toThrow();
});

test("a connection keeps its target and preserves signals, bodies and streams under fixed request policy", async () => {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const controller = new AbortController();
  const response = new Response(
    new ReadableStream({
      start(control) {
        control.enqueue(new Uint8Array([1]));
        control.close();
      },
    }),
  );
  const connection = createAgentConnection("https://agent.example/", {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response;
    },
  });
  expect(Reflect.set(connection, "endpoint", "https://other.example")).toBe(false);
  const body = new Blob(["recording"], { type: "audio/wav" });
  expect(
    await connection.request("/api/transcriptions", {
      method: "POST",
      body,
      signal: controller.signal,
      cache: "no-store",
    }),
  ).toBe(response);
  expect(requests[0]?.url).toBe("https://agent.example/api/transcriptions");
  expect(requests[0]?.options).toMatchObject({
    method: "POST",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  expect(requests[0]?.options.body).toBe(body);
  expect(requests[0]?.options.signal).toBe(controller.signal);
  controller.abort();
  expect(requests[0]?.options.signal?.aborted).toBe(true);
  expect(response.body?.locked).toBe(false);
  await response.body?.cancel();
});

test("routes cannot replace the origin, normalize another path or inject a fragment", async () => {
  let calls = 0;
  const connection = createAgentConnection("https://agent.example", {
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  for (const route of [
    "https://other.example/api/roots",
    "//other.example/api/roots",
    "/outside",
    "/api/../outside",
    "/api/./roots",
    "/api/%2e%2e/outside",
    "/api/roots#fragment",
    "/api/roots\n",
    "/api/roots\\other",
    "/api/roots?x=%ZZ",
    "/api/" + "a".repeat(32_768),
  ])
    await expect(connection.request(route)).rejects.toThrow();
  expect(connection.url("/api/directories?path=odd+%CE%B2%23%3F%25")).toBe(
    "https://agent.example/api/directories?path=odd+%CE%B2%23%3F%25",
  );
  expect(calls).toBe(0);
});

test("an unexpected response address or redirect cancels its body", async () => {
  for (const fields of [
    { url: "https://other.example/api/roots" },
    { url: "https://agent.example/api/other" },
    { redirected: true },
  ]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
    for (const [key, value] of Object.entries(fields))
      Object.defineProperty(response, key, { value });
    const connection = createAgentConnection("https://agent.example", {
      fetch: async () => response,
    });
    await expect(connection.request("/api/roots")).rejects.toThrow("different address");
    expect(cancelled).toBe(true);
  }
});
