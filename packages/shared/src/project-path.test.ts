import { expect, test } from "bun:test";
import { parseFileReadResponse, parseProjectResponse } from "./api.ts";
import { isProjectPath, projectApiUrl } from "./project-path.ts";

test("absolute project identity and URL fields round-trip without ambiguous path segments", () => {
  const projectPath = "/root/project : #?% 雪";
  const fields = {
    path: "literal\\folder/odd #?% file.svg",
    source: "worktree",
    projectPath: "/incorrect",
  };
  const url = new URL(projectApiUrl("/file", projectPath, fields), "http://localhost");
  expect(url.pathname).toBe("/api/project/file");
  expect(url.searchParams.getAll("projectPath")).toEqual([projectPath]);
  expect(url.searchParams.get("path")).toBe(fields.path);
  expect(isProjectPath("/")).toBe(true);
  for (const invalid of [
    null,
    "relative",
    "/root//project",
    "/root/../project",
    "/root/./project",
    "/root/project/",
    "/root/\0project",
    "/root/\ud800",
    "/" + "x".repeat(4096),
  ])
    expect(isProjectPath(invalid)).toBe(false);
  expect(() =>
    parseProjectResponse({
      project: { id: "a".repeat(20), path: "project", absolutePath: projectPath, name: "Project" },
    }),
  ).toThrow();
});

test("media response parsing requires one absolute project identity in a same-origin raw URL", () => {
  const file = (url: string) => ({
    kind: "media",
    path: "art.svg",
    byteLength: 100,
    resource: { kind: "image", mimeType: "image/svg+xml", byteLength: 100, url },
  });
  const projectPath = "/root/project #?% 雪";
  const url = projectApiUrl("/raw/file", projectPath, { path: "art.svg", version: "a".repeat(20) });
  expect(parseFileReadResponse(file(url)).kind).toBe("media");
  for (const invalid of [
    "/api/project/raw/file?path=art.svg",
    "/api/project/raw/file?projectPath=relative",
    url + "&projectPath=" + encodeURIComponent(projectPath),
    url + "#fragment",
    "https://other.example" + url,
    "/api/projects/" + "a".repeat(20) + "/raw/file?path=art.svg",
  ])
    expect(() => parseFileReadResponse(file(invalid))).toThrow();
});
