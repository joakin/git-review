import type { ApprovedRoot } from "./paths.ts";
import { AppError, listDirectory, resolveProject } from "./paths.ts";
import { readProjectStatus } from "./git-status.ts";
import { readReviewStatus } from "./change-stats.ts";
import { readProjectDiff } from "./git-diff.ts";
import { languageOverride, languages } from "./syntax.ts";
import {
  openWorkingAudioVideo,
  readProjectFile,
  readProjectTree,
  readWorkingImageBytes,
} from "./project-files.ts";
import {
  commitMediaResponse,
  describeCommitMedia,
  describeDiffMedia,
  diffMediaType,
  imageResponse,
  openDiffAudioVideo,
  readDiffImageBytes,
} from "./media.ts";
import { audioVideoResponse } from "./media-stream.ts";
import { imageMimeType } from "./image-types.ts";
import { searchProject } from "./search.ts";
import { createTranscriptionHandler } from "./transcription.ts";
import type { ChangeLayer } from "../shared/api.ts";
import {
  commitFile,
  readCommit,
  readCommitDiff,
  readGitHistory,
  readGitRefs,
} from "./git-history.ts";
import { isGitOid, validGitRef } from "../shared/git.ts";
import { maxDiffBatchRequestBytes } from "../shared/diff-batch.ts";
import { readCommitDiffBatch } from "./commit-diff-batch.ts";
import { readChangeDiffBatch } from "./change-diff-batch.ts";
import { isValidUrlEncoding } from "../shared/validation.ts";

const maxBodyBytes = 4096;

async function readJsonBody(request: Request, limit = maxBodyBytes): Promise<unknown> {
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
      if (size > limit) {
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
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

function oneQueryValue(url: URL, name: string): string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || values[0] === undefined)
    throw new AppError("invalid_request", 400, `Specify one ${name}`);
  return values[0];
}

function changeLayer(value: string): ChangeLayer {
  if (value === "staged" || value === "unstaged" || value === "untracked" || value === "conflict")
    return value;
  throw new AppError("invalid_request", 400, "Invalid change layer");
}

function onlyQueryKeys(url: URL, allowed: readonly string[]): void {
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!(key === "projectPath" || allowed.includes(key)) || seen.has(key))
      throw new AppError("invalid_request", 400, "Invalid or repeated query field");
    seen.add(key);
  }
}

function requestedLanguage(url: URL): string | null {
  const value = url.searchParams.get("language");
  if (value !== null && languageOverride(value) === null)
    throw new AppError("invalid_request", 400, "Invalid language override");
  return value;
}

export function createApiHandler(
  root: ApprovedRoot,
  publicOrigin: string | null = null,
): (request: Request) => Promise<Response> {
  const transcribe = createTranscriptionHandler();
  return (request) => handleApiRequest(request, root, publicOrigin, transcribe);
}

