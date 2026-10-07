import { projectApiUrl } from "../shared/project-path.ts";
import {
  parseApiError,
  parseDirectoryResponse,
  parseFileReadResponse,
  parseFileTreeResponse,
  parseDiffResponse,
  parseLanguagesResponse,
  parseProjectResponse,
  parseRootResponse,
  parseStatusResponse,
  parseChangeCheckResponse,
  parseSearchResponse,
  type ApiErrorCode,
  type DirectoryListing,
  type DiffResult,
  type FileReadResult,
  type FileTree,
  type ChangeLayer,
  type Project,
  type RootInfo,
  type ProjectStatus,
  type ProjectChangeCheck,
  type LanguageOption,
  type SearchResponse,
} from "../shared/api.ts";
import { expectRecord, expectString } from "../shared/validation.ts";
import type { ChangeSnapshot } from "../shared/change-snapshot.ts";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode | null,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function responseBody(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new Error("The server returned an unreadable response");
  }
  if (!response.ok) {
    const error = parseApiError(body);
    throw new ApiRequestError(
      error?.message ?? `Request failed (${response.status})`,
      error?.code ?? null,
      response.status,
    );
  }
  return body;
}

export async function fetchRoot(signal: AbortSignal): Promise<RootInfo> {
  const response = await fetch("/api/roots", { signal });
  return parseRootResponse(await responseBody(response));
}

export async function fetchDirectory(path: string, signal: AbortSignal): Promise<DirectoryListing> {
  const query = new URLSearchParams({ path });
  const response = await fetch(`/api/directories?${query}`, { signal });
  return parseDirectoryResponse(await responseBody(response));
}

export async function fetchProjectTree(
  projectPath: string,
  path: string,
  signal: AbortSignal,
): Promise<FileTree> {
  const response = await fetch(projectApiUrl("/tree", projectPath, { path }), {
    signal,
  });
  return parseFileTreeResponse(await responseBody(response));
}

export async function fetchProjectFile(
  projectPath: string,
  path: string,
  language: string | null,
  signal: AbortSignal,
): Promise<FileReadResult> {
  const response = await fetch(
    projectApiUrl("/file", projectPath, {
      path,
      source: "worktree",
      ...(language === null ? {} : { language }),
    }),
    {
      signal,
      cache: "no-store",
    },
  );
  return parseFileReadResponse(await responseBody(response));
}

export async function lookupProject(projectPath: string, signal: AbortSignal): Promise<Project> {
  const response = await fetch(projectApiUrl("", projectPath), { signal, cache: "no-store" });
  return parseProjectResponse(await responseBody(response));
}

export async function fetchProjectStatus(
  projectPath: string,
  signal: AbortSignal,
): Promise<ProjectStatus> {
  const response = await fetch(projectApiUrl("/status", projectPath), {
    signal,
    cache: "no-store",
  });
  return parseStatusResponse(await responseBody(response));
}

export async function fetchProjectChangeCheck(
  projectPath: string,
  signal: AbortSignal,
): Promise<ProjectChangeCheck> {
  const response = await fetch(projectApiUrl("/status", projectPath, { mode: "check" }), {
    signal,
    cache: "no-store",
  });
  return parseChangeCheckResponse(await responseBody(response));
}

export async function fetchLanguages(signal: AbortSignal): Promise<LanguageOption[]> {
  const response = await fetch("/api/languages", { signal });
  return parseLanguagesResponse(await responseBody(response));
}

export async function fetchProjectDiff(
  projectPath: string,
  layer: ChangeLayer,
  path: string,
  snapshot: ChangeSnapshot,
  language: string | null,
  signal: AbortSignal,
): Promise<DiffResult> {
  const response = await fetch(
    projectApiUrl("/diff", projectPath, {
      layer,
      path,
      revision: snapshot.revision,
      changeToken: snapshot.changeToken,
      ...(language === null ? {} : { language }),
    }),
    {
      signal,
      cache: "no-store",
    },
  );
  return parseDiffResponse(await responseBody(response));
}

export async function fetchProjectSearch(
  projectPath: string,
  query: string,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const response = await fetch(projectApiUrl("/search", projectPath, { query }), {
    signal,
  });
  return parseSearchResponse(await responseBody(response));
}

export async function transcribeRecording(recording: Blob, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/transcriptions", {
    method: "POST",
    headers: { "content-type": recording.type },
    body: recording,
    signal,
  });
  const body = expectRecord(await responseBody(response), "transcription response");
  const text = expectString(body["text"], "transcription text");
  if (text.length === 0 || text.length > 5_000)
    throw new Error("The server returned invalid transcription text");
  return text;
}
