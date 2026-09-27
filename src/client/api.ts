import {
  parseApiError,
  parseDirectoryResponse,
  parseDiffResponse,
  parseProjectResponse,
  parseRootResponse,
  parseStatusResponse,
  type DirectoryListing,
  type DiffResult,
  type ChangeLayer,
  type Project,
  type RootInfo,
  type ProjectStatus,
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

export async function fetchProjectDiff(id: string, layer: ChangeLayer, path: string, revision: string, signal: AbortSignal): Promise<DiffResult> {
  const query = new URLSearchParams({ layer, path, revision });
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/diff?${query}`, { signal });
  return parseDiffResponse(await responseBody(response));
}
