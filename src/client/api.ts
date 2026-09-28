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
  parseSearchResponse,
  type DirectoryListing,
  type DiffResult,
  type FileReadResult,
  type FileTree,
  type ChangeLayer,
  type Project,
  type RootInfo,
  type ProjectStatus,
  type LanguageOption,
  type SearchResponse,
} from "../shared/api.ts";

async function responseBody(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error("The server returned an unreadable response");
  }
  if (!response.ok) {
    throw new Error(parseApiError(body)?.message ?? `Request failed (${response.status})`);
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

export async function fetchProjectTree(id: string, path: string, signal: AbortSignal): Promise<FileTree> {
  const query = new URLSearchParams({ path });
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/tree?${query}`, { signal });
  return parseFileTreeResponse(await responseBody(response));
}

export async function fetchProjectFile(id: string, path: string, language: string | null, signal: AbortSignal): Promise<FileReadResult> {
  const query = new URLSearchParams({ path, source: "worktree" });
  if (language !== null) query.set("language", language);
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/file?${query}`, { signal });
  return parseFileReadResponse(await responseBody(response));
}

export async function openProject(path: string, signal: AbortSignal): Promise<Project> {
  const response = await fetch("/api/projects/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
    signal,
  });
  return parseProjectResponse(await responseBody(response));
}

export async function fetchProjectStatus(id: string, signal: AbortSignal): Promise<ProjectStatus> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/status`, { signal });
  return parseStatusResponse(await responseBody(response));
}

export async function fetchLanguages(signal: AbortSignal): Promise<LanguageOption[]> {
  const response = await fetch("/api/languages", { signal });
  return parseLanguagesResponse(await responseBody(response));
}

export async function fetchProjectDiff(id: string, layer: ChangeLayer, path: string, revision: string, language: string | null, signal: AbortSignal): Promise<DiffResult> {
  const query = new URLSearchParams({ layer, path, revision });
  if (language !== null) query.set("language", language);
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/diff?${query}`, { signal });
  return parseDiffResponse(await responseBody(response));
}

export async function fetchProjectSearch(id: string, query: string, signal: AbortSignal): Promise<SearchResponse> {
  const search = new URLSearchParams({ query });
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/search?${search}`, { signal });
  return parseSearchResponse(await responseBody(response));
}
