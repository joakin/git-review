import { parseApiError, type ApiError } from "./api.ts";
import { expectNonNegativeInteger, expectRecord } from "./validation.ts";

export const maxDiffBatchFiles = 32;
export const maxDiffBatchRequestBytes = 256 * 1024;
export const maxDiffBatchResponseBytes = 8 * 1024 * 1024;
export const diffBatchSize = 32;

export type DiffBatchResult<T> = { key: string } & (
  | { kind: "ready"; value: T }
  | { kind: "error"; status: number; error: ApiError }
  | { kind: "deferred" }
);
export type DiffBatchResponse<T> = { kind: "ready"; source: string; results: DiffBatchResult<T>[] };

export function parseDiffBatchFiles<T>(
  value: unknown,
  parseFile: (value: unknown) => T,
  identity: (file: T) => string,
): T[] {
  const outer = expectRecord(value, "diff batch request");
  if (Object.keys(outer).some((key) => key !== "files"))
    throw new Error("Unexpected diff batch field");
  const files = outer["files"];
  if (!Array.isArray(files) || files.length === 0 || files.length > maxDiffBatchFiles)
    throw new Error("Expected a bounded nonempty file batch");
  const parsed = files.map((file: unknown) => parseFile(file));
  if (new Set(parsed.map(identity)).size !== parsed.length)
    throw new Error("Repeated diff batch file");
  return parsed;
}

export function parseDiffBatchResponse<T>(
  value: unknown,
  source: string,
  keys: readonly string[],
  parseValue: (value: unknown) => T,
): DiffBatchResponse<T> {
  const outer = expectRecord(value, "diff batch response");
  const results = outer["results"];
  if (
    outer["kind"] !== "ready" ||
    outer["source"] !== source ||
    !Array.isArray(results) ||
    keys.length < 1 ||
    keys.length > maxDiffBatchFiles ||
    results.length !== keys.length
  )
    throw new Error("Diff batch response does not match its requests");
  return {
    kind: "ready",
    source,
    results: results.map((value: unknown, index) => {
      const result = expectRecord(value, "diff batch result");
      const key = keys[index];
      if (key === undefined || result["key"] !== key)
        throw new Error("Diff batch file does not match its request");
      if (result["kind"] === "ready")
        return { key, kind: "ready", value: parseValue(result["value"]) };
      if (result["kind"] === "deferred") return { key, kind: "deferred" };
      if (result["kind"] === "error") {
        const error = parseApiError({ error: result["error"] });
        const status = expectNonNegativeInteger(result["status"], "file error status");
        if (error !== null && status >= 400 && status <= 599)
          return { key, kind: "error", status, error };
      }
      throw new Error("Invalid diff batch result");
    }),
  };
}
