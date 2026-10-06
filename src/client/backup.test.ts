import { expect, test } from "bun:test";
import {
  applyReviewBackup,
  createReviewBackup,
  parseReviewBackup,
  type ReviewBackup,
} from "./backup.ts";
import { withTestStorage } from "./storage-test-support.ts";
import { commentStoragePrefix, emptyCommentStore, type DraftComment } from "./comments.ts";
import {
  defaultAppearance,
  defaultCodeTypography,
  emptyWorkspace,
  languageStoragePrefix,
  openCardsStoragePrefix,
  validateAppearance,
  validateCodeTypography,
} from "./storage.ts";

const rootPath = "/approved/root";
const projectPath = `${rootPath}/project : #?% 雪`;
const drafts = (["staged", "unstaged", "untracked"] as const).map((layer): DraftComment => ({
  id: layer,
  anchor: {
    kind: "diff",
    layer,
    path: "src/main.ts",
    side: "new",
    line: 1,
    sourceText: "const value = 1;",
    before: null,
    after: null,
  },
  subject: { kind: "line" },
  body: "Review this value",
  createdAt: 1,
  updatedAt: 1,
  state: "current",
}));
const store = {
  ...emptyCommentStore(projectPath),
  drafts,
  history: [{ id: "copy", copiedAt: 2, text: "Exact previous feedback  \n", comments: drafts }],
};
const valid: ReviewBackup = {
  version: 6,
  rootPath,
  workspace: emptyWorkspace(rootPath),
  wrap: true,
  codeTypography: defaultCodeTypography,
  appearance: defaultAppearance,
  comments: [store],
  openCards: [{ projectPath, keys: ["staged:src/main.ts"] }],
  languages: [{ projectPath, path: "src/main.ts", language: "typescript" }],
};

test("current path-based backups retain every review layer and exact history", () => {
  expect(parseReviewBackup(JSON.parse(JSON.stringify(valid)), rootPath)).toEqual(valid);
  for (const version of [1, 2, 3, 4, 5, 7])
    expect(() => parseReviewBackup({ ...valid, version }, rootPath)).toThrow("unsupported format");
});

test("path-based import and export round-trip encoded keys and roll back failed writes", () => {
  withTestStorage((local) => {
    local.setItem("unrelated", "keep");
    const backup: ReviewBackup = {
      ...valid,
      languages: [{ projectPath, path: "odd : #?% 雪.ts", language: "text" }],
    };
    applyReviewBackup(backup);
    expect(createReviewBackup(rootPath)).toEqual(backup);
    expect(local.getItem("unrelated")).toBe("keep");
    const before = Array.from({ length: local.length }, (_, i) => local.key(i)).map((key) => [
      key,
      key === null ? null : local.getItem(key),
    ]);
    const set = local.setItem;
    let writes = 0;
    local.setItem = (key, value) => {
      if (++writes === 3) throw new Error("Quota");
      set(key, value);
    };
    expect(() =>
      applyReviewBackup({
        ...backup,
        wrap: false,
        workspace: { ...backup.workspace, recentPaths: ["new"] },
      }),
    ).toThrow("restored");
    expect(
      Array.from({ length: local.length }, (_, i) => local.key(i)).map((key) => [
        key,
        key === null ? null : local.getItem(key),
      ]),
    ).toEqual(before);
    local.setItem = set;
    local.setItem("git-review:comments:v2:%XX", "{}");
    expect(() => createReviewBackup(rootPath)).toThrow();
  });
});

test("backups reject invalid ownership and duplicate project records", () => {
  expect(() => parseReviewBackup(valid, "/different/root")).toThrow();
  for (const path of [
    "aaaaaaaaaaaaaaaaaaaa",
    "relative",
    "/approved/root-sibling/project",
    "/approved/root/../outside",
    "/outside",
  ])
    expect(() =>
      parseReviewBackup({ ...valid, comments: [{ ...store, projectPath: path }] }, rootPath),
    ).toThrow();
  expect(() => parseReviewBackup({ ...valid, comments: [store, store] }, rootPath)).toThrow(
    "duplicate",
  );
  expect(() =>
    parseReviewBackup({ ...valid, languages: [...valid.languages, ...valid.languages] }, rootPath),
  ).toThrow("duplicate");
  expect(() =>
    parseReviewBackup({ ...valid, comments: [{ ...store, version: 3 }] }, rootPath),
  ).toThrow("invalid comments");
});

