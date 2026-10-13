import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit as git } from "./test-support.ts";

const directory = resolve("qa/.artifacts/line-counts-fixture");
await mkdir(directory);
await mkdir(resolve(directory, "src"));
await mkdir(resolve(directory, "docs"));
git(directory, "init", "-q");
await writeFile(
  resolve(directory, "src/view.ts"),
  "export const view = 'initial';\nexport const stable = true;\n",
);
await writeFile(
  resolve(directory, "src/deleted.ts"),
  "export const old = true;\nexport const unused = 1;\n",
);
await writeFile(resolve(directory, "src/mode.ts"), "export const mode = true;\n");
await writeFile(
  resolve(directory, "docs/old name.md"),
  "A document whose content stays the same when renamed.\n",
);
git(directory, "add", ".");
git(directory, "commit", "-qm", "line count baseline");
await writeFile(
  resolve(directory, "src/view.ts"),
  "export const view = 'staged';\nexport const stable = true;\nexport const added = 1;\nexport const more = 2;\n",
);
await chmod(resolve(directory, "src/mode.ts"), 0o755);
git(directory, "add", ".");
git(directory, "rm", "-q", "src/deleted.ts");
git(directory, "mv", "docs/old name.md", "docs/new name.md");
await writeFile(
  resolve(directory, "src/view.ts"),
  "export const view = 'working';\nexport const stable = true;\nexport const added = 1;\nexport const more = 2;\nexport const latest = 3;\n",
);
await writeFile(
  resolve(directory, "src/new feature.ts"),
  Array.from({ length: 80 }, (_, i) => `export const item${i + 1} = ${i + 1};\n`).join(""),
);
await writeFile(
  resolve(
    directory,
    "src/a-very-long-file-name-that-wraps-on-phone-and-in-the-sidebar-without-hiding-the-line-counts.ts",
  ),
  "export const longPath = true;",
);
await writeFile(
  resolve(directory, "src/image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">\n<rect width="32" height="32" fill="green"/>\n</svg>\n',
);
await writeFile(resolve(directory, "binary.dat"), Buffer.from([1, 0, 2]));
await writeFile(resolve(directory, "large.txt"), "x".repeat(1024 * 1024 + 1));
await symlink("src/view.ts", resolve(directory, "link"));
console.log(`Line-count fixture ready: ${directory}`);
