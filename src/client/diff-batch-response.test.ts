import { expect, test } from "bun:test";
import { maxDiffBatchResponseBytes } from "../shared/diff-batch.ts";
import { diffBatchResponseBody } from "./diff-batch-response.ts";

test("batch HTTP bodies retain errors and reject invalid encoding", async () => {
  expect(await diffBatchResponseBody(Response.json({ kind: "ready", results: [] }))).toEqual({
    kind: "ready",
    results: [],
  });
  await expect(
    diffBatchResponseBody(
      Response.json({ error: { code: "not_found", message: "Missing commit" } }, { status: 404 }),
    ),
  ).rejects.toThrow("Missing commit");
  await expect(
    diffBatchResponseBody(new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]))),
  ).rejects.toThrow();
});

test("oversized streamed batch responses are canceled before decoding", async () => {
  let canceled = false;
  const chunk = new Uint8Array(1024 * 1024);
  let emitted = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  await expect(diffBatchResponseBody(response)).rejects.toThrow("byte limit");
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
  expect(emitted).toBeLessThanOrEqual(maxDiffBatchResponseBytes + 2 * chunk.byteLength);
});
