import { expect, test } from "bun:test";
import { parseDiffBatchResponse } from "../shared/diff-batch.ts";
import { expectString } from "../shared/validation.ts";
import { AppError } from "./paths.ts";
import { readDiffBatch } from "./diff-batch.ts";

test("batch byte limits preserve file identities and independent errors", async () => {
  const files = ["small", "missing", "huge", "last"];
  const response = await readDiffBatch(
    "source",
    files,
    (file) => file,
    async (file) => {
      if (file === "missing") throw new AppError("not_found", 404, "Missing file");
      return file === "huge" ? "🙂".repeat(200) : file;
    },
    new AbortController().signal,
    450,
  );
  const bytes = await response.arrayBuffer();
  expect(bytes.byteLength).toBeLessThanOrEqual(450);
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const result = parseDiffBatchResponse(body, "source", files, (value) =>
    expectString(value, "diff"),
  );
  expect(result.results).toEqual([
    { key: "small", kind: "ready", value: "small" },
    {
      key: "missing",
      kind: "error",
      status: 404,
      error: { code: "not_found", message: "Missing file" },
    },
    { key: "huge", kind: "deferred" },
    { key: "last", kind: "ready", value: "last" },
  ]);
});

test("batch cancellation stops new file work and never returns a partial success", async () => {
  const controller = new AbortController();
  let start = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reads: number[] = [];
  const response = readDiffBatch(
    "source",
    [0, 1, 2, 3, 4, 5],
    String,
    async (file) => {
      reads.push(file);
      if (reads.length === 3) start();
      await gate;
      return file;
    },
    controller.signal,
  );
  await started;
  expect(reads).toEqual([0, 1, 2]);
  controller.abort();
  release();
  expect((await response).status).toBe(499);
  expect(reads).toEqual([0, 1, 2]);
});
