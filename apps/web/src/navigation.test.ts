import { describe, expect, test } from "bun:test";
import { parseNavigationSearch, routeUrl, type Route } from "./navigation.ts";

describe("browser navigation", () => {
  test("every change layer retains its navigable file destination", () => {
    for (const layer of ["staged", "unstaged", "untracked", "conflict"] as const) {
      const route: Route = {
        section: "changes",
        projectPath: "project",
        target: { kind: "file", layer, path: "file.ts" },
      };
      expect(
        parseNavigationSearch(new URL(routeUrl(route), "https://example.test").search),
      ).toEqual({
        kind: "ready",
        route,
      });
    }
  });

  test("round trips destinations with unusual names and literal search text", () => {
    const routes: Route[] = [
      { section: "projects", directory: "client work/hi #1" },
      { section: "changes", projectPath: "", target: { kind: "all" } },
      { section: "changes", projectPath: "project ü", target: { kind: "list" } },
      {
        section: "changes",
        projectPath: "project ü",
        target: { kind: "file", layer: "staged", path: "src/a ?#%\n.ts" },
      },
      {
        section: "files",
        projectPath: "project ü",
        directory: "src",
        target: { kind: "file", path: "src/a ?#%.ts", line: 170 },
      },
      {
        section: "files",
        projectPath: "project ü",
        directory: "src",
        target: { kind: "file", path: "src/literal\\backslash😀.ts", line: null },
      },
      {
        section: "search",
        projectPath: "project ü",
        query: "a+b ?#%",
        target: { kind: "file", path: "src/a ?#%.ts", line: 170 },
      },
      { section: "settings", projectPath: "project ü" },
      { section: "git", projectPath: "project ü", ref: null, target: { kind: "list" } },
      {
        section: "git",
        projectPath: "project ü",
        ref: "refs/heads/feature/ü+#",
        target: { kind: "commit", oid: "a".repeat(40) },
      },
      {
        section: "git",
        projectPath: "",
        ref: "HEAD",
        target: { kind: "commit", oid: "b".repeat(64) },
      },
    ];
    for (const route of routes)
      expect(
        parseNavigationSearch(new URL(routeUrl(route), "https://example.test").search),
      ).toEqual({ kind: "ready", route });
  });

  test("rejects duplicates, malformed values, traversal, and impossible destinations", () => {
    for (const search of [
      "?section=files&project=x&file=../secret",
      "?section=files&project=x&dir=src&file=other/a.ts",
      "?section=files&project=x&line=0",
      "?section=search&project=x&file=a.ts&line=1",
      "?section=search&project=x&q=hello&file=a.ts&line=999999999999999999",
      "?section=changes&project=x&target=list&file=a.ts",
      "?section=changes&project=x&layer=unknown&file=a.ts",
      "?section=changes&project=x&project=y",
      "?section=changes&project=x&unknown=y",
      "?section=projects&dir=%ZZ",
      "?section=files&project=%EF%BF%BD",
      "?section=git&project=x&ref=main~1",
      "?section=git&project=x&ref=refs/heads/a..b",
      "?section=git&project=x&commit=HEAD",
      "?section=git&project=x&commit=abcdef",
      "?section=git&project=x&file=a.ts",
      "?section=files&project=x&ref=HEAD",
      "?section=git&project=x&ref=HEAD&ref=HEAD",
    ])
      expect(parseNavigationSearch(search).kind).toBe("invalid");
  });

  test("an empty URL can restore tab state and harmless omissions are canonical", () => {
    expect(parseNavigationSearch("")).toEqual({ kind: "empty" });
    expect(parseNavigationSearch("?section=projects")).toEqual({
      kind: "ready",
      route: { section: "projects", directory: "" },
    });
    expect(parseNavigationSearch("?section=files&project=x&file=src/a.ts")).toEqual({
      kind: "ready",
      route: {
        section: "files",
        projectPath: "x",
        directory: "src",
        target: { kind: "file", path: "src/a.ts", line: null },
      },
    });
  });

  test("Search URLs normalize input and round trip literal Unicode without losing the target", () => {
    for (const query of ["term�", "café🦊", "-word", "a+b ?#%", "x".repeat(128), "🦊".repeat(64)]) {
      const route: Route = {
        section: "search",
        projectPath: "x",
        query,
        target: { kind: "file", path: "src/a.ts", line: 3 },
      };
      const input = new URL(routeUrl(route), "https://example.test");
      input.searchParams.set("q", ` \t${query}\n`);
      const parsed = parseNavigationSearch(input.search);
      expect(parsed).toEqual({ kind: "ready", route });
      if (parsed.kind !== "ready") throw new Error("Expected a valid Search route");
      expect(parseNavigationSearch(new URL(routeUrl(parsed.route), input).search)).toEqual(parsed);
    }
    expect(parseNavigationSearch("?section=search&project=x")).toEqual({
      kind: "ready",
      route: { section: "search", projectPath: "x", query: null, target: { kind: "results" } },
    });
  });

  test("Search URLs reject malformed UTF-8 and invalid queries before replacement decoding", () => {
    for (const encoded of [
      "%",
      "%ZZ",
      "term%FF",
      "term%C3%28",
      "term%ED%A0%80",
      "term%E2%82",
      "term\ud800",
      "\udc00b",
      "%20%09",
      "a%0Ab",
      "a%00b",
      "x".repeat(129),
      encodeURIComponent("🦊".repeat(65)),
    ]) {
      expect(parseNavigationSearch(`?section=search&project=x&q=${encoded}`).kind).toBe("invalid");
    }
    expect(parseNavigationSearch("?section=search&project=x&q=a&q=b").kind).toBe("invalid");
  });
});
