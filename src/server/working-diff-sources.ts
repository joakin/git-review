import { resolve } from "node:path";
import type { ChangeEntry, Project } from "../shared/api.ts";
import { GitCommandError } from "./git-execution.ts";
import { readGitPrefix, repositoryPath } from "./git-context.ts";
import { readGitPath } from "./git-objects.ts";
import { isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { decodedText, maxSourceTextBytes } from "./source-text.ts";
import { readWorkingContent } from "./working-text.ts";

export type DiffSource = { kind: "text"; text: string } | { kind: "limit" | "source" | "stale" };

async function blob(project: Project, kind: "head" | "index", path: string): Promise<DiffSource> {
  try {
    const bytes = await readGitPath(project.absolutePath, { kind, path }, maxSourceTextBytes + 1);
    if (bytes.byteLength > maxSourceTextBytes) return { kind: "limit" };
    const text = decodedText(bytes);
    return text === null ? { kind: "source" } : { kind: "text", text };
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { kind: "limit" };
    if (
      error instanceof GitCommandError &&
      error.code === 128 &&
      /^fatal: (?:path [\s\S]+ (?:does not exist|exists on disk, but not)|invalid object name 'HEAD')/.test(
        error.stderr,
      )
    )
      return { kind: "source" };
    throw error;
  }
}

/** Per-operation lazy reads shared by context validation and syntax decoration. */
export async function workingDiffSources(root: ApprovedRoot, project: Project, entry: ChangeEntry) {
  const prefix = await readGitPrefix(project.absolutePath);
  const oldPath = entry.oldPath ?? entry.path;
  const oldGitPath = repositoryPath(prefix, oldPath);
  const newGitPath = repositoryPath(prefix, entry.path);
  let old: Promise<DiffSource> | null = null;
  let next: Promise<DiffSource> | null = null;
  const readOld = () => {
    old ??=
      entry.kind === "added" || entry.layer === "untracked"
        ? Promise.resolve({ kind: "text", text: "" })
        : oldGitPath === null ||
            !isWithinRoot(root.realPath, resolve(project.absolutePath, oldPath))
          ? Promise.resolve({ kind: "source" })
          : blob(project, entry.layer === "staged" ? "head" : "index", oldGitPath);
    return old;
  };
  const readNew = () => {
    next ??=
      entry.kind === "deleted"
        ? Promise.resolve({ kind: "text", text: "" })
        : newGitPath === null
          ? Promise.resolve({ kind: "source" })
          : entry.layer === "staged"
            ? blob(project, "index", newGitPath)
            : readWorkingContent(root, project, entry.path).then((file): DiffSource => {
                if (file.kind === "stale") return { kind: "stale" };
                if (file.kind === "too_large") return { kind: "limit" };
                if (file.kind !== "content") return { kind: "source" };
                const text = decodedText(file.content);
                return text === null ? { kind: "source" } : { kind: "text", text };
              });
    return next;
  };
  return { readOld, readNew };
}
