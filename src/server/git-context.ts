import { posix } from "node:path";
import { expectGitOid, gitPath } from "../shared/git.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import { AppError } from "./paths.ts";

export type GitContext = { prefix: string; oidLength: 40 | 64 };
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function isGitWorktree(cwd: string): Promise<boolean> {
  try {
    return (
      decoder.decode(await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], 4096)).trim() ===
      "true"
    );
  } catch (error: unknown) {
    if (
      error instanceof GitCommandError &&
      error.code === 128 &&
      error.stderr.includes("not a git repository")
    )
      return false;
    throw error;
  }
}

export async function readGitPrefix(cwd: string): Promise<string> {
  const prefix = decoder.decode(await runGit(cwd, ["rev-parse", "--show-prefix"], 8192));
  if (!prefix.endsWith("\n") || (prefix !== "\n" && !prefix.endsWith("/\n")))
    throw new Error("Invalid Git project prefix");
  const scope = prefix.slice(0, -1);
  gitPath(scope === "" ? "" : scope.slice(0, -1), true);
  return scope;
}

export async function readGitContext(cwd: string): Promise<GitContext | null> {
  if (!(await isGitWorktree(cwd))) return null;
  const [prefix, bytes] = await Promise.all([
    readGitPrefix(cwd),
    runGit(cwd, ["rev-parse", "--show-object-format"], 4096),
  ]);
  const format = decoder.decode(bytes).trim();
  if (format !== "sha1" && format !== "sha256") throw new Error("Unsupported Git object format");
  return { prefix, oidLength: format === "sha1" ? 40 : 64 };
}

export async function requireGitContext(cwd: string): Promise<GitContext> {
  const context = await readGitContext(cwd);
  if (context === null)
    throw new AppError("invalid_request", 400, "This folder is not a Git worktree");
  return context;
}

export function validateGitObjectId(value: string, context: GitContext): string {
  if (value.length !== context.oidLength)
    throw new AppError("invalid_request", 400, "Invalid Git object ID for this repository");
  try {
    return expectGitOid(value);
  } catch {
    throw new AppError("invalid_request", 400, "Specify a complete Git object ID");
  }
}

/** Relative rename origins may leave the project, but must stay inside the repository. */
export function repositoryPath(prefix: string, path: string): string | null {
  const relative = posix.normalize(posix.join(prefix, path));
  return relative === ".." || relative.startsWith("../") || relative.startsWith("/")
    ? null
    : relative;
}
