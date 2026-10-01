import { readFile } from "node:fs/promises";

const tokenSource = await readFile("src/client/design-tokens.css", "utf8");
const stylePaths: string[] = [];
for await (const path of new Bun.Glob("src/client/**/*.css").scan()) stylePaths.push(path);
const styleSources = await Promise.all(stylePaths.sort().map((path) => readFile(path, "utf8")));
const declarations = new Set(
  [...tokenSource.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
);
const references = new Set(
  [...styleSources.join("\n").matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]),
);
const missing = [...references].filter((reference) => !declarations.has(reference)).sort();

if (missing.length > 0) {
  console.error(`Undefined CSS tokens: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`CSS tokens resolved (${references.size} references)`);
}
