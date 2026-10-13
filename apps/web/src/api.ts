import type { AgentConnection } from "./agent-connection.ts";
import { connectDiffMedia, connectFileMedia } from "./connected-media.ts";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import { projectApiUrl } from "@git-review/shared/project-path";
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
} from "@git-review/shared/api";
import { expectRecord, expectString } from "@git-review/shared/validation";
import type { ChangeSnapshot } from "@git-review/shared/change-snapshot";

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

export function createRepositoryApi(connection: AgentConnection) {
  async function fetchRoot(signal: AbortSignal): Promise<RootInfo> {
    const response = await connection.request("/api/roots", { signal });
    return parseRootResponse(await responseBody(response));
  }

  async function fetchDirectory(path: string, signal: AbortSignal): Promise<DirectoryListing> {
    const query = new URLSearchParams({ path });
    const response = await connection.request(`/api/directories?${query}`, { signal });
    return parseDirectoryResponse(await responseBody(response));
  }

  async function fetchProjectTree(
    projectPath: string,
    path: string,
    signal: AbortSignal,
  ): Promise<FileTree> {
    const response = await connection.request(projectApiUrl("/tree", projectPath, { path }), {
      signal,
    });
    return parseFileTreeResponse(await responseBody(response));
  }

  async function fetchProjectFile(
    projectPath: string,
    path: string,
    language: string | null,
    signal: AbortSignal,
  ): Promise<FileReadResult> {
    const response = await connection.request(
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
    return connectFileMedia(
      connection,
      parseFileReadResponse(await responseBody(response)),
      projectPath,
      path,
    );
  }

  async function lookupProject(projectPath: string, signal: AbortSignal): Promise<Project> {
    const response = await connection.request(projectApiUrl("", projectPath), {
      signal,
      cache: "no-store",
    });
    return parseProjectResponse(await responseBody(response));
  }

  async function fetchProjectStatus(
    projectPath: string,
    signal: AbortSignal,
  ): Promise<ProjectStatus> {
    const response = await connection.request(projectApiUrl("/status", projectPath), {
      signal,
      cache: "no-store",
    });
    return parseStatusResponse(await responseBody(response));
  }

  async function fetchProjectChangeCheck(
    projectPath: string,
    signal: AbortSignal,
  ): Promise<ProjectChangeCheck> {
    const response = await connection.request(
      projectApiUrl("/status", projectPath, { mode: "check" }),
      {
        signal,
        cache: "no-store",
      },
    );
    return parseChangeCheckResponse(await responseBody(response));
  }

  async function fetchLanguages(signal: AbortSignal): Promise<LanguageOption[]> {
    const response = await connection.request("/api/languages", { signal });
    return parseLanguagesResponse(await responseBody(response));
  }

  async function fetchProjectDiff(
    projectPath: string,
    layer: ChangeLayer,
    path: string,
    snapshot: ChangeSnapshot,
    language: string | null,
    signal: AbortSignal,
  ): Promise<DiffResult> {
    const response = await connection.request(
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
    return connectDiffMedia(connection, parseDiffResponse(await responseBody(response)), {
      kind: "diff",
      projectPath,
      path,
      layer,
      revision: snapshot.revision,
    });
  }

  async function fetchProjectSearch(
    projectPath: string,
    query: string,
    signal: AbortSignal,
  ): Promise<SearchResponse> {
    const response = await connection.request(projectApiUrl("/search", projectPath, { query }), {
      signal,
    });
    return parseSearchResponse(await responseBody(response));
  }

  async function transcribeRecording(recording: Blob, signal: AbortSignal): Promise<string> {
    const response = await connection.request("/api/transcriptions", {
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

  async function fetchAgentInfo(signal: AbortSignal) {
    return parseAgentInfoResponse(
      await responseBody(await connection.request("/api/info", { signal, cache: "no-store" })),
    );
  }

  return Object.freeze({
    fetchAgentInfo,
    fetchRoot,
    fetchDirectory,
    fetchProjectTree,
    fetchProjectFile,
    lookupProject,
    fetchProjectStatus,
    fetchProjectChangeCheck,
    fetchLanguages,
    fetchProjectDiff,
    fetchProjectSearch,
    transcribeRecording,
  });
}
export type RepositoryApi = ReturnType<typeof createRepositoryApi>;
