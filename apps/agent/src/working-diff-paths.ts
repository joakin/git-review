import { resolve } from "node:path";
import type { ChangeEntry, Project } from "@git-review/shared/api";
import { isWithinRoot, type ApprovedRoot } from "./paths.ts";

/** Counts and cards must compare the same permitted rename sources. */
export function workingDiffPaths(
  root: ApprovedRoot,
  project: Project,
  entry: ChangeEntry,
): string[] {
  const paths = [entry.path];
  if (
    entry.oldPath !== null &&
    isWithinRoot(root.realPath, resolve(project.absolutePath, entry.oldPath)) &&
    !paths.includes(entry.oldPath)
  )
    paths.push(entry.oldPath);
  return paths;
}
