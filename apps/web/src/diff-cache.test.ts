import { describe, expect, test } from "bun:test";
import type { DiffResult } from "@git-review/shared/api";
import {
  diffCacheKey,
  readCachedDiff,
  rememberDiff,
  type DiffCacheIdentity,
} from "./diff-cache.ts";

const identity: DiffCacheIdentity = {
  endpoint: "https://agent-a.example",
  projectPath: "cache-test",
  layer: "staged",
  path: "src/a | ?#\nü.ts",
  revision: "revision-a",
  changeToken: "token-a",
  refreshKey: 0,
  language: null,
};
const ready: DiffResult = { kind: "binary", reason: "binary" };

describe("diff cache adapter", () => {
  test("each resource, version, refresh and language field separates identities", () => {
    const changes: Partial<DiffCacheIdentity>[] = [
      { endpoint: "https://agent-b.example" },
      { projectPath: "other-project" },
      { layer: "unstaged" },
      { path: "other.ts" },
      { revision: "revision-b" },
      { changeToken: "token-b" },
      { refreshKey: 1 },
      { language: "text" },
    ];
    const key = diffCacheKey(identity);
    expect(diffCacheKey({ ...identity })).toBe(key);
    for (const change of changes) expect(diffCacheKey({ ...identity, ...change })).not.toBe(key);
    expect(diffCacheKey({ ...identity, projectPath: "a|b", path: "c" })).not.toBe(
      diffCacheKey({ ...identity, projectPath: "a", path: "b|c" }),
    );
  });

  test("stale results are excluded without replacing a reusable payload", () => {
    const key = diffCacheKey(identity);
    rememberDiff(key, { kind: "stale" });
    expect(readCachedDiff(key)).toBeNull();
    rememberDiff(key, ready);
    rememberDiff(key, { kind: "stale" });
    expect(readCachedDiff(key)).toBe(ready);
    expect(readCachedDiff(diffCacheKey({ ...identity, changeToken: "new-token" }))).toBeNull();
  });

  test("the 128-entry budget and read promotion apply to working and commit keys", () => {
    const keys = Array.from({ length: 128 }, (_, index) =>
      index % 2 === 0
        ? diffCacheKey({ ...identity, path: `entry-${index}` })
        : JSON.stringify([
            "commit",
            identity.projectPath,
            `commit-${index}`,
            "empty",
            "file.ts",
            null,
          ]),
    );
    for (const key of keys) rememberDiff(key, ready);
    const first = keys[0],
      second = keys[1],
      third = keys[2];
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Missing eviction test keys");
    rememberDiff(first, { kind: "stale" });
    rememberDiff("overflow-after-stale", ready);
    expect(readCachedDiff(first)).toBeNull();
    expect(readCachedDiff(second)).toBe(ready);
    rememberDiff("overflow-after-read", ready);
    expect(readCachedDiff(second)).toBe(ready);
    expect(readCachedDiff(third)).toBeNull();
  });

  test("the shared diff cache retains its 32 MiB byte budget", () => {
    const text = "x".repeat(512 * 1024);
    const large: DiffResult = {
      kind: "text",
      syntax: { kind: "plain", reason: "selected" },
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 1,
          lines: [
            {
              kind: "added",
              oldLine: null,
              newLine: 1,
              text,
              tokens: [{ text, role: "plain" }],
              detail: { kind: "none" },
              noNewlineAtEnd: false,
            },
          ],
        },
      ],
    };
    for (let index = 0; index < 16; index += 1) rememberDiff(`byte-budget-${index}`, large);
    // Each payload is just over 2 MiB once serialized metadata is included.
    expect(readCachedDiff("byte-budget-0")).toBeNull();
    expect(readCachedDiff("byte-budget-1")).toBe(large);
    expect(readCachedDiff("byte-budget-15")).toBe(large);
  });
});
