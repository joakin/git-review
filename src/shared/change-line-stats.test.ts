import { expect, test } from "bun:test";
import {
  parseChangeCheckResponse,
  parseStatusResponse,
  type ChangeLineStats,
  type ReviewChangeEntry,
} from "./api.ts";
import { summarizeChangeStats } from "./change-line-stats.ts";

const entry = (stats: ChangeLineStats, path = "file.txt"): ReviewChangeEntry => ({
  layer: "unstaged",
  kind: "modified",
  path,
  oldPath: null,
  isSubmodule: false,
  stats,
});
const response = (entries: unknown[]) => ({
  kind: "git",
  revision: "a".repeat(20),
  changeToken: "b".repeat(20),
  entries,
});

test("status and check responses require both valid snapshot tokens", () => {
  expect(parseChangeCheckResponse({ kind: "not_git" })).toEqual({ kind: "not_git" });
  for (const key of ["revision", "changeToken"])
    for (const value of [undefined, null, 1, "", "old", "A".repeat(20), "a".repeat(21)]) {
      const invalid = { ...response([]), [key]: value };
      expect(() => parseChangeCheckResponse(invalid)).toThrow();
      expect(() => parseStatusResponse(invalid)).toThrow();
    }
});

test("required statistics reject invalid counts, duplicate identities and contradictory states", () => {
  const valid = entry({ kind: "text", added: 12, deleted: 3 });
  expect<unknown>(parseStatusResponse(response([valid]))).toEqual(response([valid]));
  for (const stats of [
    undefined,
    null,
    {},
    { kind: "text", added: -1, deleted: 0 },
    { kind: "text", added: 1.5, deleted: 0 },
    { kind: "text", added: 0, deleted: "1" },
    { kind: "text", added: Number.MAX_SAFE_INTEGER + 1, deleted: 0 },
    { kind: "unavailable", reason: "unknown" },
    { kind: "not_applicable", reason: "conflict" },
    { kind: "not_applicable", reason: "submodule" },
  ])
    expect(() => parseStatusResponse(response([{ ...valid, stats }]))).toThrow();
  expect(() => parseStatusResponse(response([valid, valid]))).toThrow();
  expect(() =>
    parseStatusResponse(
      response([
        entry({ kind: "text", added: Number.MAX_SAFE_INTEGER, deleted: 0 }, "one"),
        entry({ kind: "text", added: 1, deleted: 0 }, "two"),
      ]),
    ),
  ).toThrow();
  expect(() => parseStatusResponse(response([{ ...valid, path: "../escape" }]))).toThrow();
  expect(() =>
    parseStatusResponse(response([{ ...valid, layer: "untracked", kind: "added" }])),
  ).toThrow();
  expect(() =>
    parseStatusResponse(response([{ ...valid, layer: "conflict", kind: "conflicted" }])),
  ).toThrow();
  expect(() => parseStatusResponse(response([{ ...valid, isSubmodule: true }]))).toThrow();
  expect(parseChangeCheckResponse(response([]))).toEqual({
    kind: "git",
    revision: "a".repeat(20),
    changeToken: "b".repeat(20),
  });
  expect(() => parseStatusResponse(parseChangeCheckResponse(response([])))).toThrow();
});

test("group totals include known lines and distinguish binary, excluded and unavailable entries", () => {
  const entries = [
    entry({ kind: "text", added: 12, deleted: 3 }, "one"),
    entry({ kind: "text", added: 0, deleted: 2 }, "two"),
    entry({ kind: "binary" }, "binary"),
    entry({ kind: "not_applicable", reason: "symlink" }, "link"),
    entry({ kind: "unavailable", reason: "limit" }, "large"),
  ];
  expect(summarizeChangeStats(entries)).toEqual({
    added: 12,
    deleted: 5,
    textFiles: 2,
    binaryFiles: 1,
    nonTextFiles: 1,
    unavailableFiles: 1,
  });
  expect(() =>
    summarizeChangeStats([
      entry({ kind: "text", added: Number.MAX_SAFE_INTEGER, deleted: 0 }),
      entry({ kind: "text", added: 1, deleted: 0 }),
    ]),
  ).toThrow();
});
