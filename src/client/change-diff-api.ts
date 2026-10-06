import { projectApiUrl } from "../shared/project-path.ts";
import type { DiffResult } from "../shared/api.ts";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchResponse,
  type ChangeDiffRequest,
} from "../shared/change-diff-batch.ts";
import { fetchProjectDiff } from "./api.ts";
import { DiffBatchQueue, type DiffBatchSource } from "./diff-batch-queue.ts";
import { diffBatchResponseBody } from "./diff-batch-response.ts";
import type { DiffBatchResult } from "../shared/diff-batch.ts";

const changes = new DiffBatchQueue<ChangeDiffRequest, DiffResult>(changeDiffRequestKey);

export async function fetchChangeDiff(
  projectPath: string,
  file: ChangeDiffRequest,
  snapshot: { revision: string; changeToken: string; refreshKey: number },
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
          await fetch(projectApiUrl("/diffs", projectPath), {
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
        ? response
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
      fetchProjectDiff(
        projectPath,
        file.layer,
        file.path,
        revision,
        file.language,
        signal,
        changeToken,
      ),
  };
  return changes.read(adapter, file, signal);
}
