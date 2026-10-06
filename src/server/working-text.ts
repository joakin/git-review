import type { Project } from "../shared/api.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { checkedProjectPath, withCheckedWorkingFile } from "./working-files.ts";

export const maxWorkingTextBytes = 1024 * 1024;
export const maxWorkingTextLines = 20_000;
export type WorkingContent =
  | { kind: "content"; content: Buffer }
  | { kind: "binary"; reason: "binary" | "symlink" }
  | { kind: "too_large" }
  | { kind: "stale" };
type WorkingText =
  | { kind: "text"; text: string; lineCount: number; hasFinalNewline: boolean }
  | { kind: "binary"; reason: "binary" }
  | { kind: "too_large" };

/** Shared source classification/counting without building diff rows or decorations. */
export function parseWorkingText(content: Buffer): WorkingText {
  if (content.byteLength > maxWorkingTextBytes) return { kind: "too_large" };
  if (content.includes(0)) return { kind: "binary", reason: "binary" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return { kind: "binary", reason: "binary" };
  }
  const hasFinalNewline = text.endsWith("\n");
  let lineCount = text === "" || hasFinalNewline ? 0 : 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lineCount += 1;
    if (lineCount > maxWorkingTextLines) return { kind: "too_large" };
  }
  return { kind: "text", text, lineCount, hasFinalNewline };
}

/** Checked, bounded bytes used by working-copy diffs and untracked statistics. */
export async function readWorkingContent(
  root: ApprovedRoot,
  project: Project,
  path: string,
  maxBytes = maxWorkingTextBytes,
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
