import { expect, test } from "bun:test";
import { parseActiveProject, parseLegacyWorkspace, parseOpenCards, parseSavedWorkspace, parseWrapPreference, withSelectedPath } from "./storage.ts";

test("invalid stored workspace and session data cannot become an active folder", () => {
  const rootPath = "/approved/root";
  expect(parseSavedWorkspace({ version: 3, rootPath, recentPaths: ["safe", 42] }, rootPath).recentPaths).toEqual([]);
  expect(parseSavedWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["src"] }, rootPath).recentPaths).toEqual([]);
  expect(parseSavedWorkspace({ version: 3, rootPath, recentPaths: ["src"] }, "/different/root").recentPaths).toEqual([]);
  expect(parseActiveProject({ version: 1, rootPath, activePath: "src" }, rootPath)).toBe("src");
  expect(parseActiveProject({ version: 1, rootPath, activePath: 42 }, rootPath)).toBeNull();
  expect(parseActiveProject({ version: 1, rootPath, activePath: "src" }, "/different/root")).toBeNull();
  expect(parseLegacyWorkspace({ version: 2, rootPath, activePath: 42, recentPaths: ["src"] }, rootPath)).toBeNull();
  expect(parseLegacyWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["safe", 42] }, rootPath)).toBeNull();
  expect(parseLegacyWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["src"] }, rootPath)).toEqual({ activePath: "src", recentPaths: ["src"] });
});

test("only a saved boolean can change the default code wrapping", () => {
  expect(parseWrapPreference(false)).toBe(false);
  expect(parseWrapPreference(true)).toBe(true);
  expect(parseWrapPreference("false")).toBe(true);
});

test("saved open cards discard malformed entries and duplicates", () => {
  expect(parseOpenCards({ version: 1, keys: ["staged:src/a.ts", "staged:src/a.ts", "unstaged:src/a.ts"] })).toEqual(["staged:src/a.ts", "unstaged:src/a.ts"]);
  expect(parseOpenCards({ version: 1, keys: ["staged:src/a.ts", 42] })).toEqual([]);
});

test("selecting a folder moves it to the front and bounds recent history", () => {
  const rootPath = "/approved/root";
  const current = parseSavedWorkspace({
    version: 3,
    rootPath,
    recentPaths: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
  }, rootPath);
  const next = withSelectedPath(current, "three");
  expect(next.recentPaths[0]).toBe("three");
  expect(next.recentPaths).toHaveLength(8);
  expect(new Set(next.recentPaths).size).toBe(8);
});
