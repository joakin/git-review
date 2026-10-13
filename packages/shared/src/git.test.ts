import { expect, test } from "bun:test";
import { parseCommitDiff, type CommitDiff } from "./git.ts";

test("immutable commit diff responses reject mutable states and preserve supported variants", () => {
  for (const kind of ["stale", "conflict"]) {
    expect(() => parseCommitDiff({ kind })).toThrow("Expected an immutable commit diff");
  }
  const supported: CommitDiff[] = [
    { kind: "text", syntax: { kind: "plain", reason: "unavailable" }, hunks: [] },
    { kind: "binary", reason: "binary" },
    { kind: "too_large" },
    { kind: "media", old: { kind: "absent" }, new: { kind: "absent" } },
  ];
  for (const diff of supported) expect(parseCommitDiff(diff)).toEqual(diff);
});
