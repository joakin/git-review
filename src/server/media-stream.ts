import type { FileHandle } from "node:fs/promises";
import { basename } from "node:path";
import type { Project } from "../shared/api.ts";
import { workingVersion } from "./image-types.ts";
import { openGitStream } from "./git-execution.ts";

type MediaStreamSource =
  | { kind: "file"; file: FileHandle; version: string }
  | { kind: "git"; project: Project; oid: string };

export type StreamableMedia = {
  source: MediaStreamSource;
  byteLength: number;
  mimeType: string;
  path: string;
};

type ByteRange = { start: number; end: number; partial: boolean };

function requestedRange(header: string | null, size: number): ByteRange | null {
  if (header === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  const first = match[1] ?? "";
  const last = match[2] ?? "";
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1, partial: true };
  }
  const start = Number(first);
  const requestedEnd = last === "" ? size - 1 : Number(last);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    requestedEnd < start
  )
    return null;
  return { start, end: Math.min(size - 1, requestedEnd), partial: true };
}

function fileStream(
  file: FileHandle,
  version: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let position = start;
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await file.close();
    }
  };
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        if (position > end) {
          await close();
          controller.close();
          return;
        }
        if (workingVersion(await file.stat()) !== version)
          throw new Error("Media file changed during streaming");
        const bytes = new Uint8Array(Math.min(64 * 1024, end - position + 1));
        const read = await file.read(bytes, 0, bytes.length, position);
        if (read.bytesRead === 0) throw new Error("Media file changed during streaming");
        if (workingVersion(await file.stat()) !== version)
          throw new Error("Media file changed during streaming");
        position += read.bytesRead;
        controller.enqueue(bytes.subarray(0, read.bytesRead));
        if (position > end) {
          await close();
          controller.close();
        }
      } catch (error: unknown) {
        await close();
        controller.error(error);
      }
    },
    async cancel() {
      await close();
    },
  });
}

function gitStream(
  project: Project,
  oid: string,
  start: number,
  end: number,
  byteLength: number,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const stream = openGitStream(project.absolutePath, ["cat-file", "blob", oid], byteLength);
  let offset = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        while (offset <= end) {
          const raw = await stream.read();
          if (raw === null) throw new Error("Git media ended before the requested range");
          const chunkStart = offset;
          offset += raw.length;
          if (offset <= start) continue;
          const from = Math.max(0, start - chunkStart);
          const to = Math.min(raw.length, end - chunkStart + 1);
          controller.enqueue(new Uint8Array(raw.subarray(from, to)));
          if (offset > end) {
            stream.close();
            controller.close();
          }
          return;
        }
      } catch (error: unknown) {
        stream.close();
        controller.error(error);
      }
    },
    cancel() {
      stream.close();
    },
  });
}

export async function audioVideoResponse(
  request: Request,
  media: StreamableMedia,
): Promise<Response> {
  const range = requestedRange(request.headers.get("range"), media.byteLength);
  if (range === null) {
    if (media.source.kind === "file") await media.source.file.close();
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${media.byteLength}`,
        "accept-ranges": "bytes",
        "content-length": "0",
        "cache-control": "no-store",
      },
    });
  }
  const headers = {
    "content-type": media.mimeType,
    "content-length": String(range.end - range.start + 1),
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(media.path))}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    ...(range.partial
      ? { "content-range": `bytes ${range.start}-${range.end}/${media.byteLength}` }
      : {}),
  };
  if (request.method === "HEAD") {
    if (media.source.kind === "file") await media.source.file.close();
    return new Response(null, { status: range.partial ? 206 : 200, headers });
  }
  const body =
    media.source.kind === "file"
      ? fileStream(media.source.file, media.source.version, range.start, range.end)
      : gitStream(media.source.project, media.source.oid, range.start, range.end, media.byteLength);
  return new Response(body, { status: range.partial ? 206 : 200, headers });
}
