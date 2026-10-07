import type { ChangeEntry, DiffResult, Project } from "../shared/api.ts";
import { GitCommandError, runGit } from "./git-execution.ts";
import type { ApprovedRoot } from "./paths.ts";
import { withDiffSyntax } from "./diff-syntax.ts";
import { diffFromContent, maxPatchBytes, parseGitPatch } from "./diff-content.ts";
import { readWorkingContent } from "./working-text.ts";
import { workingDiffPaths } from "./working-diff-paths.ts";
import { workingDiffSources, type DiffSource } from "./working-diff-sources.ts";
import { diffContextContent } from "./diff-context-content.ts";

async function readUntrackedFile(
  root: ApprovedRoot,
  project: Project,
  path: string,
): Promise<DiffResult> {
  const file = await readWorkingContent(root, project, path);
  return file.kind === "content" ? diffFromContent(file.content) : file;
}

async function withSyntax(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  diff: DiffResult,
  override: string | null,
): Promise<DiffResult> {
  if (diff.kind !== "text" || diff.hunks.length === 0) return diff;
  const sources = await workingDiffSources(root, project, entry);
  const syntaxSource = async (read: () => Promise<DiffSource>) => {
    const source = await read();
    return source.kind === "text" ? source.text : null;
  };
  const decorated = await withDiffSyntax(
    diff,
    entry.path,
    override,
    () => syntaxSource(sources.readOld),
    () => syntaxSource(sources.readNew),
  );
  // One-sided content already displays the complete file and has no omitted context.
  if (entry.kind === "added" || entry.kind === "deleted" || entry.layer === "untracked")
    return decorated;
  try {
    const [old, next] = await Promise.all([sources.readOld(), sources.readNew()]);
    if (old.kind === "stale" || next.kind === "stale") return { kind: "stale" };
    if (old.kind !== "text" || next.kind !== "text")
      return {
        ...decorated,
        context: {
          kind: "unavailable",
          reason: old.kind === "limit" || next.kind === "limit" ? "limit" : "source",
        },
      };
    return { ...decorated, context: diffContextContent(diff, old.text, next.text).metadata };
  } catch {
    // A readable ordinary patch remains useful when exact source alignment is unavailable.
    return { ...decorated, context: { kind: "unavailable", reason: "source" } };
  }
}

export async function readProjectPatch(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
): Promise<DiffResult> {
  if (entry.layer === "conflict") return { kind: "conflict" };
  if (entry.isSubmodule) return { kind: "binary", reason: "submodule" };
  if (entry.layer === "untracked") return readUntrackedFile(root, project, entry.path);

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
    return parseGitPatch(await runGit(project.absolutePath, args, maxPatchBytes + 1024));
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { kind: "too_large" };
    throw error;
  }
}

export async function readProjectDiff(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
  languageOverride: string | null = null,
): Promise<DiffResult> {
  return withSyntax(
    root,
    project,
    entry,
    await readProjectPatch(root, project, entry),
    languageOverride,
  );
}
