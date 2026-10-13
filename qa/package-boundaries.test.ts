import { expect, test } from "bun:test";
import { assertPackageImport, type PackageBoundary } from "./package-boundaries.ts";

const web: PackageBoundary = {
  name: "@git-review/web",
  directory: "/repo/apps/web",
  dependencies: new Set(["preact", "@git-review/shared"]),
  sharedExports: new Set(["./api"]),
};
const file = "/repo/apps/web/src/view.tsx";

test("production web imports stay in their own source or declared dependencies", () => {
  for (const specifier of [
    "./component.tsx",
    "./nested/../component.tsx",
    "preact/hooks",
    "@git-review/shared/api",
  ])
    expect(() => assertPackageImport(web, file, specifier)).not.toThrow();
  for (const specifier of [
    "../../agent/src/api.ts",
    "../../../qa/test-support.ts",
    "../../../packages/shared/src/api.ts",
    "shiki",
    "node:fs",
    "fs",
    "bun",
  ])
    expect(() => assertPackageImport(web, file, specifier)).toThrow();
});

test("declaring the other app does not permit production app-to-app imports", () => {
  const owner = { ...web, dependencies: new Set([...web.dependencies, "@git-review/agent"]) };
  expect(() => assertPackageImport(owner, file, "@git-review/agent/api")).toThrow();
});

test("shared consumption requires an explicit public subpath", () => {
  for (const specifier of [
    "@git-review/shared",
    "@git-review/shared/src/api.ts",
    "@git-review/shared/missing",
  ])
    expect(() => assertPackageImport(web, file, specifier)).toThrow();
});

test("only the agent may consume host runtime imports; shared stays dependency-free", () => {
  const agent = { ...web, name: "@git-review/agent", directory: "/repo/apps/agent" };
  expect(() => assertPackageImport(agent, "/repo/apps/agent/src/api.ts", "node:fs")).not.toThrow();
  const shared = {
    ...web,
    name: "@git-review/shared",
    directory: "/repo/packages/shared",
    dependencies: new Set<string>(),
  };
  for (const specifier of ["preact", "shiki", "node:fs", "bun"])
    expect(() =>
      assertPackageImport(shared, "/repo/packages/shared/src/api.ts", specifier),
    ).toThrow();
});
