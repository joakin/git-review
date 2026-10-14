import { expect, test } from "bun:test";
import { createBrowserData, memoryDataStorage } from "./browser-data.ts";
import { emptyCommentStore } from "./comments.ts";
import { projectResourceKey } from "./agent-project.ts";

test("equal paths on two persistent owners keep comments, preferences, recents and tab restoration separate", () => {
  const data = createBrowserData(memoryDataStorage(), memoryDataStorage());
  const a = data.projectState("https://a.example");
  const b = data.projectState("https://b.example");
  const path = "/workspace/repo";
  const value = {
    ...emptyCommentStore(path),
    history: [{ id: "a".repeat(32), copiedAt: 1, text: "Exact history from A", comments: [] }],
  };
  a.saveComments(value);
  a.saveOpenCards(path, new Set(["unstaged:file.ts"]));
  a.saveLanguageOverride(path, "file.ts", "text");
  a.saveWorkspace({ version: 4, rootPath: "/workspace", recentPaths: ["repo"] });
  a.saveActiveProject("/workspace", "repo");
  expect(a.readComments(path)).toEqual(value);
  expect(b.readComments(path).history).toEqual([]);
  expect(b.readOpenCards(path).size).toBe(0);
  expect(b.readLanguageOverride(path, "file.ts")).toBeNull();
  expect(b.readWorkspace("/workspace").recentPaths).toEqual([]);
  expect(b.readActiveProject("/workspace")).toBeNull();
  const copy = a.readOpenCards(path);
  copy.clear();
  expect(a.readOpenCards(path).size).toBe(1);
  expect(projectResourceKey({ endpoint: "https://a.example", projectPath: path }, "refs")).not.toBe(
    projectResourceKey({ endpoint: "https://b.example", projectPath: path }, "refs"),
  );
});