async function handleApiRequest(
  request: Request,
  root: ApprovedRoot,
  publicOrigin: string | null,
  transcribe: (request: Request) => Promise<Response>,
): Promise<Response> {
  try {
    // Await delegated response builders so their rejections reach this error boundary.
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== url.origin && origin !== publicOrigin) {
      throw new AppError("forbidden", 403, "Cross-origin requests are not allowed");
    }

    if (url.pathname === "/api/roots" && request.method === "GET") {
      return Response.json({ root: root.info });
    }
    if (url.pathname === "/api/languages" && request.method === "GET")
      return Response.json({ languages });
    if (url.pathname === "/api/transcriptions" && request.method === "POST")
      return await transcribe(request);
    if (url.pathname === "/api/directories" && request.method === "GET") {
      const paths = url.searchParams.getAll("path");
      if (paths.length !== 1) throw new AppError("invalid_request", 400, "Specify one folder path");
      const listing = await listDirectory(root, paths[0]);
      return Response.json(listing);
    }
    if (url.pathname === "/api/project" && request.method === "GET") {
      onlyQueryKeys(url, []);
      return Response.json({
        project: await resolveProject(root, oneQueryValue(url, "projectPath"), false),
      });
    }
    const gitBatchRoute = /^\/api\/project\/git\/commits\/([0-9a-f]{40}|[0-9a-f]{64})\/diffs$/.exec(
      url.pathname,
    );
    if (gitBatchRoute !== null && request.method === "POST") {
      onlyQueryKeys(url, []);
      const oid = gitBatchRoute[1];
      if (oid === undefined) throw new AppError("invalid_request", 400, "Specify a commit ID");
      const body = await readJsonBody(request, maxDiffBatchRequestBytes);
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      return await readCommitDiffBatch(current, oid, body, request.signal);
    }
    const gitRoute =
      /^\/api\/project\/git\/(refs|log|commits\/((?:[0-9a-f]{40}|[0-9a-f]{64}))(\/diff)?)$/.exec(
        url.pathname,
      );
    if (gitRoute !== null && request.method === "GET") {
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      if (gitRoute[1] === "refs") {
        onlyQueryKeys(url, []);
        return Response.json(await readGitRefs(current));
      }
      if (gitRoute[1] === "log") {
        onlyQueryKeys(url, ["ref", "tip", "offset"]);
        if (url.searchParams.has("ref")) {
          const ref = oneQueryValue(url, "ref");
          if (!validGitRef(ref) || url.searchParams.has("tip") || url.searchParams.has("offset"))
            throw new AppError(
              "invalid_request",
              400,
              "Specify one branch ref or history snapshot",
            );
          return Response.json(await readGitHistory(current, { kind: "ref", ref }));
        }
        const tip = oneQueryValue(url, "tip");
        const offset = oneQueryValue(url, "offset");
        if (!isGitOid(tip) || !/^(?:0|[1-9][0-9]{0,6})$/.test(offset))
          throw new AppError("invalid_request", 400, "Invalid history snapshot");
        return Response.json(
          await readGitHistory(current, { kind: "page", tip, offset: Number(offset) }),
        );
      }
      const oid = gitRoute[2];
      if (oid === undefined) throw new AppError("invalid_request", 400, "Specify a commit ID");
      onlyQueryKeys(url, gitRoute[3] === undefined ? [] : ["path", "language"]);
      const language = gitRoute[3] === undefined ? null : requestedLanguage(url);
      const detail = await readCommit(current, oid);
      if (gitRoute[3] === undefined) return Response.json(detail);
      const file = commitFile(detail, oneQueryValue(url, "path"));
      return Response.json(
        (await describeCommitMedia(current, detail, file)) ??
          (await readCommitDiff(current, detail, file, language)),
      );
    }
    const rawRoute = /^\/api\/project\/raw\/(file|diff|commit)$/.exec(url.pathname);
    if (rawRoute !== null && (request.method === "GET" || request.method === "HEAD")) {
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      const path = oneQueryValue(url, "path");
      const version = oneQueryValue(url, "version");
      if (!/^(?:[0-9a-f]{20}|[0-9a-f]{40,64})$/.test(version))
        throw new AppError("invalid_request", 400, "Invalid media version");
      if (rawRoute[1] === "commit") {
        onlyQueryKeys(url, ["path", "version", "commit", "side"]);
        const side = oneQueryValue(url, "side");
        if (side !== "old" && side !== "new")
          throw new AppError("invalid_request", 400, "Invalid commit media side");
        const detail = await readCommit(current, oneQueryValue(url, "commit"));
        return await commitMediaResponse(request, current, commitFile(detail, path), side, version);
      }
      if (rawRoute[1] === "file") {
        onlyQueryKeys(url, ["path", "version"]);
        if (imageMimeType(path) !== null) {
          const image = await readWorkingImageBytes(root, current, path, version);
          return imageResponse(image.bytes, image.mimeType, path, request.method === "HEAD");
        }
        const media = await openWorkingAudioVideo(root, current, path, version);
        return await audioVideoResponse(request, {
          source: { kind: "file", file: media.file, version },
          byteLength: media.byteLength,
          mimeType: media.mimeType,
          path: media.path,
        });
      }
      onlyQueryKeys(url, ["path", "version", "layer", "revision", "side"]);
      const layer = changeLayer(oneQueryValue(url, "layer"));
      const revision = oneQueryValue(url, "revision");
      const side = oneQueryValue(url, "side");
      if (!/^[0-9a-f]{20}$/.test(revision) || (side !== "old" && side !== "new"))
        throw new AppError("invalid_request", 400, "Invalid media side or revision");
      const status = await readProjectStatus(current.absolutePath);
      if (status.kind !== "git" || status.revision !== revision)
        throw new AppError("not_found", 409, "This change was updated. Refresh its preview.");
      const entry = status.entries.find((item) => item.layer === layer && item.path === path);
      if (entry === undefined) throw new AppError("not_found", 404, "Changed file was not found");
      const type = diffMediaType(entry, side);
      if (type === "audio-video")
        return await audioVideoResponse(
          request,
          await openDiffAudioVideo(root, current, entry, side, version),
        );
      if (type === null)
        throw new AppError("not_found", 404, "This change has no previewable media on that side");
      const image = await readDiffImageBytes(root, current, entry, side, version);
      return imageResponse(image.bytes, image.mimeType, image.path, request.method === "HEAD");
    }
    const searchRoute = /^\/api\/project\/search$/.exec(url.pathname);
    if (searchRoute !== null && request.method === "GET") {
      if (!isValidUrlEncoding(url.search))
        throw new AppError("invalid_request", 400, "Invalid query encoding");
      onlyQueryKeys(url, ["query"]);
      const query = oneQueryValue(url, "query");
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      return Response.json(await searchProject(current, query, request.signal));
    }
    const fileRoute = /^\/api\/project\/(tree|file)$/.exec(url.pathname);
    if (fileRoute !== null && request.method === "GET") {
      onlyQueryKeys(url, fileRoute[1] === "tree" ? ["path"] : ["path", "source", "language"]);
      const path = oneQueryValue(url, "path");
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      if (fileRoute[1] === "tree") return Response.json(await readProjectTree(root, current, path));
      if (oneQueryValue(url, "source") !== "worktree")
        throw new AppError("invalid_request", 400, "Only working-tree files are available");
      const requestedLanguages = url.searchParams.getAll("language");
      if (requestedLanguages.length > 1)
        throw new AppError("invalid_request", 400, "Specify one language override");
      const requestedLanguage = requestedLanguages[0] ?? null;
      if (requestedLanguage !== null && languageOverride(requestedLanguage) === null)
        throw new AppError("invalid_request", 400, "Invalid language override");
      return Response.json(await readProjectFile(root, current, path, requestedLanguage));
    }
    const statusRoute = /^\/api\/project\/status$/.exec(url.pathname);
    if (statusRoute !== null && request.method === "GET") {
      onlyQueryKeys(url, ["mode"]);
      const modes = url.searchParams.getAll("mode");
      if (modes.length > 1 || (modes.length === 1 && modes[0] !== "check"))
        throw new AppError("invalid_request", 400, "Specify one valid status mode");
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      if (modes[0] === "check") {
        const status = await readProjectStatus(current.absolutePath);
        return Response.json(
          status.kind === "not_git"
            ? status
            : {
                kind: "git",
                revision: status.revision,
                changeToken: status.changeToken,
              },
        );
      }
      return Response.json(await readReviewStatus(root, current));
    }
    const diffBatchRoute = /^\/api\/project\/diffs$/.exec(url.pathname);
    if (diffBatchRoute !== null && request.method === "POST") {
      onlyQueryKeys(url, []);
      const body = await readJsonBody(request, maxDiffBatchRequestBytes);
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      return await readChangeDiffBatch(root, current, body, request.signal);
    }
    const diffRoute = /^\/api\/project\/diff$/.exec(url.pathname);
    if (diffRoute !== null && request.method === "GET") {
      onlyQueryKeys(url, ["layer", "path", "revision", "changeToken", "language"]);
      const layer = changeLayer(oneQueryValue(url, "layer"));
      const path = oneQueryValue(url, "path");
      const revision = oneQueryValue(url, "revision");
      const changeTokens = url.searchParams.getAll("changeToken");
      if (
        changeTokens.length > 1 ||
        (changeTokens.length === 1 && !/^[0-9a-f]{20}$/.test(changeTokens[0] ?? ""))
      )
        throw new AppError("invalid_request", 400, "Specify one valid change token");
      const changeToken = changeTokens[0];
      const requestedLanguages = url.searchParams.getAll("language");
      if (requestedLanguages.length > 1)
        throw new AppError("invalid_request", 400, "Specify one language override");
      const requestedLanguage = requestedLanguages[0] ?? null;
      if (requestedLanguage !== null && languageOverride(requestedLanguage) === null)
        throw new AppError("invalid_request", 400, "Invalid language override");
      if (
        path.length === 0 ||
        path.length > 4096 ||
        path.includes("\0") ||
        !/^[0-9a-f]{20}$/.test(revision)
      ) {
        throw new AppError("invalid_request", 400, "Invalid diff request");
      }
      const current = await resolveProject(root, oneQueryValue(url, "projectPath"));
      const status = await readProjectStatus(current.absolutePath);
      if (
        status.kind !== "git" ||
        status.revision !== revision ||
        (changeToken !== undefined && status.changeToken !== changeToken)
      )
        return Response.json({ kind: "stale" });
      const entry = status.entries.find((item) => item.layer === layer && item.path === path);
      if (entry === undefined) throw new AppError("not_found", 404, "Changed file was not found");
      const diff =
        (await describeDiffMedia(root, current, entry, revision)) ??
        (await readProjectDiff(root, current, entry, requestedLanguage));
      const after = await readProjectStatus(current.absolutePath);
      return Response.json(
        after.kind === "git" &&
          after.revision === revision &&
          (changeToken === undefined || after.changeToken === changeToken)
          ? diff
          : { kind: "stale" },
      );
    }
    throw new AppError("not_found", 404, "API route was not found");
  } catch (error: unknown) {
    if (error instanceof AppError) return errorResponse(error);
    console.error("API request failed", error);
    return errorResponse(
      new AppError("internal_error", 500, "The server could not complete this request"),
    );
  }
}
