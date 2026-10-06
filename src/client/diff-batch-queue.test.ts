import { expect, test } from "bun:test";
import { DiffBatchQueue, type DiffBatchSource } from "./diff-batch-queue.ts";
import type { DiffBatchResponse } from "../shared/diff-batch.ts";

function ready(source: string, files: readonly string[]): DiffBatchResponse<string> {
  return {
    kind: "ready",
    source,
    results: files.map((file) => ({ key: file, kind: "ready", value: file })),
  };
}

test("batch demand is deduplicated, bounded and released for later reads", async () => {
  const queue = new DiffBatchQueue<string, string>((file) => file, 2);
  const batches: string[][] = [];
  const source: DiffBatchSource<string, string> = {
    key: "source",
    encode: (files) => JSON.stringify({ files }),
    read: async (_body, files) => {
      batches.push([...files]);
      return ready("source", files);
    },
    readSingle: async (file) => file,
  };
  const signal = new AbortController().signal;
  expect(
    await Promise.all(["a", "b", "a", "c"].map((file) => queue.read(source, file, signal))),
  ).toEqual(["a", "b", "a", "c"]);
  expect(batches).toEqual([["a", "b"], ["c"]]);
  expect(await queue.read(source, "a", signal)).toBe("a");
  expect(batches).toEqual([["a", "b"], ["c"], ["a"]]);
});

test("canceling one card retains sibling demand and canceled results cannot replace new demand", async () => {
  const queue = new DiffBatchQueue<string, string>((file) => file);
  let start = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const source: DiffBatchSource<string, string> = {
    key: "source",
    encode: (files) => JSON.stringify({ files }),
    read: async (_body, files, signal) => {
      if (first) {
        first = false;
        start();
        await gate;
        expect(signal.aborted).toBe(false);
      }
      return ready("source", files);
    },
    readSingle: async (file) => file,
  };
  const canceled = new AbortController();
  const a = queue.read(source, "a", canceled.signal);
  const rejected = a.catch((error: unknown) => error);
  const b = queue.read(source, "b", new AbortController().signal);
  await started;
  canceled.abort();
  expect(await rejected).toMatchObject({ name: "AbortError" });
  const replacement = queue.read(source, "a", new AbortController().signal);
  release();
  expect(await b).toBe("b");
  expect(await replacement).toBe("a");
});

test("last-card cancellation aborts transport and another source can proceed", async () => {
  const queue = new DiffBatchQueue<string, string>((file) => file);
  let start = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const source: DiffBatchSource<string, string> = {
    key: "old",
    encode: (files) => JSON.stringify({ files }),
    read: async (_body, _files, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
        start();
      }),
    readSingle: async (file) => file,
  };
  const controller = new AbortController();
  const old = queue.read(source, "file", controller.signal);
  const rejected = old.catch((error: unknown) => error);
  await started;
  controller.abort();
  expect(await rejected).toMatchObject({ name: "AbortError" });
  const next: DiffBatchSource<string, string> = {
    ...source,
    key: "new",
    read: async (_body, files) => ready("new", files),
  };
  expect(await queue.read(next, "file", new AbortController().signal)).toBe("file");
});

test("deferred files use independent reads with at most three in flight", async () => {
  const queue = new DiffBatchQueue<string, string>((file) => file);
  let active = 0;
  let peak = 0;
  const source: DiffBatchSource<string, string> = {
    key: "source",
    encode: (files) => JSON.stringify({ files }),
    read: async (_body, files) => ({
      kind: "ready",
      source: "source",
      results: files.map((key) => ({ key, kind: "deferred" })),
    }),
    readSingle: async (file) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return file;
    },
  };
  expect(
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((file) =>
        queue.read(source, file, new AbortController().signal),
      ),
    ),
  ).toEqual(["a", "b", "c", "d", "e"]);
  expect(peak).toBe(3);
});
