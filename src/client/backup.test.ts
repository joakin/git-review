import { expect, test } from "bun:test";
import { parseReviewBackup } from "./backup.ts";

const rootPath = "/approved/root";
const valid = {
  version: 1,
  rootPath,
  workspace: { version: 3, rootPath, recentPaths: ["project"] },
  wrap: true,
  comments: [{ version: 1, projectId: "aaaaaaaaaaaaaaaaaaaa", drafts: [], history: [] }],
  openCards: [{ projectId: "aaaaaaaaaaaaaaaaaaaa", keys: ["staged:src/main.ts"] }],
  languages: [{ projectId: "aaaaaaaaaaaaaaaaaaaa", path: "src/main.ts", language: "typescript" }],
};

test("backup import accepts valid project state and rejects wrong roots or malformed records", () => {
  expect(parseReviewBackup(valid, rootPath).comments).toHaveLength(1);
  expect(() => parseReviewBackup(valid, "/different/root")).toThrow();
  expect(() => parseReviewBackup({ ...valid, comments: [{ ...valid.comments[0], drafts: [{ body: "unanchored" }] }] }, rootPath)).toThrow();
  expect(() => parseReviewBackup({ ...valid, comments: [valid.comments[0], valid.comments[0]] }, rootPath)).toThrow();
  expect(() => parseReviewBackup({ ...valid, openCards: [{ ...valid.openCards[0], keys: Array(101).fill("staged:src/main.ts") }] }, rootPath)).toThrow();
  expect(() => parseReviewBackup({ ...valid, workspace: { ...valid.workspace, recentPaths: Array(9).fill("project") } }, rootPath)).toThrow();
  expect(() => parseReviewBackup({ ...valid, languages: [{ ...valid.languages[0], path: "%" }, { ...valid.languages[0], path: "%" }] }, rootPath)).toThrow();
});
