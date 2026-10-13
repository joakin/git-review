import { isBuiltin } from "node:module";
import { relative, resolve, sep } from "node:path";

export type PackageBoundary = {
  name: string;
  directory: string;
  dependencies: ReadonlySet<string>;
  sharedExports: ReadonlySet<string>;
};

export function assertPackageImport(owner: PackageBoundary, file: string, specifier: string): void {
  const fail = (reason: string): never => {
    throw new Error(`${file}: ${specifier} — ${reason}`);
  };
  if (specifier.startsWith(".")) {
    const target = relative(resolve(owner.directory, "src"), resolve(file, "..", specifier));
    if (target === ".." || target.startsWith(`..${sep}`) || target.startsWith(sep))
      fail("relative imports must stay inside the owning source directory");
    return;
  }
  if (isBuiltin(specifier) || specifier === "bun" || specifier.startsWith("bun:")) {
    if (owner.name !== "@git-review/agent") fail("host runtime imports belong to the agent");
    return;
  }
  const dependency = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  if (dependency === undefined || !owner.dependencies.has(dependency))
    return fail("import must be a declared production dependency");
  if (dependency.startsWith("@git-review/")) {
    if (dependency !== "@git-review/shared") fail("production apps cannot import each other");
    const subpath = `.${specifier.slice(dependency.length)}`;
    if (!owner.sharedExports.has(subpath)) fail("use an explicit shared subpath export");
  }
}
