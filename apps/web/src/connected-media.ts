import type { ChangeLayer, DiffResult, FileReadResult, MediaSide } from "@git-review/shared/api";
import type { CommitDiff } from "@git-review/shared/git";
import type { MediaResource } from "@git-review/shared/media-types";
import type { AgentConnection } from "./agent-connection.ts";

type DiffSource =
  | { kind: "diff"; projectPath: string; path: string; layer: ChangeLayer; revision: string }
  | { kind: "commit"; projectPath: string; path: string; commit: string };

function resource(
  connection: AgentConnection,
  media: MediaResource,
  kind: "file" | "diff" | "commit",
  expected: Readonly<Record<string, string>>,
): MediaResource {
  const url = new URL(connection.url(media.url));
  if (url.pathname !== `/api/project/raw/${kind}`)
    throw new Error("Media route does not match its requested source");
  const allowed = new Set([...Object.keys(expected), "version"]);
  if (
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => url.searchParams.getAll(key).length !== 1)
  )
    throw new Error("Media URL contains missing, repeated or unexpected fields");
  for (const [key, value] of Object.entries(expected))
    if (url.searchParams.get(key) !== value)
      throw new Error("Media URL belongs to a different project or source");
  const version = url.searchParams.get("version");
  if (
    version === null ||
    !(
      kind === "file"
        ? /^[0-9a-f]{20}$/
        : kind === "commit"
          ? /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
          : /^(?:[0-9a-f]{20}|[0-9a-f]{40}|[0-9a-f]{64})$/
    ).test(version)
  )
    throw new Error("Media URL contains an invalid content version");
  return { ...media, url: url.href };
}

export function connectFileMedia(
  connection: AgentConnection,
  result: FileReadResult,
  projectPath: string,
  path: string,
): FileReadResult {
  if (result.path !== path) throw new Error("File response does not match its requested path");
  return result.kind === "media"
    ? { ...result, resource: resource(connection, result.resource, "file", { projectPath, path }) }
    : result;
}

function side(
  connection: AgentConnection,
  value: MediaSide,
  source: DiffSource,
  selected: "old" | "new",
): MediaSide {
  if (value.kind !== "ready") return value;
  const expected =
    source.kind === "diff"
      ? {
          projectPath: source.projectPath,
          path: source.path,
          layer: source.layer,
          revision: source.revision,
          side: selected,
        }
      : {
          projectPath: source.projectPath,
          path: source.path,
          commit: source.commit,
          side: selected,
        };
  return { ...value, resource: resource(connection, value.resource, source.kind, expected) };
}

export function connectDiffMedia(
  connection: AgentConnection,
  result: CommitDiff,
  source: DiffSource,
): CommitDiff;
export function connectDiffMedia(
  connection: AgentConnection,
  result: DiffResult,
  source: DiffSource,
): DiffResult;
export function connectDiffMedia(
  connection: AgentConnection,
  result: DiffResult,
  source: DiffSource,
): DiffResult {
  return result.kind === "media"
    ? {
        ...result,
        old: side(connection, result.old, source, "old"),
        new: side(connection, result.new, source, "new"),
      }
    : result;
}
