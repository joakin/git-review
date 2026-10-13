import { expect, test } from "bun:test";
import { parseDeploymentBasePath } from "./deployment.ts";
import { parseNavigationSearch, routeUrl } from "./navigation.ts";

test("deployment bases normalize root and nested plain URL paths", () => {
  for (const [value, expected] of [
    ["/", "/"],
    ["/git-review", "/git-review/"],
    ["/tools/review.v1/", "/tools/review.v1/"],
  ] as const)
    expect(parseDeploymentBasePath(value)).toBe(expected);
});

test("deployment bases reject origins, ambiguous paths and template injection", () => {
  for (const value of [
    undefined,
    null,
    4,
    "",
    "review/",
    "//host/",
    "https://example.test/",
    "/./",
    "/a/../",
    "/a//b",
    "/a\\b/",
    "/a?b",
    "/a#b",
    "/%2f/",
    "/a b/",
    '/a"/',
    "/雪/",
    "/" + "x".repeat(512),
  ])
    expect(() => parseDeploymentBasePath(value)).toThrow();
});

test("query deep links keep their deployment path and all navigation fields", () => {
  const route = {
    section: "search",
    projectPath: "folder #?",
    query: "hello",
    target: { kind: "file", path: "src/a.ts", line: 7 },
  } as const;
  const url = new URL(routeUrl(route, "/tools/review/"), "https://example.test");
  expect(url.pathname).toBe("/tools/review/");
  expect(parseNavigationSearch(url.search)).toEqual({ kind: "ready", route });
});
