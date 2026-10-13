import { expect, test } from "bun:test";
import { createAgentLifetime } from "./agent-lifetime.ts";
import { createAgentConnection } from "./agent-connection.ts";
import { createAgentApi } from "./agent-api.ts";

test("changing agent lifetime aborts in-flight transport, rejects late replies and prevents new work", async () => {
  const held: { complete: ((response: Response) => void) | null; signal: AbortSignal | null } = {
    complete: null,
    signal: null,
  };
  let calls = 0;
  const lifetime = createAgentLifetime(
    createAgentConnection("https://agent-a.example", {
      fetch: (_url, options) => {
        calls += 1;
        held.signal = options.signal ?? null;
        return new Promise<Response>((resolve) => {
          held.complete = resolve;
        });
      },
    }),
  );
  const caller = new AbortController();
  const scoped = lifetime.createController();
  const pending = lifetime.connection
    .request("/api/roots", { signal: caller.signal })
    .catch((error: unknown) => error);
  lifetime.revoke();
  expect(held.signal?.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  expect(scoped.signal.aborted).toBe(true);
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  if (held.complete === null) throw new Error("No held request");
  held.complete(response);
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(cancelled).toBe(true);
  await expect(createAgentApi(lifetime.connection).fetchRoot(caller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(calls).toBe(1);
});

test("caller cancellation remains effective and a fresh activation of the same endpoint works", async () => {
  const original = createAgentConnection("https://agent.example", {
    fetch: async () => Response.json({ path: "/work" }),
  });
  const retired = createAgentLifetime(original);
  retired.revoke();
  const fresh = createAgentLifetime(original);
  const caller = new AbortController();
  caller.abort();
  await expect(
    fresh.connection.request("/api/roots", { signal: caller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect((await fresh.connection.request("/api/roots")).ok).toBe(true);
  expect(fresh.signal.aborted).toBe(false);
  fresh.revoke();
});
