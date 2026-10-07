import { isChangeLayer, parseDiffResponse, type ChangeLayer, type DiffResult } from "./api.ts";
import {
  maxDiffBatchFiles,
  parseDiffBatchFiles,
  parseDiffBatchResponse,
  type DiffBatchResponse,
} from "./diff-batch.ts";
import { parseDiffFileFields, type DiffFileRequest } from "./diff-request.ts";
import { parseChangeSnapshot, type ChangeSnapshot } from "./change-snapshot.ts";
import { expectRecord } from "./validation.ts";

export type ChangeDiffRequest = DiffFileRequest & { layer: ChangeLayer };
export type ChangeDiffBatchRequest = ChangeSnapshot & {
  files: ChangeDiffRequest[];
};
type CurrentDiff = Exclude<DiffResult, { kind: "stale" }>;
export type ChangeDiffBatchResponse =
  DiffBatchResponse<CurrentDiff> | { kind: "stale"; source: string };

export function changeDiffRequestKey(file: ChangeDiffRequest): string {
  return JSON.stringify([file.layer, file.path, file.language]);
}

export function changeDiffBatchSource(
  projectPath: string,
  revision: string,
  changeToken: string,
): string {
  return JSON.stringify(["changes", projectPath, revision, changeToken]);
}

export function parseChangeDiffBatchRequest(value: unknown): ChangeDiffBatchRequest {
  const outer = expectRecord(value, "change diff batch request");
  if (Object.keys(outer).some((key) => !["revision", "changeToken", "files"].includes(key)))
    throw new Error("Unexpected change diff batch field");
  const snapshot = parseChangeSnapshot(outer);
  const files = parseDiffBatchFiles(
    { files: outer["files"] },
    (value): ChangeDiffRequest => {
      const file = expectRecord(value, "change diff request");
      if (Object.keys(file).some((key) => !["layer", "path", "language"].includes(key)))
        throw new Error("Unexpected change diff request field");
      const layer = file["layer"];
      if (!isChangeLayer(layer)) throw new Error("Invalid change layer");
      return { layer, ...parseDiffFileFields(file) };
    },
    changeDiffRequestKey,
  );
  return { ...snapshot, files };
}

export function parseChangeDiffBatchResponse(
  value: unknown,
  source: string,
  keys: readonly string[],
): ChangeDiffBatchResponse {
  const outer = expectRecord(value, "change diff batch response");
  if (outer["kind"] === "stale") {
    if (outer["source"] !== source || keys.length < 1 || keys.length > maxDiffBatchFiles)
      throw new Error("Stale diff batch does not match its source");
    return { kind: "stale", source };
  }
  return parseDiffBatchResponse(value, source, keys, (value) => {
    const diff = parseDiffResponse(value);
    if (diff.kind === "stale") throw new Error("Stale diff must invalidate its whole batch");
    return diff;
  });
}
