import { expect, test } from "bun:test";
import { parseChangeDiffBatchRequest } from "./change-diff-batch.ts";
import { parseCommitDiffBatchRequest } from "./commit-diff-batch.ts";

const boundaries = [
  {
    name: "commit",
    parse: (file: Record<string, unknown>) => parseCommitDiffBatchRequest({ files: [file] })[0],
  },
  {
    name: "Changes",
    parse: (file: Record<string, unknown>) =>
      parseChangeDiffBatchRequest({
        revision: "a".repeat(20),
        changeToken: "b".repeat(20),
        files: [{ layer: "unstaged", ...file }],
      }).files[0],
  },
];

for (const boundary of boundaries) {
  test(`${boundary.name} diff fields preserve Git paths and explicit bounded language choices`, () => {
    for (const path of ["odd\n[1].ts", "literal\\backslash😀.ts", ".gitish/file", "x".repeat(4096)])
      for (const language of [null, "text", "typescript", "x".repeat(100)])
        expect(boundary.parse({ path, language })).toMatchObject({ path, language });
  });

  test(`${boundary.name} diff fields reject missing language, malformed paths and extra fields`, () => {
    for (const language of [undefined, 1, "", "x".repeat(101)])
      expect(() => boundary.parse({ path: "file.ts", language })).toThrow();
    for (const path of [
      undefined,
      null,
      1,
      "",
      "/file",
      "../file",
      "a//b",
      "a/./b",
      ".git/config",
      "a/.git/config",
      "a\0b",
      "x".repeat(4097),
    ])
      expect(() => boundary.parse({ path, language: null })).toThrow();
    expect(() => boundary.parse({ path: "file.ts", language: null, extra: true })).toThrow();
  });
}
