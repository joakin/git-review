import { expect, test } from "bun:test";
import { parseReviewBackup } from "./backup.ts";
import { validateCodeTypography } from "./storage.ts";

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

test("code typography rejects invalid stored values", () => {
  expect(validateCodeTypography({ version: 1, fontSize: 20, fontFamily: "courier" })).toEqual({ version: 1, fontSize: 20, fontFamily: "courier" });
  expect(validateCodeTypography({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" })).toEqual({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" });
  for (const value of [
    { version: 2, fontSize: 12, fontFamily: "system" },
    { version: 1, fontSize: 21, fontFamily: "system" },
    { version: 1, fontSize: 13.5, fontFamily: "system" },
    { version: 1, fontSize: 12, fontFamily: "serif" },
  ]) expect(validateCodeTypography(value)).toBeNull();
});

test("version 2 backups require valid typography while version 1 remains importable", () => {
  const current = { ...valid, version: 2, codeTypography: { version: 1, fontSize: 17, fontFamily: "jetbrains-mono" } };
  expect(parseReviewBackup(current, rootPath)).toMatchObject({ version: 2, codeTypography: current.codeTypography });
  expect(parseReviewBackup(valid, rootPath).version).toBe(1);
  expect(() => parseReviewBackup({ ...current, codeTypography: { ...current.codeTypography, fontSize: 100 } }, rootPath)).toThrow();
  expect(() => parseReviewBackup({ ...current, codeTypography: null }, rootPath)).toThrow();
});
