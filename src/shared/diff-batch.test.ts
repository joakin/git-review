import { expect, test } from "bun:test";
import { parseCommitDiffBatchRequest, commitDiffRequestKey } from "./commit-diff-batch.ts";
import { parseDiffBatchResponse, maxDiffBatchFiles, type DiffBatchResponse } from "./diff-batch.ts";
import { expectString } from "./validation.ts";

test("batch inputs bound work and preserve unusual paths and distinct language choices", () => {
  const files = [
    { path: "odd\n[1].ts", language: null },
    { path: "odd\n[1].ts", language: "text" },
  ];
  expect(parseCommitDiffBatchRequest({ files })).toEqual(files);
  expect(new Set(files.map(commitDiffRequestKey)).size).toBe(2);
  for (const body of [
    null,
    { files: [] },
    { files: [files[0], files[0]] },
    { files, extra: true },
    {
      files: Array.from({ length: maxDiffBatchFiles + 1 }, (_, i) => ({
        path: `${i}.ts`,
        language: null,
      })),
    },
    { files: [{ path: "../outside", language: null }] },
    { files: [{ path: ".git/config", language: null }] },
    { files: [{ path: "value.ts" }] },
    { files: [{ path: "value.ts", language: null, oldPath: "outside" }] },
  ])
    expect(() => parseCommitDiffBatchRequest(body)).toThrow();
});

test("batch responses cannot deliver results from another source or file", () => {
  const parse = (value: unknown) => expectString(value, "diff");
  const response: DiffBatchResponse<string> = {
    kind: "ready",
    source: "commit-a",
    results: [
      { key: "a", kind: "ready", value: "first" },
      { key: "b", kind: "error", status: 404, error: { code: "not_found", message: "Missing" } },
      { key: "c", kind: "deferred" },
    ],
  };
  expect(parseDiffBatchResponse(response, "commit-a", ["a", "b", "c"], parse)).toEqual(response);
  for (const value of [
    { ...response, source: "commit-b" },
    { ...response, results: [response.results[1], response.results[0], response.results[2]] },
    { ...response, results: response.results.slice(1) },
    {
      ...response,
      results: [{ key: "a", kind: "ready", value: 12 }, ...response.results.slice(1)],
    },
    {
      ...response,
      results: [
        { key: "a", kind: "error", status: 200, error: { code: "not_found", message: "Missing" } },
        ...response.results.slice(1),
      ],
    },
  ])
    expect(() => parseDiffBatchResponse(value, "commit-a", ["a", "b", "c"], parse)).toThrow();
});
