import { expect, test } from "bun:test";
import { createClipboardWriter } from "./clipboard-writer.ts";

test("a new activation waits for the old native clipboard write and remains the final copy", async () => {
  const pending: { finish: (() => void) | null } = { finish: null };
  const calls: string[] = [];
  const writer = createClipboardWriter(async (text) => {
    calls.push(text);
    if (text === "old")
      await new Promise<void>((resolve) => {
        pending.finish = resolve;
      });
  });
  let active = true;
  const old = writer.write("old", () => active);
  await Promise.resolve();
  active = false;
  const next = writer.write("new", () => true);
  await Promise.resolve();
  expect(calls).toEqual(["old"]);
  if (pending.finish === null) throw new Error("No native clipboard lease");
  pending.finish();
  await Promise.all([old, next]);
  expect(calls).toEqual(["old", "new"]);
});

test("canceled queued copies never dispatch and do not block a later owner", async () => {
  const pending: { finish: (() => void) | null } = { finish: null };
  const calls: string[] = [];
  const writer = createClipboardWriter(async (text) => {
    calls.push(text);
    if (text === "old")
      await new Promise<void>((resolve) => {
        pending.finish = resolve;
      });
  });
  const old = writer.write("old", () => true);
  await Promise.resolve();
  let active = true;
  const canceled = writer.write("canceled", () => active).catch((error: unknown) => error);
  active = false;
  const next = writer.write("current", () => true);
  if (pending.finish === null) throw new Error("No native clipboard lease");
  pending.finish();
  await old;
  expect(await canceled).toMatchObject({ name: "AbortError" });
  await next;
  expect(calls).toEqual(["old", "current"]);
});
