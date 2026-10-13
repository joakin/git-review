import type { AgentConnection } from "./agent-connection.ts";
import { connectDiffMedia } from "./connected-media.ts";
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

export function createGitApi(connection: AgentConnection) {
  async function fetchGitRefs(projectPath: string, signal: AbortSignal): Promise<GitRefs> {
    return parseGitRefs(
      await responseBody(
        await connection.request(projectApiUrl("/git/refs", projectPath), {
          signal,
          cache: "no-store",
        }),
      ),
    );
  }

  async function fetchGitHistory(
    projectPath: string,
    request: GitLogRequest,
    signal: AbortSignal,
  ): Promise<GitHistoryPage> {
    const result = parseGitHistory(
      await responseBody(
        await connection.request(
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

  async function fetchCommit(
    projectPath: string,
    oid: string,
    signal: AbortSignal,
  ): Promise<CommitDetail> {
    const result = parseCommitDetail(
      await responseBody(
        await connection.request(projectApiUrl(`/git/commits/${oid}`, projectPath), { signal }),
      ),
    );
    if (result.oid !== oid) throw new Error("Commit response does not match its destination");
    return result;
  }

  const commitDiffs = new DiffBatchQueue<DiffFileRequest, CommitDiff>(commitDiffRequestKey);

  async function fetchCommitDiff(
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
      read: async (body, files, signal) => {
        const batch = parseDiffBatchResponse(
          await diffBatchResponseBody(
            await connection.request(projectApiUrl(`${resource}/diffs`, projectPath), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              signal,
            }),
          ),
          commitDiffBatchSource(projectPath, oid),
          files.map(commitDiffRequestKey),
          parseCommitDiff,
        );
        return {
          ...batch,
          results: batch.results.map((result, index) => {
            const requested = files[index];
            if (requested === undefined) throw new Error("Missing requested commit diff");
            return result.kind === "ready"
              ? {
                  ...result,
                  value: connectDiffMedia(connection, result.value, {
                    kind: "commit",
                    projectPath,
                    path: requested.path,
                    commit: oid,
                  }),
                }
              : result;
          }),
        };
      },
      readSingle: async (file, signal) => {
        return connectDiffMedia(
          connection,
          parseCommitDiff(
            await responseBody(
              await connection.request(
                projectApiUrl(`${resource}/diff`, projectPath, {
                  path: file.path,
                  ...(file.language === null ? {} : { language: file.language }),
                }),
                {
                  signal,
                },
              ),
            ),
          ),
          { kind: "commit", projectPath, path: file.path, commit: oid },
        );
      },
    };
    return commitDiffs.read(source, { path, language }, signal);
  }

  return Object.freeze({ fetchGitRefs, fetchGitHistory, fetchCommit, fetchCommitDiff });
}
