import type { Project } from "../shared/api.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { checkedProjectPath, withCheckedWorkingFile } from "./working-files.ts";
import { maxSourceTextBytes } from "./source-text.ts";

export type WorkingContent =
  | { kind: "content"; content: Buffer }
  | { kind: "binary"; reason: "binary" | "symlink" }
  | { kind: "too_large" }
  | { kind: "stale" };

/** Checked, bounded bytes used by working-copy diffs and untracked statistics. */
export async function readWorkingContent(
  root: ApprovedRoot,
  project: Project,
  path: string,
  maxBytes = maxSourceTextBytes,
  reserveBytes: (byteLength: number) => boolean = () => true,
): Promise<WorkingContent> {
  try {
    const location = await checkedProjectPath(root, project, path);
    if (location.kind === "symlink") return { kind: "binary", reason: "symlink" };
    if (location.kind !== "file") return { kind: "binary", reason: "binary" };
    if (location.metadata.size > maxBytes) return { kind: "too_large" };
    return await withCheckedWorkingFile(root, project, path, async ({ file, metadata }) => {
      if (metadata.size > maxBytes) return { kind: "too_large" };
      const capacity = Math.min(metadata.size + 1, maxBytes + 1);
      if (!reserveBytes(capacity)) return { kind: "too_large" };
      const content = Buffer.alloc(capacity);
      let size = 0;
      while (size < content.length) {
        const { bytesRead } = await file.read(content, size, content.length - size, null);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      // A growing file requires a fresh read rather than counting its truncated prefix.
      if (size > metadata.size) return { kind: "stale" };
      return { kind: "content", content: content.subarray(0, size) };
    });
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "not_found") return { kind: "stale" };
    throw error;
  }
}
