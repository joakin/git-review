import type { ApprovedRoot } from "./paths.ts";
import { AppError, listDirectory, openProject } from "./paths.ts";
import { isRecord } from "../shared/validation.ts";

const maxBodyBytes = 4096;

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new AppError("invalid_request", 400, "Expected a JSON request body");
  }
  if (request.body === null) throw new AppError("invalid_request", 400, "Request body is missing");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new AppError("invalid_request", 413, "Request body is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new AppError("invalid_request", 400, "Request body is not valid JSON");
  }
}

function errorResponse(error: AppError): Response {
  return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
}

export async function handleApiRequest(request: Request, root: ApprovedRoot): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== url.origin) {
      throw new AppError("forbidden", 403, "Cross-origin requests are not allowed");
    }

    if (url.pathname === "/api/roots" && request.method === "GET") {
      return Response.json({ root: root.info });
    }
    if (url.pathname === "/api/directories" && request.method === "GET") {
      const paths = url.searchParams.getAll("path");
      if (paths.length !== 1) throw new AppError("invalid_request", 400, "Specify one folder path");
      const listing = await listDirectory(root, paths[0]);
      return Response.json(listing);
    }
    if (url.pathname === "/api/projects/open" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || !("path" in body)) {
        throw new AppError("invalid_request", 400, "Expected a folder path");
      }
      const project = await openProject(root, body["path"]);
      return Response.json({ project });
    }
    throw new AppError("not_found", 404, "API route was not found");
  } catch (error: unknown) {
    if (error instanceof AppError) return errorResponse(error);
    console.error("API request failed", error);
    return errorResponse(new AppError("internal_error", 500, "The server could not complete this request"));
  }
}
