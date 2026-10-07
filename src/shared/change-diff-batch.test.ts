import { expect, test } from "bun:test";
import {
  changeDiffRequestKey,
  parseChangeDiffBatchRequest,
  parseChangeDiffBatchResponse,
  type ChangeDiffBatchRequest,
} from "./change-diff-batch.ts";

test("change batches preserve layer/language identity and require both snapshot tokens", () => {
  const request: ChangeDiffBatchRequest = {
    revision: "a".repeat(20),
    changeToken: "b".repeat(20),
    files: [
      { layer: "staged", path: "odd\n[1].ts", language: null },
      { layer: "unstaged", path: "odd\n[1].ts", language: null },
      { layer: "unstaged", path: "odd\n[1].ts", language: "text" },
    ],
  };
  const parsed = parseChangeDiffBatchRequest(request);
  expect(parsed).toEqual(request);
  expect(new Set(parsed.files.map(changeDiffRequestKey)).size).toBe(3);
  for (const invalid of [
    { ...request, revision: undefined },
    { ...request, changeToken: undefined },
    { ...request, changeToken: "B".repeat(20) },
    { ...request, revision: "HEAD" },
    { ...request, extra: true },
    { ...request, files: [] },
    { ...request, files: [request.files[0], request.files[0]] },
    { ...request, files: [{ layer: "index", path: "value.ts", language: null }] },
    { ...request, files: [{ layer: "staged", path: "../outside", language: null }] },
    {
      ...request,
      files: [{ layer: "staged", path: "value.ts", language: null, oldPath: "outside" }],
    },
  ])
    expect(() => parseChangeDiffBatchRequest(invalid)).toThrow();
  expect(
    parseChangeDiffBatchResponse({ kind: "stale", source: "snapshot" }, "snapshot", ["file"]),
  ).toEqual({ kind: "stale", source: "snapshot" });
  expect(() =>
    parseChangeDiffBatchResponse({ kind: "stale", source: "other" }, "snapshot", ["file"]),
  ).toThrow();
  expect(() =>
    parseChangeDiffBatchResponse(
      {
        kind: "ready",
        source: "snapshot",
        results: [{ key: "file", kind: "ready", value: { kind: "stale" } }],
      },
      "snapshot",
      ["file"],
    ),
  ).toThrow();
});

test("change batch requests retain every layer and reject invalid layer values", () => {
  const request = {
    revision: "a".repeat(20),
    changeToken: "b".repeat(20),
    files: ["staged", "unstaged", "untracked", "conflict"].map((layer) => ({
      layer,
      path: "file.ts",
      language: null,
    })),
  };
  expect<unknown>(parseChangeDiffBatchRequest(request)).toEqual(request);
  for (const layer of [undefined, null, 1, "", "index", "Staged"])
    expect(() =>
      parseChangeDiffBatchRequest({
        ...request,
        files: [{ layer, path: "file.ts", language: null }],
      }),
    ).toThrow();
});
