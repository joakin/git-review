import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifacts = resolve("qa/.artifacts");
const fixture = resolve(artifacts, "inventory-fixture");

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
}

await mkdir(artifacts, { recursive: true });
await mkdir(fixture);
await mkdir(resolve(fixture, "src"));
await mkdir(resolve(fixture, "docs"));
git("init", "-q");
await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'initial';\n");
await writeFile(resolve(fixture, "src/deleted.ts"), "export const old = true;\n");
await writeFile(resolve(fixture, "docs/old name.md"), "A document with enough content to identify its rename.\n");
git("add", ".");
git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");

await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'staged';\n");
git("add", "src/view.ts");
await writeFile(resolve(fixture, "src/view.ts"), "export const view = 'working tree';\n");
git("mv", "docs/old name.md", "docs/new name.md");
git("rm", "-q", "src/deleted.ts");
await writeFile(resolve(fixture, "src/new feature.ts"), "export const newFeature = true;\n");
await writeFile(resolve(fixture, "src/long-line.ts"), `export const longLine = "${"0123456789abcdef".repeat(24)}";\n`);

console.log(`Inventory fixture ready: ${fixture}`);
