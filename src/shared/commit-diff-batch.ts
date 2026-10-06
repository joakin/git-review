import { gitPath } from "./git.ts";
import { parseDiffBatchFiles } from "./diff-batch.ts";
import { expectRecord, expectString } from "./validation.ts";

export type CommitDiffRequest = { path: string; language: string | null };

export function commitDiffRequestKey(file: CommitDiffRequest): string {
  return JSON.stringify([file.path, file.language]);
}

export function commitDiffBatchSource(projectPath: string, oid: string): string {
  return JSON.stringify(["git", projectPath, oid]);
}

export function parseCommitDiffBatchRequest(value: unknown): CommitDiffRequest[] {
  return parseDiffBatchFiles(
    value,
    (value) => {
      const file = expectRecord(value, "commit diff request");
      if (Object.keys(file).some((key) => key !== "path" && key !== "language"))
        throw new Error("Unexpected commit diff request field");
      const language =
        file["language"] === null ? null : expectString(file["language"], "language override");
      if (language !== null && (language.length === 0 || language.length > 100))
        throw new Error("Invalid language override");
      return { path: gitPath(file["path"]), language };
    },
    commitDiffRequestKey,
  );
}
