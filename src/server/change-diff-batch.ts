import type { DiffResult, Project } from "../shared/api.ts";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchRequest,
  type ChangeDiffBatchRequest,
} from "../shared/change-diff-batch.ts";
import { readDiffBatch } from "./diff-batch.ts";
import { readProjectDiff } from "./git-diff.ts";
import { readProjectStatus } from "./git-status.ts";
import { describeDiffMedia } from "./media.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { languageOverride } from "./syntax.ts";

export async function readChangeDiffBatch(
  root: ApprovedRoot,
  project: Project,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let request: ChangeDiffBatchRequest;
  try {
    request = parseChangeDiffBatchRequest(body);
    if (
      request.files.some(
        (file) => file.language !== null && languageOverride(file.language) === null,
      )
    )
      throw new Error("Invalid language override");
  } catch {
    throw new AppError("invalid_request", 400, "Invalid change diff batch");
  }
  const source = changeDiffBatchSource(project.id, request.revision, request.changeToken);
  const stale = () =>
    Response.json({ kind: "stale", source }, { headers: { "cache-control": "no-store" } });
  if (signal.aborted) return new Response(null, { status: 499 });
  const status = await readProjectStatus(project.absolutePath);
  if (
    status.kind !== "git" ||
    status.revision !== request.revision ||
    status.changeToken !== request.changeToken
  )
    return stale();
  let staleRead = false;
  const response = await readDiffBatch(
    source,
    request.files,
    changeDiffRequestKey,
    async (file): Promise<DiffResult> => {
      if (staleRead) return { kind: "stale" };
      const entry = status.entries.find(
        (entry) => entry.layer === file.layer && entry.path === file.path,
      );
      if (entry === undefined) throw new AppError("not_found", 404, "Changed file was not found");
      const diff =
        (await describeDiffMedia(root, project, entry, request.revision)) ??
        (await readProjectDiff(root, project, entry, file.language));
      if (diff.kind === "stale") staleRead = true;
      return diff;
    },
    signal,
  );
  if (signal.aborted) return new Response(null, { status: 499 });
  const after = await readProjectStatus(project.absolutePath);
  if (signal.aborted) return new Response(null, { status: 499 });
  if (
    staleRead ||
    after.kind !== "git" ||
    after.revision !== request.revision ||
    after.changeToken !== request.changeToken
  )
    return stale();
  return response;
}
