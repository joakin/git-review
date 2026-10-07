import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit as git } from "../src/test-support.ts";

const artifacts = resolve("qa/.artifacts");
const fixture = resolve(artifacts, "inventory-fixture");

await mkdir(artifacts, { recursive: true });
await mkdir(fixture);
await mkdir(resolve(fixture, "src"));
await mkdir(resolve(fixture, "docs"));
git(fixture, "init", "-q");
await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'initial';\n");
await writeFile(resolve(fixture, "src/deleted.ts"), "export const old = true;\n");
await writeFile(
  resolve(fixture, "docs/old name.md"),
  "A document with enough content to identify its rename.\n",
);
git(fixture, "add", ".");
git(fixture, "commit", "-qm", "baseline");

await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'staged';\n");
git(fixture, "add", "src/view.ts");
await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'working tree';\n");
git(fixture, "mv", "docs/old name.md", "docs/new name.md");
git(fixture, "rm", "-q", "src/deleted.ts");
await writeFile(resolve(fixture, "src/new feature.ts"), "export const newFeature = true;\n");
await writeFile(
  resolve(fixture, "src/long-line.ts"),
  `export const longLine = "${"0123456789abcdef".repeat(24)}";\n`,
);
await writeFile(
  resolve(fixture, "src/wide-mixed.ts"),
  `export const wide = "${"0123456789abcdef".repeat(24)}";\nexport const short = true;\n`,
);
await writeFile(resolve(fixture, "src/math.c"), "int main(void) { return 0; }\n");
await writeFile(
  resolve(fixture, "src/tall-review.ts"),
  Array.from({ length: 180 }, (_, index) => `export const item${index + 1} = ${index + 1};\n`).join(
    "",
  ),
);

console.log(`Inventory fixture ready: ${fixture}`);
