import { expect, test } from "bun:test";
import {
  discardObsoleteProjectData,
  readSavedWorkspace,
  readOpenCards,
  readLanguageOverride,
  saveLanguageOverride,
  saveOpenCards,
  saveWorkspace,
  withSelectedPath,
  parseActiveProject,
  readActiveProject,
  saveActiveProject,
  parseOpenCards,
  parseSavedWorkspace,
  parseWrapPreference,
} from "./storage.ts";
import { withTestStorage } from "./storage-test-support.ts";
import { parseNavigationSearch, routeUrl, type Route } from "./navigation.ts";
import {
  emptyCommentStore,
  readCommentStore,
  saveCommentStore,
  type CommentStore,
} from "./comments.ts";

test("review state follows the absolute folder when the approved root and relative route change", () => {
  withTestStorage(() => {
    const projectPath = "/approved/root/project";
    const store: CommentStore = {
      ...emptyCommentStore(projectPath),
      drafts: [
        {
          id: "draft",
          anchor: {
            kind: "file",
            source: "worktree",
            path: "notes.txt",
            line: 1,
            sourceText: "A note",
            before: null,
            after: null,
          },
          subject: { kind: "line" },
          body: "Keep this feedback",
          createdAt: 1,
          updatedAt: 1,
          state: "current",
        },
      ],
      history: [{ id: "copy", copiedAt: 2, text: "Earlier copied feedback", comments: [] }],
    };
    const cards = new Set(["staged:notes.txt"]);
    saveCommentStore(store);
    saveOpenCards(projectPath, cards);
    saveLanguageOverride(projectPath, "notes.txt", "text");
    saveWorkspace({ version: 4, rootPath: "/approved/root", recentPaths: ["project"] });
    expect(readSavedWorkspace(projectPath).recentPaths).toEqual([]);
    saveWorkspace({ version: 4, rootPath: projectPath, recentPaths: [""] });
    expect(readSavedWorkspace("/approved/root").recentPaths).toEqual([]);
    expect(readCommentStore(projectPath)).toEqual(store);
    expect(readOpenCards(projectPath)).toEqual(cards);
    expect(readLanguageOverride(projectPath, "notes.txt")).toBe("text");
    const differentFolder = "/different/root/project";
    expect(readCommentStore(differentFolder).drafts).toEqual([]);
    expect(readCommentStore(differentFolder).history).toEqual([]);
    expect(readOpenCards(differentFolder).size).toBe(0);
    expect(readLanguageOverride(differentFolder, "notes.txt")).toBeNull();
  });
});

test("obsolete project data is discarded without reading it or clearing unrelated settings", () => {
  withTestStorage((local, session) => {
    const obsolete = [
      "git-review:workspace:v2",
      "git-review:workspace:v3",
      "git-review:comments:v1:hash",
      "git-review:open-cards:v1:hash",
      "git-review:language:v1:hash:file",
    ];
    for (const key of obsolete) local.setItem(key, "malformed old value");
    session.setItem("git-review:active-project:v1", "old tab");
    local.setItem("unrelated", "keep");
    local.setItem("git-review:appearance:v1", "keep appearance");
    local.setItem("git-review:comments:v2:%2Froot%2Fnew", "keep new data");
    session.setItem("git-review:active-project:v2", "keep new tab");
    const get = local.getItem;
    local.getItem = (key) => {
      if (obsolete.includes(key)) throw new Error("Must not read old data");
      return get(key);
    };
    expect(readSavedWorkspace("/root")).toEqual({ version: 4, rootPath: "/root", recentPaths: [] });
    expect(obsolete.every((key) => get(key) === null)).toBe(true);
    expect(session.getItem("git-review:active-project:v1")).toBeNull();
    expect(local.getItem("unrelated")).toBe("keep");
    expect(local.getItem("git-review:appearance:v1")).toBe("keep appearance");
    expect(local.getItem("git-review:comments:v2:%2Froot%2Fnew")).toBe("keep new data");
    expect(session.getItem("git-review:active-project:v2")).toBe("keep new tab");
    local.removeItem = () => {
      throw new Error("Storage denied");
    };
    expect(() => discardObsoleteProjectData()).not.toThrow();
  });
});

