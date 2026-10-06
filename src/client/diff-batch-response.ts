import { maxDiffBatchResponseBytes } from "../shared/diff-batch.ts";
import { responseBody } from "./api.ts";

export async function diffBatchResponseBody(response: Response): Promise<unknown> {
  if (response.body === null) throw new Error("Missing diff batch response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxDiffBatchResponseBytes) {
        await reader.cancel();
        throw new Error("Diff batch response exceeds the byte limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return responseBody(new Response(text, { status: response.status }));
}
