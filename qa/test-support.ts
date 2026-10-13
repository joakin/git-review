import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testGit(cwd: string, ...args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "QA",
      GIT_AUTHOR_EMAIL: "qa@example.invalid",
      GIT_COMMITTER_NAME: "QA",
      GIT_COMMITTER_EMAIL: "qa@example.invalid",
    },
  });
}

export function testGitText(cwd: string, ...args: string[]): string {
  return testGit(cwd, ...args)
    .toString("utf8")
    .trim();
}

export async function withTempDirectory<T>(
  prefix: string,
  check: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function projectRequestUrl(url: string | URL, projectPath: string): string {
  const value = new URL(url);
  value.searchParams.set("projectPath", projectPath);
  return value.href;
}
