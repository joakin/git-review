import { parseDiffFileFields, type DiffFileRequest } from "./diff-request.ts";
import { parseDiffBatchFiles } from "./diff-batch.ts";
import { expectRecord } from "./validation.ts";

export function commitDiffRequestKey(file: DiffFileRequest): string {
  return JSON.stringify([file.path, file.language]);
}

export function commitDiffBatchSource(projectPath: string, oid: string): string {
  return JSON.stringify(["git", projectPath, oid]);
}

export function parseCommitDiffBatchRequest(value: unknown): DiffFileRequest[] {
  return parseDiffBatchFiles(
    value,
    (value) => {
      const file = expectRecord(value, "commit diff request");
      if (Object.keys(file).some((key) => key !== "path" && key !== "language"))
        throw new Error("Unexpected commit diff request field");
      return parseDiffFileFields(file);
    },
    commitDiffRequestKey,
  );
}
