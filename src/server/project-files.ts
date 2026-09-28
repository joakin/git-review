import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { FileReadResult, FileTree, FileTreeEntry, Project, SyntaxState, SyntaxToken } from "../shared/api.ts";
import { hasErrorCode } from "../shared/validation.ts";
import { AppError, isWithinRoot, type ApprovedRoot } from "./paths.ts";
import { detectLanguage, highlightSource } from "./syntax.ts";

const maxEntries = 1000;
const maxTextBytes = 1024 * 1024;
const maxLines = 20_000;

export function validateProjectFilePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || isAbsolute(value) || (sep === "\\" && value.includes("\\")) || (value !== "" && value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))) {
    throw new AppError("invalid_request", 400, "Invalid project-relative path");
  }
  if (value.split("/").includes(".git")) throw new AppError("forbidden", 403, "Git control files are not browsable");
  return value;
}

function accessError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) throw new AppError("not_found", 404, "File or folder was not found. Refresh the listing.");
  if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) throw new AppError("forbidden", 403, "The file or folder cannot be read");
  if (hasErrorCode(error, "ELOOP")) throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
  throw error;
}

async function checkedPath(root: ApprovedRoot, project: Project, rawPath: unknown): Promise<{ path: string; absolutePath: string; kind: "directory" | "file" | "symlink" | "other"; size: number }> {
  const path = validateProjectFilePath(rawPath);
  const segments = path === "" ? [] : path.split("/");
  let candidate = project.absolutePath;
  try {
    for (const [index, segment] of segments.entries()) {
      candidate = resolve(candidate, segment);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) {
        if (index === segments.length - 1) return { path, absolutePath: candidate, kind: "symlink", size: metadata.size };
        throw new AppError("forbidden", 403, "Symbolic links cannot be followed");
      }
      if (index < segments.length - 1 && !metadata.isDirectory()) throw new AppError("not_found", 404, "Folder was not found");
    }
    // Bun's realpath currently rejects literal backslashes in macOS filenames.
    const absolutePath = path.includes("\\") ? candidate : await realpath(candidate);
    if (!isWithinRoot(root.realPath, absolutePath) || !isWithinRoot(project.absolutePath, absolutePath)) {
      throw new AppError("forbidden", 403, "Path is outside the selected project");
    }
    const metadata = await lstat(absolutePath);
    return { path, absolutePath, kind: metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : metadata.isSymbolicLink() ? "symlink" : "other", size: metadata.size };
  } catch (error: unknown) {
    return accessError(error);
  }
}

export async function readProjectTree(root: ApprovedRoot, project: Project, rawPath: unknown): Promise<FileTree> {
  const location = await checkedPath(root, project, rawPath);
  if (location.kind !== "directory") throw new AppError("not_found", 404, "Folder was not found");
  const entries: FileTreeEntry[] = [];
  try {
    const directory = await opendir(location.absolutePath);
    for await (const entry of directory) {
      if (entry.name === ".git") continue;
      if (entries.length === maxEntries) throw new AppError("invalid_request", 413, "This folder has too many entries to browse");
      entries.push({
        name: entry.name,
        path: location.path === "" ? entry.name : `${location.path}/${entry.name}`,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
      });
    }
  } catch (error: unknown) {
    accessError(error);
  }
  entries.sort((left, right) => {
    if (left.kind === "directory" && right.kind !== "directory") return -1;
    if (right.kind === "directory" && left.kind !== "directory") return 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  const lastSlash = location.path.lastIndexOf("/");
  const parentPath = location.path === "" ? null : lastSlash === -1 ? "" : location.path.slice(0, lastSlash);
  return { path: location.path, parentPath, entries };
}

export async function readProjectFile(root: ApprovedRoot, project: Project, rawPath: unknown, requestedLanguage: string | null): Promise<FileReadResult> {
  const location = await checkedPath(root, project, rawPath);
  if (location.path === "" || location.kind === "directory") throw new AppError("not_found", 404, "File was not found");
  if (location.kind === "symlink" || location.kind === "other") return { kind: location.kind === "symlink" ? "symlink" : "unsupported", path: location.path, byteLength: location.size };
  if (location.size > maxTextBytes) return { kind: "too_large", path: location.path, byteLength: location.size };
  const bytes = Buffer.allocUnsafe(maxTextBytes + 1);
  let size = 0;
  try {
    const file = await open(location.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const metadata = await file.stat();
      if (!metadata.isFile()) return { kind: "unsupported", path: location.path, byteLength: metadata.size };
      while (size <= maxTextBytes) {
        const { bytesRead } = await file.read(bytes, size, maxTextBytes + 1 - size, null);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
    } finally {
      await file.close();
    }
  } catch (error: unknown) {
    return accessError(error);
  }
  if (size > maxTextBytes) return { kind: "too_large", path: location.path, byteLength: size };
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } catch {
    return { kind: "binary", path: location.path, byteLength: size };
  }
  if (source.includes("\0")) return { kind: "binary", path: location.path, byteLength: size };
  source = source.replaceAll("\r\n", "\n");
  const parts = source === "" ? [] : source.split("\n");
  if (source.endsWith("\n")) parts.pop();
  if (parts.length > maxLines) return { kind: "too_large", path: location.path, byteLength: size };
  const language = requestedLanguage ?? detectLanguage(location.path);
  let syntax: SyntaxState = { kind: "plain", reason: requestedLanguage === "text" ? "selected" : "unknown_language" };
  let highlighted: SyntaxToken[][] | null = null;
  if (language !== null && language !== "text") {
    try {
      highlighted = await highlightSource(parts.join("\n"), language);
      if (highlighted !== null && (highlighted.length !== parts.length || highlighted.some((tokens, index) => tokens.map((token) => token.text).join("") !== parts[index]))) highlighted = null;
      syntax = highlighted === null ? { kind: "plain", reason: "unavailable" } : { kind: "highlighted", language };
    } catch {
      syntax = { kind: "plain", reason: "unavailable" };
    }
  }
  const lines = parts.map((text, index) => ({
    number: index + 1,
    text,
    tokens: highlighted?.[index]?.map((token) => ({ ...token })) ?? (text === "" ? [] : [{ text, role: "plain" as const }]),
  }));
  return { kind: "text", path: location.path, byteLength: size, syntax, lines };
}
