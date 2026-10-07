import type { Project } from "../shared/api.ts";
import {
  commitDiffBatchSource,
  commitDiffRequestKey,
  parseCommitDiffBatchRequest,
} from "../shared/commit-diff-batch.ts";
import type { DiffFileRequest } from "../shared/diff-request.ts";
import { commitFile, readCommit, readCommitDiff } from "./git-history.ts";
import { describeCommitMedia } from "./media.ts";
import { AppError } from "./paths.ts";
import { languageOverride } from "./syntax.ts";
import { readDiffBatch } from "./diff-batch.ts";

export async function readCommitDiffBatch(
  project: Project,
  oid: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let files: DiffFileRequest[];
  try {
    files = parseCommitDiffBatchRequest(body);
    if (files.some((file) => file.language !== null && languageOverride(file.language) === null))
      throw new Error("Invalid language override");
  } catch {
    throw new AppError("invalid_request", 400, "Invalid commit diff batch");
  }
  const detail = await readCommit(project, oid);
  if (detail.comparison.kind === "missing_parent")
    throw new AppError("not_found", 409, "The parent of this commit is missing from local history");
  return readDiffBatch(
    commitDiffBatchSource(project.absolutePath, detail.oid),
    files,
    commitDiffRequestKey,
    async (request) => {
      const file = commitFile(detail, request.path);
      return (
        (await describeCommitMedia(project, detail, file)) ??
        (await readCommitDiff(project, detail, file, request.language))
      );
    },
    signal,
  );
}
