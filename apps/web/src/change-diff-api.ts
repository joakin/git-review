import { projectApiUrl } from "@git-review/shared/project-path";
import type { DiffResult } from "@git-review/shared/api";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchResponse,
  type ChangeDiffRequest,
} from "@git-review/shared/change-diff-batch";
import type { RepositoryApi } from "./api.ts";
import type { AgentConnection } from "./agent-connection.ts";
import { connectDiffMedia } from "./connected-media.ts";
import { DiffBatchQueue, type DiffBatchSource } from "./diff-batch-queue.ts";
import { diffBatchResponseBody } from "./diff-batch-response.ts";
import type { DiffBatchResult } from "@git-review/shared/diff-batch";
import type { ChangeSnapshot } from "@git-review/shared/change-snapshot";

export function createChangeDiffReader(connection: AgentConnection, repository: RepositoryApi) {
  const changes = new DiffBatchQueue<ChangeDiffRequest, DiffResult>(changeDiffRequestKey);

  async function fetchChangeDiff(
    projectPath: string,
    file: ChangeDiffRequest,
    snapshot: ChangeSnapshot & { refreshKey: number },
    signal: AbortSignal,
  ): Promise<DiffResult> {
    const { revision, changeToken, refreshKey } = snapshot;
    const source = changeDiffBatchSource(projectPath, revision, changeToken);
    const adapter: DiffBatchSource<ChangeDiffRequest, DiffResult> = {
      key: JSON.stringify([source, refreshKey]),
      encode: (files) => JSON.stringify({ revision, changeToken, files }),
      read: async (body, files, signal) => {
        const response = parseChangeDiffBatchResponse(
          await diffBatchResponseBody(
            await connection.request(projectApiUrl("/diffs", projectPath), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              signal,
              cache: "no-store",
            }),
          ),
          source,
          files.map(changeDiffRequestKey),
        );
        return response.kind === "ready"
          ? {
              ...response,
              results: response.results.map((result, index) => {
                const requested = files[index];
                if (requested === undefined) throw new Error("Missing requested diff");
                return result.kind === "ready"
                  ? {
                      ...result,
                      value: connectDiffMedia(connection, result.value, {
                        kind: "diff",
                        projectPath,
                        path: requested.path,
                        layer: requested.layer,
                        revision,
                      }),
                    }
                  : result;
              }),
            }
          : {
              kind: "ready",
              source,
              results: files.map((file): DiffBatchResult<DiffResult> => ({
                key: changeDiffRequestKey(file),
                kind: "ready",
                value: { kind: "stale" },
              })),
            };
      },
      readSingle: (file, signal) =>
        repository.fetchProjectDiff(
          projectPath,
          file.layer,
          file.path,
          snapshot,
          file.language,
          signal,
        ),
    };
    return changes.read(adapter, file, signal);
  }

  return fetchChangeDiff;
}
