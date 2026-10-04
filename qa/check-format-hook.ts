import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { check, resolveConfig } from "prettier";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const repository = resolve(".");
const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const fixture = await mkdtemp(resolve(artifacts, "format-hook-"));
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: fixture, encoding: "utf8", stdio: "pipe" });
}
async function write(path: string, value: string): Promise<void> {
  await writeFile(resolve(fixture, path), value);
}

try {
  await mkdir(resolve(fixture, ".husky"));
  for (const path of [
    "package.json",
    ".prettierrc.json",
    ".prettierignore",
    ".editorconfig",
    ".husky/pre-commit",
  ]) {
    await copyFile(resolve(repository, path), resolve(fixture, path));
  }
  await symlink(resolve(repository, "node_modules"), resolve(fixture, "node_modules"), "dir");
  git("init", "-q");
  const baseline = "export const staged = { value: 0 };\n\nexport const unstaged = 0;\n";
  await write("partial.ts", baseline);
  await write("delete-me.ts", "export const deleted = true;\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Formatting QA",
    "-c",
    "user.email=qa@example.invalid",
    "commit",
    "-qm",
    "fixture baseline",
  );
  execFileSync("bun", ["run", "prepare"], { cwd: fixture, stdio: "pipe" });
  assert(
    git("config", "--local", "--get", "core.hooksPath").trim() === ".husky/_",
    "Prepare did not install the hook",
  );

  const staged = "export const staged={value:1};\n\nexport const unstaged = 0;\n";
  await write("partial.ts", staged);
  git("add", "partial.ts");
  await write("partial.ts", staged.replace("unstaged = 0", "unstaged = 2"));
  const files = [
    {
      path: "component space λ.tsx",
      value: "export const Component=()=> <div><span>Hello</span><span>world</span></div>\n",
    },
    { path: "styles.css", value: ".box{color:red;padding:0}\n" },
    { path: "notes.md", value: "# Notes\n\n-   First\n- Second\n" },
    { path: "config space.json", value: '{"enabled":true,"items":[1,2]}\n' },
    { path: "manifest.webmanifest", value: '{"name":"Fixture","display":"standalone"}\n' },
    {
      path: "icon.svg",
      value: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>\n',
    },
  ];
  for (const file of files) {
    await write(file.path, file.value);
    git("add", "--", file.path);
  }
  await mkdir(resolve(fixture, "qa/screenshots/mock"), { recursive: true });
  const ignored = '{"generated":true,"keep":"original spacing"}\n';
  await write("qa/screenshots/mock/manifest.json", ignored);
  git("add", "qa/screenshots/mock/manifest.json");
  git("rm", "-q", "delete-me.ts");
  const untracked = "export   const untouched={value: 99}\n";
  await write("leave-alone.ts", untracked);

  git("hook", "run", "pre-commit");
  for (const path of ["partial.ts", ...files.map((file) => file.path)]) {
    const options = await resolveConfig(resolve(fixture, path));
    assert(options !== null, "Missing copied formatter configuration");
    assert(
      await check(git("show", `:${path}`), { ...options, filepath: path }),
      `The hook did not format staged ${path}`,
    );
  }
  assert(
    git("show", ":partial.ts") ===
      "export const staged = { value: 1 };\n\nexport const unstaged = 0;\n",
    "The hook staged an unstaged edit or lost the staged change",
  );
  assert(
    (await readFile(resolve(fixture, "partial.ts"), "utf8")) ===
      "export const staged = { value: 1 };\n\nexport const unstaged = 2;\n",
    "The hook lost the unstaged edit",
  );
  assert(
    git("show", ":qa/screenshots/mock/manifest.json") === ignored,
    "The hook rewrote ignored capture metadata",
  );
  assert(
    (await readFile(resolve(fixture, "leave-alone.ts"), "utf8")) === untracked,
    "The hook formatted an untracked file",
  );
  assert(
    git("status", "--porcelain", "leave-alone.ts").startsWith("??"),
    "The hook staged an untracked file",
  );
  assert(
    git("diff", "--cached", "--name-status", "--", "delete-me.ts").startsWith("D"),
    "The hook lost a staged deletion",
  );
  assert(git("stash", "list").trim() === "", "Successful formatting left a backup stash behind");
  console.log(
    "Installed Git hook formats TypeScript/TSX, CSS, Markdown, JSON, SVG, and web manifests; spaces/Unicode names, partial staging, ignores, untracked files, and deletion passed.",
  );

  await write("broken.ts", "export const broken = ;\n");
  await write("styles.css", ".box{color:blue;padding:1px}\n");
  git("add", "broken.ts", "styles.css");
  const beforeIndex = git("write-tree");
  const beforePartial = await readFile(resolve(fixture, "partial.ts"), "utf8");
  const beforeCss = await readFile(resolve(fixture, "styles.css"), "utf8");
  const failed = spawnSync("git", ["hook", "run", "pre-commit"], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert(failed.status !== null && failed.status !== 0, "A syntax error did not block the hook");
  assert(git("write-tree") === beforeIndex, "A failed formatter changed the staged snapshot");
  assert(
    (await readFile(resolve(fixture, "partial.ts"), "utf8")) === beforePartial,
    "Formatter failure lost unstaged edits",
  );
  assert(
    (await readFile(resolve(fixture, "styles.css"), "utf8")) === beforeCss,
    "Formatter failure left a partially formatted working file",
  );
  assert(git("stash", "list").trim() === "", "Failed formatting left a backup stash behind");
  console.log(
    "Formatter syntax failure blocks the hook and restores the staged snapshot and working files without losing unstaged edits.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
