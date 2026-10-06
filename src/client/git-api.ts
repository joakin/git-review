import {
  parseCommitDetail,
  parseCommitDiff,
  parseGitHistory,
  parseGitRefs,
  type CommitDetail,
  type CommitDiff,
  type GitHistoryPage,
  type GitLogRequest,
  type GitRefs,
} from "../shared/git.ts";
import { responseBody } from "./api.ts";
import {
  commitDiffBatchSource,
  commitDiffRequestKey,
  type CommitDiffRequest,
} from "../shared/commit-diff-batch.ts";
import { parseDiffBatchResponse } from "../shared/diff-batch.ts";
import { DiffBatchQueue, type DiffBatchSource } from "./diff-batch-queue.ts";
import { diffBatchResponseBody } from "./diff-batch-response.ts";

export async function fetchGitRefs(id: string, signal: AbortSignal): Promise<GitRefs> {
  return parseGitRefs(
    await responseBody(await fetch(`/api/projects/${id}/git/refs`, { signal, cache: "no-store" })),
  );
}

export async function fetchGitHistory(
  id: string,
  request: GitLogRequest,
  signal: AbortSignal,
): Promise<GitHistoryPage> {
  const query = new URLSearchParams(
    request.kind === "ref"
      ? { ref: request.ref }
      : { tip: request.tip, offset: String(request.offset) },
  );
  const result = parseGitHistory(
    await responseBody(
      await fetch(`/api/projects/${id}/git/log?${query}`, { signal, cache: "no-store" }),
    ),
  );
  if (
    request.kind === "page" &&
    (result.tip !== request.tip ||
      (result.nextOffset !== null && result.nextOffset !== request.offset + 50))
  )
    throw new Error("History response does not match its snapshot");
  return result;
}

export async function fetchCommit(
  id: string,
  oid: string,
  signal: AbortSignal,
): Promise<CommitDetail> {
  const result = parseCommitDetail(
    await responseBody(await fetch(`/api/projects/${id}/git/commits/${oid}`, { signal })),
  );
  if (result.oid !== oid) throw new Error("Commit response does not match its destination");
  return result;
}

const commitDiffs = new DiffBatchQueue<CommitDiffRequest, CommitDiff>(commitDiffRequestKey);

export async function fetchCommitDiff(
  id: string,
  oid: string,
  path: string,
  language: string | null,
  signal: AbortSignal,
): Promise<CommitDiff> {
  const base = `/api/projects/${id}/git/commits/${oid}`;
  const source: DiffBatchSource<CommitDiffRequest, CommitDiff> = {
    key: commitDiffBatchSource(id, oid),
    encode: (files) => JSON.stringify({ files }),
    read: async (body, files, signal) =>
      parseDiffBatchResponse(
        await diffBatchResponseBody(
          await fetch(`${base}/diffs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal,
          }),
        ),
        commitDiffBatchSource(id, oid),
        files.map(commitDiffRequestKey),
        parseCommitDiff,
      ),
    readSingle: async (file, signal) => {
      const query = new URLSearchParams({ path: file.path });
      if (file.language !== null) query.set("language", file.language);
      return parseCommitDiff(await responseBody(await fetch(`${base}/diff?${query}`, { signal })));
    },
  };
  return commitDiffs.read(source, { path, language }, signal);
}
