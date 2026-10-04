import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifacts = resolve("qa/.artifacts");
const fixture = resolve(artifacts, "history-fixture");
await mkdir(artifacts, { recursive: true });
await mkdir(fixture); // Refuse to replace a fixture that may be in use.
function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=History QA", "-c", "user.email=history@example.invalid", ...args],
    {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-09-30T10:00:00+02:00",
        GIT_COMMITTER_DATE: "2026-09-30T10:00:00+02:00",
      },
    },
  ).trim();
}
await mkdir(resolve(fixture, "src"));
await mkdir(resolve(fixture, "assets"));
git("init", "-q", "-b", "main");
const source = (version: string) =>
  Array.from(
    { length: 160 },
    (_, index) => `export const item${index + 1} = { name: '${version}', value: ${index + 1} };\n`,
  ).join("");
await writeFile(resolve(fixture, "src/review.ts"), source("before"));
await writeFile(resolve(fixture, "README.md"), "# Review workspace\n\nThe first version.\n");
await writeFile(resolve(fixture, "run.sh"), "#!/bin/sh\n");
await writeFile(
  resolve(fixture, "src/long-line.c"),
  `const char *message = "${"long code needs horizontal room ".repeat(12)}";\nint answer(void) { return 41; }\n`,
);
await writeFile(
  resolve(fixture, "assets/card.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect width="480" height="180" fill="#dceee8"/><text x="32" y="100" font-size="28">Before</text></svg>',
);
git("add", ".");
git(
  "commit",
  "-qm",
  "Create the initial review workspace\n\nA root commit with code and an image.",
);
const root = git("rev-parse", "HEAD");
for (let index = 0; index < 52; index += 1)
  git("commit", "--allow-empty", "-qm", `History checkpoint ${index + 1}`);
await writeFile(resolve(fixture, "src/review.ts"), source("after"));
await writeFile(
  resolve(fixture, "README.md"),
  "# Review workspace\n\nImproved reading behavior.\n",
);
await chmod(resolve(fixture, "run.sh"), 0o755);
await writeFile(
  resolve(fixture, "src/long-line.c"),
  `const char *message = "${"long code needs horizontal room ".repeat(12)}";\nint answer(void) { return 42; }\n`,
);
await writeFile(
  resolve(fixture, "assets/card.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect width="480" height="180" fill="#176f62"/><text x="32" y="100" font-size="28" fill="white">After</text></svg>',
);
git("add", ".");
git(
  "commit",
  "-qm",
  "Improve reading and preserve historical context\n\nKeep the full commit message visible, including multiple paragraphs.\n\nChanges include TypeScript, C, and an inline image preview.",
);
const updated = git("rev-parse", "HEAD");
git("checkout", "-qb", "feature/navigation");
await writeFile(
  resolve(fixture, "src/feature.ts"),
  "export const feature = 'browse branches without checkout';\n",
);
git("add", ".");
git("commit", "-qm", "Add the feature branch\n\nThis file belongs to the feature commit.");
const feature = git("rev-parse", "HEAD");
git("checkout", "-q", "main");
git(
  "merge",
  "--no-ff",
  "-qm",
  "Merge the feature branch\n\nCompare this merge with its first parent.",
  "feature/navigation",
);
const merge = git("rev-parse", "HEAD");
git("update-ref", "refs/remotes/origin/main", merge);
git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
await writeFile(resolve(fixture, "src/review.ts"), source("working tree"));
await writeFile(resolve(fixture, "src/current-only.ts"), "export const currentOnly = true;\n");
await writeFile(
  resolve(artifacts, "history-fixture-info.json"),
  JSON.stringify({ root, updated, feature, merge }, null, 2) + "\n",
);
console.log(`History fixture ready: ${fixture}`);
