import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiErrorCode } from "../shared/api.ts";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";
import { maxAudioBytes } from "./transcription.ts";

async function withApi(
  check: (handle: ReturnType<typeof createApiHandler>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "git-review-transcription-api-"));
  try {
    await check(createApiHandler(await approveRoot(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function upload(
  body: BodyInit | null,
  headers: HeadersInit = { "content-type": "audio/webm" },
  signal?: AbortSignal,
): Request {
  return new Request("http://localhost/api/transcriptions", {
    method: "POST",
    headers,
    body,
    ...(signal === undefined ? {} : { signal }),
  });
}

async function expectError(
  response: Response,
  status: number,
  message: string,
  code: ApiErrorCode = "invalid_request",
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")?.startsWith("application/json")).toBe(true);
  expect(await response.json()).toEqual({ error: { code, message } });
}

const invalidUploads = [
  {
    name: "missing MIME type",
    request: () => upload(new Uint8Array([1]), {}),
    status: 415,
    message: "Unsupported recording format",
  },
  {
    name: "unsupported MIME type",
    request: () => upload(new Uint8Array([1]), { "content-type": "application/octet-stream" }),
    status: 415,
    message: "Unsupported recording format",
  },
  {
    name: "missing body",
    request: () => upload(null),
    status: 400,
    message: "Recording is missing",
  },
  {
    name: "empty body",
    request: () => upload(new Uint8Array(0), { "content-type": "audio/webm;codecs=opus" }),
    status: 400,
    message: "Recording is empty",
  },
  {
    name: "invalid advertised size",
    request: () =>
      upload(new Uint8Array([1]), { "content-type": "audio/webm", "content-length": "unknown" }),
    status: 413,
    message: "Recording is too large",
  },
  {
    name: "oversized advertised size",
    request: () =>
      upload(new Uint8Array([1]), {
        "content-type": "audio/webm",
        "content-length": String(maxAudioBytes + 1),
      }),
    status: 413,
    message: "Recording is too large",
  },
] as const;

for (const invalid of invalidUploads) {
  test(`transcription API returns a JSON error for ${invalid.name}`, async () => {
    await withApi(async (handle) => {
      await expectError(await handle(invalid.request()), invalid.status, invalid.message);
      // A failed upload must release the single-job slot for the next request.
      await expectError(await handle(upload(null)), 400, "Recording is missing");
    });
  });
}

test("transcription API bounds streamed audio without trusting Content-Length", async () => {
  await withApi(async (handle) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxAudioBytes + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expectError(await handle(upload(body)), 413, "Recording is too large");
    expect(cancelled).toBe(true);
    await expectError(await handle(upload(null)), 400, "Recording is missing");
  });
});

test("transcription API rejects a concurrent upload and releases the slot afterward", async () => {
  await withApi(async (handle) => {
    const release = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await release.promise;
        controller.close();
      },
    });
    const pending = handle(upload(body));
    let concurrent: Response;
    try {
      concurrent = await handle(upload(null));
    } finally {
      release.resolve();
      // Drain the held request even when the boundary regression rejects the second one.
      await pending.catch(() => {});
    }
    await expectError(concurrent, 429, "Another transcription is running. Try again shortly.");
    await expectError(await pending, 400, "Recording is empty");
    await expectError(await handle(upload(null)), 400, "Recording is missing");
  });
});

test("transcription API translates upload cancellation into a JSON error", async () => {
  await withApi(async (handle) => {
    const controller = new AbortController();
    controller.abort();
    await expectError(
      await handle(upload(new Uint8Array([1]), undefined, controller.signal)),
      499,
      "Recording upload was cancelled",
    );
    await expectError(await handle(upload(null)), 400, "Recording is missing");
  });
});

test("transcription API hides unexpected upload failure details behind its JSON error", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await withApi(async (handle) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("Private upload failure details"));
        },
      });
      await expectError(
        await handle(upload(body)),
        500,
        "The server could not complete this request",
        "internal_error",
      );
      await expectError(await handle(upload(null)), 400, "Recording is missing");
    });
  } finally {
    log.mockRestore();
  }
});
