import { copyFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { testGitText as git, withTempDirectory } from "./test-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

const scanner = resolve("scripts/check-secrets.ts");
const ignoreFile = resolve(".gitignore");
await withTempDirectory("git-review-secret-check-", async (fixture) => {
  git(fixture, "init", "-q");
  await copyFile(ignoreFile, join(fixture, ".gitignore"));
  const clean = "export const value = 1;\n";
  await writeFile(join(fixture, "review.ts"), clean);
  git(fixture, "add", ".");
  git(fixture, "commit", "-qm", "clean baseline");
  for (const path of [".env", "nested/.env.local", "nested/.env.production"])
    assert(git(fixture, "check-ignore", "--", path).trim() === path, `Not ignored: ${path}`);
  for (const path of [".env.example", "nested/.env.local.example", ".env.template"]) {
    const check = Bun.spawnSync(["git", "check-ignore", "--quiet", "--", path], { cwd: fixture });
    assert(check.exitCode === 1, `Sanitized example is ignored: ${path}`);
  }

  async function scan(staged: boolean) {
    const child = Bun.spawn([process.execPath, scanner, ...(staged ? ["--staged"] : [])], {
      cwd: fixture,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output: out + err };
  }

  // Deliberately synthetic token assembled so the test source itself is not a credential finding.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(36)),
    (value) => alphabet[value % 62],
  ).join("");
  const token = ["gh", "p_", suffix].join("");
  const secret = `export const token = "${token}";\n`;
  const staged = clean.replace("1", "2");
  await writeFile(join(fixture, "review.ts"), staged);
  git(fixture, "add", "review.ts");
  await writeFile(join(fixture, "review.ts"), secret);
  assert((await scan(true)).code === 0, "Staged scan inspected an unstaged edit");
  assert(git(fixture, "show", ":review.ts") === staged.trim(), "Scan changed the index");
  git(fixture, "add", "review.ts");
  const blocked = await scan(true);
  assert(blocked.code === 1, "Staged synthetic credential was accepted");
  assert(!blocked.output.includes(token), "Scanner exposed the synthetic secret in output");
  await writeFile(join(fixture, "review.ts"), staged);
  git(fixture, "add", "review.ts");
  git(fixture, "commit", "-qm", "safe change");
  assert((await scan(false)).code === 0, "Clean fixture history failed scanning");
  await writeFile(join(fixture, "historical.ts"), secret);
  git(fixture, "add", "historical.ts");
  git(fixture, "commit", "-qm", "synthetic historical credential");
  await rm(join(fixture, "historical.ts"));
  git(fixture, "add", "-u");
  git(fixture, "commit", "-qm", "remove synthetic credential");
  const history = await scan(false);
  assert(history.code === 1, "Full scan missed a credential deleted from the current tree");
  assert(!history.output.includes(token), "History scan exposed the synthetic secret");
});
console.log(
  "Dotenv ignores, staged-only scanning, index preservation, redaction and deleted-history detection passed.",
);
