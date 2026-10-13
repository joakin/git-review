import { projectApiUrl } from "@git-review/shared/project-path";
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
} from "@git-review/shared/git";
import { responseBody } from "./api.ts";
import { commitDiffBatchSource, commitDiffRequestKey } from "@git-review/shared/commit-diff-batch";
import type { DiffFileRequest } from "@git-review/shared/diff-request";
import { parseDiffBatchResponse } from "@git-review/shared/diff-batch";
import { DiffBatchQueue, type DiffBatchSource } from "./diff-batch-queue.ts";
import { diffBatchResponseBody } from "./diff-batch-response.ts";

export async function fetchGitRefs(projectPath: string, signal: AbortSignal): Promise<GitRefs> {
  return parseGitRefs(
    await responseBody(
      await fetch(projectApiUrl("/git/refs", projectPath), { signal, cache: "no-store" }),
    ),
  );
}

export async function fetchGitHistory(
  projectPath: string,
  request: GitLogRequest,
  signal: AbortSignal,
): Promise<GitHistoryPage> {
  const result = parseGitHistory(
    await responseBody(
      await fetch(
        projectApiUrl(
          "/git/log",
          projectPath,
          request.kind === "ref"
            ? { ref: request.ref }
            : { tip: request.tip, offset: String(request.offset) },
        ),
        {
          signal,
          cache: "no-store",
        },
      ),
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
  projectPath: string,
  oid: string,
  signal: AbortSignal,
): Promise<CommitDetail> {
  const result = parseCommitDetail(
    await responseBody(await fetch(projectApiUrl(`/git/commits/${oid}`, projectPath), { signal })),
  );
  if (result.oid !== oid) throw new Error("Commit response does not match its destination");
  return result;
}

const commitDiffs = new DiffBatchQueue<DiffFileRequest, CommitDiff>(commitDiffRequestKey);

export async function fetchCommitDiff(
  projectPath: string,
  oid: string,
  path: string,
  language: string | null,
  signal: AbortSignal,
): Promise<CommitDiff> {
  const resource = `/git/commits/${oid}`;
  const source: DiffBatchSource<DiffFileRequest, CommitDiff> = {
    key: commitDiffBatchSource(projectPath, oid),
    encode: (files) => JSON.stringify({ files }),
    read: async (body, files, signal) =>
      parseDiffBatchResponse(
        await diffBatchResponseBody(
          await fetch(projectApiUrl(`${resource}/diffs`, projectPath), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal,
          }),
        ),
        commitDiffBatchSource(projectPath, oid),
        files.map(commitDiffRequestKey),
        parseCommitDiff,
      ),
    readSingle: async (file, signal) => {
      return parseCommitDiff(
        await responseBody(
          await fetch(
            projectApiUrl(`${resource}/diff`, projectPath, {
              path: file.path,
              ...(file.language === null ? {} : { language: file.language }),
            }),
            {
              signal,
            },
          ),
        ),
      );
    },
  };
  return commitDiffs.read(source, { path, language }, signal);
}
