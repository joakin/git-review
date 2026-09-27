import { readFile } from "node:fs/promises";

const tokenSource = await readFile("src/client/design-tokens.css", "utf8");
const styleSource = await readFile("src/client/styles.css", "utf8");
const declarations = new Set(
  [...tokenSource.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
);
const references = new Set(
  [...`${tokenSource}\n${styleSource}`.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]),
);
const missing = [...references].filter((reference) => !declarations.has(reference)).sort();

if (missing.length > 0) {
  console.error(`Undefined CSS tokens: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`CSS tokens resolved (${references.size} references)`);
}
