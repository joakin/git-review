import { maxDiffBatchResponseBytes, type DiffBatchResult } from "@git-review/shared/diff-batch";
import { AppError } from "./paths.ts";

/** Retain encoded results within one response budget, with at most three reads in flight. */
export async function readDiffBatch<I, T>(
  source: string,
  files: readonly I[],
  identity: (file: I) => string,
  read: (file: I) => Promise<T>,
  signal: AbortSignal,
  maxBytes = maxDiffBatchResponseBytes,
): Promise<Response> {
  const defaults = files.map((file) => JSON.stringify({ key: identity(file), kind: "deferred" }));
  const results = [...defaults];
  const prefix = `{"kind":"ready","source":${JSON.stringify(source)},"results":[`;
  const suffix = "]}";
  let bytes = Buffer.byteLength(prefix + results.join(",") + suffix);
  if (bytes > maxBytes) throw new Error("Diff batch envelope exceeds its byte budget");
  let next = 0;
  async function worker(): Promise<void> {
    while (!signal.aborted) {
      const index = next++;
      const file = files[index];
      if (file === undefined) return;
      const key = identity(file);
      let result: DiffBatchResult<T>;
      try {
        result = { key, kind: "ready", value: await read(file) };
      } catch (error: unknown) {
        if (signal.aborted) return;
        if (error instanceof AppError)
          result = {
            key,
            kind: "error",
            status: error.status,
            error: { code: error.code, message: error.message },
          };
        else {
          console.error("Diff batch file failed", error);
          result = {
            key,
            kind: "error",
            status: 500,
            error: { code: "internal_error", message: "The server could not read this diff" },
          };
        }
      }
      if (signal.aborted) return;
      const encoded = JSON.stringify(result);
      const deferred = defaults[index];
      if (deferred === undefined) throw new Error("Missing diff batch result slot");
      const size = bytes - Buffer.byteLength(deferred) + Buffer.byteLength(encoded);
      if (size <= maxBytes) {
        bytes = size;
        results[index] = encoded;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
  if (signal.aborted) return new Response(null, { status: 499 });
  return new Response(prefix + results.join(",") + suffix, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
