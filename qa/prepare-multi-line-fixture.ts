import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit } from "../src/test-support.ts";

const fixture = resolve("qa/.artifacts/multi-line-fixture");
await mkdir(resolve("qa/.artifacts"), { recursive: true });
await mkdir(fixture);
await mkdir(resolve(fixture, "src"));
testGit(fixture, "init", "-q");
await writeFile(
  resolve(fixture, "src/range.ts"),
  [
    "export function review(value: number) {",
    "  const original = value + 1;",
    "  const before = original * 2;",
    "",
    "  return before;",
    "}",
    "",
  ].join("\n"),
);
await writeFile(
  resolve(fixture, "src/long.ts"),
  Array.from({ length: 140 }, (_, index) =>
    index === 65 ? "" : `export const line${index + 1} = 'repeat 🦊 repeat';`,
  ).join("\n"),
);
testGit(fixture, "add", ".");
testGit(fixture, "commit", "-qm", "Multi-line feedback baseline");
await writeFile(
  resolve(fixture, "src/range.ts"),
  [
    "export function review(value: number) {",
    "  const replacement = value + 2;",
    "  const adjusted = replacement * 3;",
    "  const explanation = 'A longer source line that wraps on a phone and keeps the selected fragment precise. 🦊';",
    "",
    "  return adjusted;",
    "}",
    "",
  ].join("\n"),
);
console.log(`Multi-line fixture ready: ${fixture}`);
