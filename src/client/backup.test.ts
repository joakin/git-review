import { expect, test } from "bun:test";
import { parseReviewBackup } from "./backup.ts";

import { validateAppearance, validateCodeTypography } from "./storage.ts";

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

const comment = {
  id: "draft",
  anchor: {
    layer: "staged",
    path: "src/main.ts",
    side: "new",
    line: 1,
    sourceText: "const value = 1;",
    before: null,
    after: null,
  },
  body: "Review this value",
  createdAt: 1,
  updatedAt: 1,
  state: "current",
} as const;
const compatibleBackups = [
  valid,
  { ...valid, version: 2, codeTypography: { version: 1, fontSize: 14, fontFamily: "system" } },
  {
    ...valid,
    version: 3,
    codeTypography: { version: 1, fontSize: 14, fontFamily: "system" },
    appearance: { version: 1, appTheme: "system", codeTheme: "light" },
  },
];

test("backup versions 1–3 preserve every reviewable layer in drafts and copy history", () => {
  const drafts = (["staged", "unstaged", "untracked"] as const).map((layer) => ({
    ...comment,
    id: layer,
    anchor: { ...comment.anchor, layer },
  }));
  const store = {
    version: 1,
    projectId: "aaaaaaaaaaaaaaaaaaaa",
    drafts,
    history: [{ id: "copy", copiedAt: 2, text: "Previous feedback", comments: drafts }],
  };
  const migrated = {
    ...store,
    version: 3 as const,
    drafts: drafts.map((draft) => ({
      ...draft,
      anchor: { ...draft.anchor, kind: "diff" as const },
      subject: { kind: "line" as const },
    })),
    history: store.history.map((entry) => ({
      ...entry,
      comments: entry.comments.map((draft) => ({
        ...draft,
        anchor: { ...draft.anchor, kind: "diff" as const },
        subject: { kind: "line" as const },
      })),
    })),
  };
  for (const backup of compatibleBackups)
    expect(parseReviewBackup({ ...backup, comments: [store] }, rootPath).comments).toEqual([
      migrated,
    ]);
});

test("backup versions 1–3 reject conflict anchors in drafts and copy history", () => {
  const conflict = { ...comment, anchor: { ...comment.anchor, layer: "conflict" } };
  const stores = [
    {
      version: 1,
      projectId: "aaaaaaaaaaaaaaaaaaaa",
      drafts: [comment, { ...conflict, id: "invalid" }],
      history: [],
    },
    {
      version: 1,
      projectId: "aaaaaaaaaaaaaaaaaaaa",
      drafts: [comment],
      history: [
        {
          id: "copy",
          copiedAt: 2,
          text: "Previous feedback",
          comments: [comment, { ...conflict, id: "invalid" }],
        },
      ],
    },
  ];
  for (const backup of compatibleBackups) {
    for (const store of stores)
      expect(() => parseReviewBackup({ ...backup, comments: [store] }, rootPath)).toThrow(
        "Backup contains invalid comments or copy history",
      );
  }
});

test("backup import accepts valid project state and rejects wrong roots or malformed records", () => {
  expect(parseReviewBackup(valid, rootPath).comments).toHaveLength(1);
  expect(() => parseReviewBackup(valid, "/different/root")).toThrow();
  expect(() =>
    parseReviewBackup(
      { ...valid, comments: [{ ...valid.comments[0], drafts: [{ body: "unanchored" }] }] },
      rootPath,
    ),
  ).toThrow();
  expect(() =>
    parseReviewBackup({ ...valid, comments: [valid.comments[0], valid.comments[0]] }, rootPath),
  ).toThrow();
  expect(() =>
    parseReviewBackup(
      {
        ...valid,
        openCards: [{ ...valid.openCards[0], keys: Array(101).fill("staged:src/main.ts") }],
      },
      rootPath,
    ),
  ).toThrow();
  expect(() =>
    parseReviewBackup(
      { ...valid, workspace: { ...valid.workspace, recentPaths: Array(9).fill("project") } },
      rootPath,
    ),
  ).toThrow();
  expect(() =>
    parseReviewBackup(
      {
        ...valid,
        languages: [
          { ...valid.languages[0], path: "%" },
          { ...valid.languages[0], path: "%" },
        ],
      },
      rootPath,
    ),
  ).toThrow();
});

test("code typography rejects invalid stored values", () => {
  expect(validateCodeTypography({ version: 1, fontSize: 20, fontFamily: "courier" })).toEqual({
    version: 1,
    fontSize: 20,
    fontFamily: "courier",
  });
  expect(
    validateCodeTypography({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" }),
  ).toEqual({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" });
  for (const value of [
    { version: 2, fontSize: 12, fontFamily: "system" },
    { version: 1, fontSize: 21, fontFamily: "system" },
    { version: 1, fontSize: 13.5, fontFamily: "system" },
    { version: 1, fontSize: 12, fontFamily: "serif" },
  ])
    expect(validateCodeTypography(value)).toBeNull();
});

test("version 2 backups require valid typography while version 1 remains importable", () => {
  const current = {
    ...valid,
    version: 2,
    codeTypography: { version: 1, fontSize: 17, fontFamily: "jetbrains-mono" },
  };
  expect(parseReviewBackup(current, rootPath)).toMatchObject({
    version: 2,
    codeTypography: current.codeTypography,
  });
  expect(parseReviewBackup(valid, rootPath).version).toBe(1);
  expect(() =>
    parseReviewBackup(
      { ...current, codeTypography: { ...current.codeTypography, fontSize: 100 } },
      rootPath,
    ),
  ).toThrow();
  expect(() => parseReviewBackup({ ...current, codeTypography: null }, rootPath)).toThrow();
});

test("appearance accepts only known combinations and version 3 backups reject bad choices", () => {
  const appearance = { version: 1, appTheme: "system", codeTheme: "dark" } as const;
  expect(validateAppearance(appearance)).toEqual(appearance);
  for (const value of [
    { ...appearance, version: 2 },
    { ...appearance, appTheme: "sepia" },
    { ...appearance, codeTheme: "dracula" },
    { ...appearance, codeTheme: null },
  ])
    expect(validateAppearance(value)).toBeNull();

  const current = {
    ...valid,
    version: 3,
    codeTypography: { version: 1, fontSize: 14, fontFamily: "system" },
    appearance,
  };
  expect(parseReviewBackup(current, rootPath)).toMatchObject({ version: 3, appearance });
  expect(() =>
    parseReviewBackup({ ...current, appearance: { ...appearance, appTheme: "sepia" } }, rootPath),
  ).toThrow("Backup appearance is invalid");
  expect(() => parseReviewBackup({ ...current, appearance: null }, rootPath)).toThrow(
    "Backup appearance is invalid",
  );
  expect(() => parseReviewBackup({ ...current, codeTypography: null }, rootPath)).toThrow(
    "Backup code typography is invalid",
  );
  expect(parseReviewBackup({ ...current, version: 2, appearance: null }, rootPath).version).toBe(2);
});
