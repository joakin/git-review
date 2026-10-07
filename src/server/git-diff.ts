import { resolve } from "node:path";
import type { ChangeEntry, DiffResult, Project } from "../shared/api.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import { readGitPrefix, repositoryPath } from "./git-context.ts";
import { readGitPath } from "./git-objects.ts";
import { isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { withDiffSyntax } from "./diff-syntax.ts";
import { diffFromContent, maxPatchBytes, parseGitPatch } from "./diff-content.ts";
import { decodedText, maxSourceTextBytes } from "./source-text.ts";
import { readWorkingContent } from "./working-text.ts";
import { workingDiffPaths } from "./working-diff-paths.ts";

async function readUntrackedFile(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<DiffResult> {
  const file = await readWorkingContent(root, project, path);
  return file.kind === "content" ? diffFromContent(file.content) : file;
}

async function readBlob(
  project: Project,
  kind: "head" | "index",
  path: string,
): Promise<string | null> {
  try {
    return decodedText(
      await readGitPath(project.absolutePath, { kind, path }, maxSourceTextBytes + 1),
    );
  } catch (error: unknown) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

async function readWorkingSource(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<string | null> {
  const file = await readWorkingContent(root, project, path);
  return file.kind === "content" ? decodedText(file.content) : null;
}

async function withSyntax(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  diff: DiffResult,
  override: string | null,
): Promise<DiffResult> {
  if (diff.kind !== "text" || diff.hunks.length === 0) return diff;
  const prefix = await readGitPrefix(project.absolutePath);
  const oldPath = entry.oldPath ?? entry.path;
  const oldGitPath = repositoryPath(prefix, oldPath);
  const newGitPath = repositoryPath(prefix, entry.path);
  return withDiffSyntax(
    diff,
    entry.path,
    override,
    () =>
      oldGitPath === null || !isWithinRoot(root.realPath, resolve(project.absolutePath, oldPath))
        ? Promise.resolve(null)
        : readBlob(project, entry.layer === "staged" ? "head" : "index", oldGitPath),
    () =>
      newGitPath === null
        ? Promise.resolve(null)
        : entry.layer === "staged"
          ? readBlob(project, "index", newGitPath)
          : readWorkingSource(root, project, entry.path),
  );
}

export async function readProjectDiff(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  languageOverride: string | null = null,
): Promise<DiffResult> {
  if (entry.layer === "conflict") return { kind: "conflict" };
  if (entry.isSubmodule) return { kind: "binary", reason: "submodule" };
  if (entry.layer === "untracked")
    return withSyntax(
      root,
      project,
      entry,
      await readUntrackedFile(root, project, entry.path),
      languageOverride,
    );

  const args = [
    "diff",
    ...(entry.layer === "staged" ? ["--cached"] : []),
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
    "--no-prefix",
    "--find-renames",
    "--",
    ...workingDiffPaths(root, project, entry),
  ];
  try {
    return withSyntax(
      root,
      project,
      entry,
      parseGitPatch(await runGit(project.absolutePath, args, maxPatchBytes + 1024)),
      languageOverride,
    );
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { kind: "too_large" };
    throw error;
  }
}