test("invalid stored workspace and session data cannot become an active folder", () => {
  const rootPath = "/approved/root";
  expect(
    parseSavedWorkspace({ version: 4, rootPath, recentPaths: ["safe", 42] }, rootPath).recentPaths,
  ).toEqual([]);
  expect(
    parseSavedWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["src"] }, rootPath)
      .recentPaths,
  ).toEqual([]);
  expect(
    parseSavedWorkspace({ version: 4, rootPath, recentPaths: ["src"] }, "/different/root")
      .recentPaths,
  ).toEqual([]);
  expect(parseActiveProject({ version: 2, rootPath, activePath: "src" }, rootPath)).toBe("src");
  expect(parseActiveProject({ version: 2, rootPath, activePath: 42 }, rootPath)).toBeNull();
  expect(
    parseActiveProject({ version: 2, rootPath, activePath: "src" }, "/different/root"),
  ).toBeNull();
});

test("malformed relative folders cannot be restored from recents or tab storage", () => {
  const rootPath = "/approved/root";
  for (const path of [
    "../escape",
    "/absolute",
    "safe//child",
    "safe/",
    "./safe",
    "safe/../escape",
    "safe/./child",
    ".",
    "..",
    "safe\0child",
    "safe\ufffd",
    "safe\ud800",
    "safe\udc00",
    "x".repeat(4097),
  ]) {
    withTestStorage((local, session) => {
      local.setItem(
        "git-review:workspace:v4",
        JSON.stringify({ version: 4, rootPath, recentPaths: ["valid", path] }),
      );
      session.setItem(
        "git-review:active-project:v2",
        JSON.stringify({ version: 2, rootPath, activePath: path }),
      );
      expect(readSavedWorkspace(rootPath).recentPaths).toEqual([]);
      expect(readActiveProject(rootPath)).toBeNull();
    });
  }
});

test("valid stored folders round-trip through navigation, including the root and unusual names", () => {
  const rootPath = "/approved/root";
  for (const path of [
    "",
    "src",
    "project ü",
    "nested/名字 : #?%",
    "emoji😀",
    "notes\nfolder",
    "a...b",
    "x".repeat(4096),
  ]) {
    const saved = parseSavedWorkspace(
      { version: 4, rootPath, recentPaths: [path, path] },
      rootPath,
    );
    expect(saved.recentPaths).toEqual([path]);
    expect(parseActiveProject({ version: 2, rootPath, activePath: path }, rootPath)).toBe(path);
    const route: Route = { section: "changes", projectPath: path, target: { kind: "all" } };
    expect(parseNavigationSearch(new URL(routeUrl(route), "https://example.test").search)).toEqual({
      kind: "ready",
      route,
    });
  }
});

test("invalid tab selections preserve the last accepted folder and root selection remains valid", () => {
  withTestStorage(() => {
    const rootPath = "/approved/root";
    saveActiveProject(rootPath, "valid");
    for (const path of ["../escape", "/absolute", "safe//child", "safe/", "safe\ud800"]) {
      saveActiveProject(rootPath, path);
      expect(readActiveProject(rootPath)).toBe("valid");
    }
    saveActiveProject(rootPath, "");
    expect(readActiveProject(rootPath)).toBe("");
    saveActiveProject(rootPath, null);
    expect(readActiveProject(rootPath)).toBeNull();
  });
});

test("only a saved boolean can change the default code wrapping", () => {
  expect(parseWrapPreference(false)).toBe(false);
  expect(parseWrapPreference(true)).toBe(true);
  expect(parseWrapPreference("false")).toBe(true);
});

test("saved open cards discard malformed entries and duplicates", () => {
  expect(
    parseOpenCards({
      version: 1,
      keys: ["staged:src/a.ts", "staged:src/a.ts", "unstaged:src/a.ts"],
    }),
  ).toEqual(["staged:src/a.ts", "unstaged:src/a.ts"]);
  expect(parseOpenCards({ version: 1, keys: ["staged:src/a.ts", 42] })).toEqual([]);
});

test("selecting a folder moves it to the front and bounds recent history", () => {
  const rootPath = "/approved/root";
  const current = parseSavedWorkspace(
    {
      version: 4,
      rootPath,
      recentPaths: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
    },
    rootPath,
  );
  const next = withSelectedPath(current, "three");
  expect(next.recentPaths[0]).toBe("three");
  expect(next.recentPaths).toHaveLength(8);
  expect(new Set(next.recentPaths).size).toBe(8);
});
