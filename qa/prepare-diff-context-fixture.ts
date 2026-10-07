import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit } from "../src/test-support.ts";

const directory = resolve("qa/.artifacts/context-fixture");
await mkdir(directory);
testGit(directory, "init", "-q");
const base = Array.from({ length: 180 }, (_, i) =>
  i === 0
    ? "/* Context explanation"
    : i === 43
      ? "*/"
      : i < 43
        ? ` * The source context on line ${i + 1} explains the surrounding code.`
        : i % 7 === 0
          ? ""
          : `export const line${i + 1} = ${i + 1}; // ${"Surrounding code helps understand the change. ".repeat(3)}`,
);
await writeFile(resolve(directory, "example.ts"), base.join("\n") + "\n");
testGit(directory, "add", ".");
testGit(directory, "commit", "-qm", "context baseline");
const index = base.map((line, i) =>
  i === 49 || i === 129 ? line.replace(" = ", " = 100 + ") : line,
);
index.splice(50, 0, "export const insertedA = 1;", "export const insertedB = 2;");
await writeFile(resolve(directory, "example.ts"), index.join("\n") + "\n");
testGit(directory, "add", ".");
await writeFile(
  resolve(directory, "example.ts"),
  index.map((line, i) => (i === 99 ? line.replace(" = ", " = 200 + ") : line)).join("\n") + "\n",
);
console.log(`Context fixture ready: ${directory}`);