test("export scopes review data to the current root after switching or narrowing roots", () => {
  for (const [currentRoot, otherProject] of [
    [rootPath, `${rootPath}-sibling/project`],
    [`${rootPath}/nested`, `${rootPath}/other`],
  ] as const) {
    withTestStorage((local) => {
      const currentProject = `${currentRoot}/project`;
      const current: ReviewBackup = {
        ...valid,
        rootPath: currentRoot,
        workspace: emptyWorkspace(currentRoot),
        comments: [{ ...store, projectPath: currentProject }],
        openCards: [{ projectPath: currentProject, keys: ["unstaged:src/main.ts"] }],
        languages: [{ projectPath: currentProject, path: "src/main.ts", language: "text" }],
      };
      applyReviewBackup({
        ...valid,
        rootPath: otherProject,
        workspace: emptyWorkspace(otherProject),
        comments: [{ ...store, projectPath: otherProject }],
        openCards: [{ projectPath: otherProject, keys: ["staged:src/main.ts"] }],
        languages: [{ projectPath: otherProject, path: "src/main.ts", language: "typescript" }],
      });
      applyReviewBackup(current);
      const before = Array.from({ length: local.length }, (_, index) => local.key(index)).map(
        (key) => [key, key === null ? null : local.getItem(key)],
      );
      expect(createReviewBackup(currentRoot)).toEqual(current);
      expect(
        Array.from({ length: local.length }, (_, index) => local.key(index)).map((key) => [
          key,
          key === null ? null : local.getItem(key),
        ]),
      ).toEqual(before);
    });
  }
});

test("export still rejects malformed project keys in every review namespace", () => {
  for (const [key, value] of [
    [`${commentStoragePrefix}${encodeURIComponent("/outside/../project")}`, JSON.stringify(store)],
    [`${openCardsStoragePrefix}${encodeURIComponent("relative")}`, '{"version":1,"keys":[]}'],
    [`${languageStoragePrefix}${encodeURIComponent("/outside//project")}:src`, "text"],
  ] as const) {
    withTestStorage((local) => {
      local.setItem(key, value);
      expect(() => createReviewBackup(rootPath)).toThrow("invalid");
    });
  }
});

test("backup validation is atomic for invalid anchors and preferences", () => {
  const conflict = { ...drafts[0], anchor: { ...drafts[0]?.anchor, layer: "conflict" } };
  expect(() =>
    parseReviewBackup({ ...valid, comments: [{ ...store, drafts: [conflict] }] }, rootPath),
  ).toThrow("invalid comments");
  for (const patch of [
    { wrap: "true" },
    { appearance: null },
    { codeTypography: { ...defaultCodeTypography, fontSize: 100 } },
    { languages: [{ projectPath, path: "", language: "typescript" }] },
    { openCards: [{ projectPath, keys: [42] }] },
    { workspace: { ...valid.workspace, recentPaths: Array(9).fill("project") } },
    { openCards: [{ projectPath, keys: Array(101).fill("staged:src/main.ts") }] },
    { comments: [{ ...store, history: [{ ...store.history[0], comments: [conflict] }] }] },
  ])
    expect(() => parseReviewBackup({ ...valid, ...patch }, rootPath)).toThrow();
});

test("current typography and appearance reject invalid standalone preferences", () => {
  expect(validateCodeTypography({ version: 1, fontSize: 20, fontFamily: "courier" })).toEqual({
    version: 1,
    fontSize: 20,
    fontFamily: "courier",
  });
  expect(
    validateCodeTypography({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" }),
  ).toEqual({ version: 1, fontSize: 18, fontFamily: "jetbrains-mono" });
  for (const patch of [
    { version: 2 },
    { fontSize: 21 },
    { fontSize: 13.5 },
    { fontFamily: "serif" },
  ])
    expect(
      validateCodeTypography({ version: 1, fontSize: 12, fontFamily: "system", ...patch }),
    ).toBeNull();
  const appearance = { version: 1, appTheme: "system", codeTheme: "dark" } as const;
  expect(validateAppearance(appearance)).toEqual(appearance);
  for (const patch of [
    { version: 2 },
    { appTheme: "sepia" },
    { codeTheme: "dracula" },
    { codeTheme: null },
  ])
    expect(validateAppearance({ ...appearance, ...patch })).toBeNull();
});
