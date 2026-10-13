import { API } from "typescript/unstable/async";
import { isStringLiteral } from "typescript/unstable/ast";
import { resolve } from "node:path";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { assertPackageImport, type PackageBoundary } from "./package-boundaries.ts";

const definitions = [
  {
    name: "@git-review/web",
    directory: "apps/web",
    configs: ["tsconfig.json", "tsconfig.sw.json"],
  },
  { name: "@git-review/agent", directory: "apps/agent", configs: ["tsconfig.json"] },
  { name: "@git-review/shared", directory: "packages/shared", configs: ["tsconfig.json"] },
];

const sharedManifest = expectRecord(
  await Bun.file("packages/shared/package.json").json(),
  "shared manifest",
);
const sharedExports = new Set(
  Object.keys(expectRecord(sharedManifest["exports"], "shared exports")),
);
const api = new API();
let checked = 0;
try {
  const snapshot = await api.updateSnapshot({
    openProjects: definitions.flatMap((definition) =>
      definition.configs.map((config) => resolve(definition.directory, config)),
    ),
  });
  for (const definition of definitions) {
    const manifest = expectRecord(
      await Bun.file(resolve(definition.directory, "package.json")).json(),
      "workspace manifest",
    );
    if (expectString(manifest["name"], "workspace name") !== definition.name)
      throw new Error(`Unexpected workspace name: ${definition.directory}`);
    const dependencies = expectRecord(manifest["dependencies"] ?? {}, "production dependencies");
    if (definition.name === "@git-review/shared" && Object.keys(dependencies).length !== 0)
      throw new Error("Shared source must have no runtime dependencies");
    const owner: PackageBoundary = {
      name: definition.name,
      directory: resolve(definition.directory),
      dependencies: new Set(Object.keys(dependencies)),
      sharedExports,
    };
    for (const dependency of owner.dependencies)
      if (dependency.startsWith("@git-review/") && dependency !== "@git-review/shared")
        throw new Error(`${definition.directory}: production apps cannot depend on each other`);
    for (const config of definition.configs) {
      const configPath = resolve(definition.directory, config);
      const project = snapshot.getProject(configPath);
      if (project === undefined) throw new Error(`Missing compiler project: ${configPath}`);
      for (const file of project.rootFiles) {
        const source = await project.program.getSourceFile(file);
        if (source === undefined) throw new Error(`Missing compiler source: ${file}`);
        for (const imported of source.imports) {
          if (!isStringLiteral(imported)) throw new Error(`Unsupported import in ${file}`);
          assertPackageImport(owner, file, imported.text);
        }
        checked += 1;
      }
    }
  }
  await snapshot.dispose();
} finally {
  await api.close();
}
console.log(
  `Production package boundaries passed (${checked} source files, including type imports)`,
);
