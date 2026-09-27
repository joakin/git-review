import { expect, test } from "bun:test";
import { parseSavedWorkspace, withSelectedPath } from "./storage.ts";

test("invalid stored workspace data cannot become an active folder", () => {
  const rootPath = "/approved/root";
  expect(parseSavedWorkspace({ version: 2, rootPath, activePath: 42, recentPaths: ["src"] }, rootPath).activePath).toBeNull();
  expect(parseSavedWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["safe", 42] }, rootPath).recentPaths).toEqual([]);
  expect(parseSavedWorkspace({ version: 1, rootPath, activePath: "src", recentPaths: ["src"] }, rootPath).activePath).toBeNull();
  expect(parseSavedWorkspace({ version: 2, rootPath, activePath: "src", recentPaths: ["src"] }, "/different/root").activePath).toBeNull();
});

test("selecting a folder moves it to the front and bounds recent history", () => {
  const rootPath = "/approved/root";
  const current = parseSavedWorkspace({
    version: 2,
    rootPath,
    activePath: "old",
    recentPaths: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
  }, rootPath);
  const next = withSelectedPath(current, "three");
  expect(next.activePath).toBe("three");
  expect(next.recentPaths[0]).toBe("three");
  expect(next.recentPaths).toHaveLength(8);
  expect(new Set(next.recentPaths).size).toBe(8);
});
