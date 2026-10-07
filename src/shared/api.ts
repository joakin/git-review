import { isProjectPath } from "./project-path.ts";
import { validateChangeGroupTotals } from "./change-line-stats.ts";
import { normalizeSearchQuery } from "./search-query.ts";
import { parseChangeSnapshot, type ChangeSnapshot } from "./change-snapshot.ts";

export type RootInfo = {
  label: string;
  path: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type DirectoryListing = {
  path: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
};

export type FileTreeEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
};
export type FileTree = { path: string; parentPath: string | null; entries: FileTreeEntry[] };
export type FileLine = { number: number; text: string; tokens: SyntaxToken[] };
export type MediaResource = {
  kind: "image" | "audio" | "video";
  mimeType: string;
  byteLength: number;
  url: string;
};
export type MediaSide =
  | { kind: "absent" }
  | { kind: "ready"; path: string; resource: MediaResource }
  | { kind: "unavailable"; path: string; reason: "unsupported" | "too_large" | "missing" };
export type FileReadResult =
  | { kind: "text"; path: string; byteLength: number; syntax: SyntaxState; lines: FileLine[] }
  | { kind: "media"; path: string; byteLength: number; resource: MediaResource }
  | { kind: "binary" | "too_large" | "symlink" | "unsupported"; path: string; byteLength: number };

export type SearchMatch = { path: string; line: number; excerpt: string };
export type SearchResponse = { query: string; matches: SearchMatch[]; truncated: boolean };

export type Project = {
  name: string;
  relativePath: string;
  absolutePath: string;
};

export type ChangeLayer = "staged" | "unstaged" | "untracked" | "conflict";
export type ChangeKind =
  "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "conflicted";

export type ChangeEntry = {
  layer: ChangeLayer;
  kind: ChangeKind;
  path: string;
  oldPath: string | null;
  isSubmodule: boolean;
};

export type ChangeLineStats =
  | { kind: "text"; added: number; deleted: number }
  | { kind: "binary" }
  | { kind: "not_applicable"; reason: "conflict" | "symlink" | "submodule" }
  | { kind: "unavailable"; reason: "limit" | "read_error" | "changed" };
export type ReviewChangeEntry = ChangeEntry & { stats: ChangeLineStats };
export type ProjectInventory =
  { kind: "not_git" } | (ChangeSnapshot & { kind: "git"; entries: ChangeEntry[] });
export type ProjectStatus =
  { kind: "not_git" } | (ChangeSnapshot & { kind: "git"; entries: ReviewChangeEntry[] });
export type ProjectChangeCheck = { kind: "not_git" } | (ChangeSnapshot & { kind: "git" });

export type DiffLine = {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  tokens: SyntaxToken[];
  detail: DiffDetail;
  noNewlineAtEnd: boolean;
};

export type TextSpan = { start: number; end: number };
export type DiffDetail = { kind: "none" } | { kind: "word_change"; spans: TextSpan[] };

export type SyntaxRole =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "type"
  | "function"
  | "variable"
  | "property"
  | "operator"
  | "punctuation"
  | "tag"
  | "attribute";
export type SyntaxToken = { text: string; role: SyntaxRole };
export type SyntaxState =
  | { kind: "highlighted"; language: string }
  | { kind: "plain"; reason: "unknown_language" | "selected" | "unavailable" };
export type LanguageOption = { id: string; name: string };

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffResult =
  | { kind: "text"; syntax: SyntaxState; hunks: DiffHunk[] }
  | { kind: "media"; old: MediaSide; new: MediaSide }
  | { kind: "binary"; reason: "binary" | "symlink" | "submodule" }
  | { kind: "too_large" }
  | { kind: "conflict" }
  | { kind: "stale" };

export type ApiErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "file_not_found"
  | "project_not_found"
  | "project_changed"
  | "internal_error";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
};

export function parseRootResponse(value: unknown): RootInfo {
  const outer = expectRecord(value, "server response");
  const root = expectRecord(outer["root"], "root");
  return {
    label: expectString(root["label"], "root.label"),
    path: expectString(root["path"], "root.path"),
  };
}

export function parseDirectoryResponse(value: unknown): DirectoryListing {
  const outer = expectRecord(value, "server response");
  const path = expectString(outer["path"], "path");
  const parent = outer["parentPath"];
  if (parent !== null && typeof parent !== "string") {
    throw new Error("Expected parentPath to be a string or null");
  }
  const rawEntries = outer["entries"];
  if (!Array.isArray(rawEntries)) throw new Error("Expected entries to be an array");
  const entries: DirectoryEntry[] = rawEntries.map((rawEntry: unknown) => {
    const entry = expectRecord(rawEntry, "directory entry");
    return {
      name: expectString(entry["name"], "entry.name"),
      path: expectString(entry["path"], "entry.path"),
    };
  });
  return { path, parentPath: parent, entries };
}

function expectProjectPath(value: unknown, label: string, allowEmpty: boolean): string {
  const path = expectString(value, label);
  if (
    path.length > 4096 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    (!allowEmpty && path === "") ||
    (path !== "" &&
      path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
  ) {
    throw new Error(`Expected a valid ${label}`);
  }
  return path;
}

export function parseFileTreeResponse(value: unknown): FileTree {
  const outer = expectRecord(value, "file tree");
  const path = expectProjectPath(outer["path"], "tree path", true);
  const parentPath = outer["parentPath"];
  const expectedParent =
    path === "" ? null : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (parentPath !== expectedParent) throw new Error("Expected the tree's parent folder path");
  const rawEntries = outer["entries"];
  if (!Array.isArray(rawEntries) || rawEntries.length > 1000)
    throw new Error("Expected bounded file tree entries");
  const seen = new Set<string>();
  const entries: FileTreeEntry[] = rawEntries.map((raw: unknown) => {
    const entry = expectRecord(raw, "file tree entry");
    const kind = entry["kind"];
    if (kind !== "directory" && kind !== "file" && kind !== "symlink" && kind !== "other")
      throw new Error("Expected a file tree entry kind");
    const name = expectProjectPath(entry["name"], "entry name", false);
    if (name.includes("/") || seen.has(name))
      throw new Error("Expected a unique file tree entry name");
    seen.add(name);
    const entryPath = expectProjectPath(entry["path"], "entry path", false);
    if (entryPath !== (path === "" ? name : `${path}/${name}`))
      throw new Error("Expected an entry inside its listed folder");
    return { name, path: entryPath, kind };
  });
  return { path, parentPath: expectedParent, entries };
}

function parseSyntaxState(value: unknown): SyntaxState {
  const raw = expectRecord(value, "syntax state");
  if (raw["kind"] === "highlighted") {
    const language = expectString(raw["language"], "syntax language");
    if (language.length === 0 || language.length > 80)
      throw new Error("Expected a valid syntax language");
    return { kind: "highlighted", language };
  }
  if (raw["kind"] === "plain") {
    const reason = raw["reason"];
    if (reason !== "unknown_language" && reason !== "selected" && reason !== "unavailable")
      throw new Error("Expected a plain syntax reason");
    return { kind: "plain", reason };
  }
  throw new Error("Expected a syntax state");
}

function parseSyntaxTokens(value: unknown, source: string): SyntaxToken[] {
  if (!Array.isArray(value) || value.length > 20_000)
    throw new Error("Expected bounded syntax tokens");
  const tokens: SyntaxToken[] = value.map((raw: unknown) => {
    const token = expectRecord(raw, "syntax token");
    const text = expectString(token["text"], "token text");
    const role = token["role"];
    if (
      role !== "plain" &&
      role !== "comment" &&
      role !== "keyword" &&
      role !== "string" &&
      role !== "number" &&
      role !== "type" &&
      role !== "function" &&
      role !== "variable" &&
      role !== "property" &&
      role !== "operator" &&
      role !== "punctuation" &&
      role !== "tag" &&
      role !== "attribute"
    )
      throw new Error("Expected a valid syntax role");
    return { text, role };
  });
  if (tokens.map((token) => token.text).join("") !== source)
    throw new Error("Syntax tokens do not match their source line");
  return tokens;
}

const imageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);
const audioMimeTypes = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg"]);
const videoMimeTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function parseMediaResource(value: unknown): MediaResource {
  const raw = expectRecord(value, "media resource");
  const kind = raw["kind"];
  if (kind !== "image" && kind !== "audio" && kind !== "video")
    throw new Error("Expected a media resource");
  const mimeType = expectString(raw["mimeType"], "media MIME type");
  if (
    !(kind === "image" ? imageMimeTypes : kind === "audio" ? audioMimeTypes : videoMimeTypes).has(
      mimeType,
    )
  )
    throw new Error("Expected a supported media MIME type");
  const byteLength = expectNonNegativeInteger(raw["byteLength"], "media byte length");
  if (byteLength === 0 || byteLength > (kind === "image" ? 25 : 200) * 1024 * 1024)
    throw new Error("Expected bounded media bytes");
  const url = expectString(raw["url"], "media URL");
  if (!/^\/api\/project\/raw\/(file|diff|commit)\?/.test(url) || /[\r\n\\]/.test(url))
    throw new Error("Expected a project media URL");
  const parsedUrl = new URL(url, "http://localhost");
  if (
    parsedUrl.hash !== "" ||
    parsedUrl.searchParams.getAll("projectPath").length !== 1 ||
    !isProjectPath(parsedUrl.searchParams.get("projectPath"))
  )
    throw new Error("Expected an absolute project path in the media URL");
  return { kind, mimeType, byteLength, url };
}

function parseMediaSide(value: unknown): MediaSide {
  const raw = expectRecord(value, "media side");
  if (raw["kind"] === "absent") return { kind: "absent" };
  const path = expectProjectPath(raw["path"], "media path", false);
  if (raw["kind"] === "ready")
    return { kind: "ready", path, resource: parseMediaResource(raw["resource"]) };
  if (raw["kind"] === "unavailable") {
    const reason = raw["reason"];
    if (reason !== "unsupported" && reason !== "too_large" && reason !== "missing")
      throw new Error("Expected a media unavailable reason");
    return { kind: "unavailable", path, reason };
  }
  throw new Error("Expected a media side state");
}

export function parseFileReadResponse(value: unknown): FileReadResult {
  const outer = expectRecord(value, "file response");
  const path = expectProjectPath(outer["path"], "file path", false);
  const byteLength = expectNonNegativeInteger(outer["byteLength"], "file byte length");
  const kind = outer["kind"];
  if (kind === "binary" || kind === "too_large" || kind === "symlink" || kind === "unsupported")
    return { kind, path, byteLength };
  if (kind === "media") {
    const resource = parseMediaResource(outer["resource"]);
    if (resource.byteLength !== byteLength)
      throw new Error("Media byte length differs from file metadata");
    return { kind, path, byteLength, resource };
  }
  if (kind !== "text" || byteLength > 1024 * 1024) throw new Error("Expected a bounded text file");
  const syntax = parseSyntaxState(outer["syntax"]);
  const rawLines = outer["lines"];
  if (!Array.isArray(rawLines) || rawLines.length > 20_000)
    throw new Error("Expected bounded file lines");
  let totalTokens = 0;
  let totalCharacters = 0;
  const lines: FileLine[] = rawLines.map((raw: unknown, index: number) => {
    const line = expectRecord(raw, "file line");
    const number = expectNonNegativeInteger(line["number"], "file line number");
    if (number !== index + 1) throw new Error("Expected sequential file line numbers");
    const text = expectString(line["text"], "file line text");
    totalCharacters += text.length;
    if (totalCharacters > 1024 * 1024) throw new Error("Expected bounded file text");
    const tokens = parseSyntaxTokens(line["tokens"], text);
    totalTokens += tokens.length;
    if (totalTokens > 100_000) throw new Error("Expected bounded file syntax tokens");
    return { number, text, tokens };
  });
  return { kind: "text", path, byteLength, syntax, lines };
}

export function parseSearchResponse(value: unknown): SearchResponse {
  const outer = expectRecord(value, "search response");
  const query = expectString(outer["query"], "search query");
  if (normalizeSearchQuery(query) !== query) throw new Error("Expected a valid search query");
  if (typeof outer["truncated"] !== "boolean") throw new Error("Expected a search truncation flag");
  const rawMatches = outer["matches"];
  if (!Array.isArray(rawMatches) || rawMatches.length > 100)
    throw new Error("Expected bounded search matches");
  const matches: SearchMatch[] = rawMatches.map((raw: unknown) => {
    const match = expectRecord(raw, "search match");
    const path = expectProjectPath(match["path"], "search path", false);
    if (path.split("/").includes(".git")) throw new Error("Expected a browsable search path");
    const line = expectNonNegativeInteger(match["line"], "search line");
    if (line === 0) throw new Error("Expected a positive search line");
    const excerpt = expectString(match["excerpt"], "search excerpt");
    if (excerpt.length > 242 || /[\r\n]/.test(excerpt))
      throw new Error("Expected a short search excerpt");
    return { path, line, excerpt };
  });
  return { query, matches, truncated: outer["truncated"] };
}

export function parseProjectResponse(value: unknown): Project {
  const outer = expectRecord(value, "server response");
  const project = expectRecord(outer["project"], "project");
  const absolutePath = project["absolutePath"];
  if (!isProjectPath(absolutePath)) throw new Error("Expected an absolute project path");
  return {
    name: expectString(project["name"], "project.name"),
    relativePath: expectProjectPath(project["relativePath"], "project.relativePath", true),
    absolutePath,
  };
}

export function parseChangeCheckResponse(value: unknown): ProjectChangeCheck {
  const outer = expectRecord(value, "server response");
  if (outer["kind"] === "not_git") return { kind: "not_git" };
  if (outer["kind"] !== "git") throw new Error("Expected a Git status response");
  return { kind: "git", ...parseChangeSnapshot(outer) };
}

export function parseChangeLineStats(value: unknown): ChangeLineStats {
  const raw = expectRecord(value, "change statistics");
  if (raw["kind"] === "text")
    return {
      kind: "text",
      added: expectNonNegativeInteger(raw["added"], "added lines"),
      deleted: expectNonNegativeInteger(raw["deleted"], "deleted lines"),
    };
  if (raw["kind"] === "binary") return { kind: "binary" };
  const reason = raw["reason"];
  if (
    raw["kind"] === "not_applicable" &&
    (reason === "conflict" || reason === "symlink" || reason === "submodule")
  )
    return { kind: "not_applicable", reason };
  if (
    raw["kind"] === "unavailable" &&
    (reason === "limit" || reason === "read_error" || reason === "changed")
  )
    return { kind: "unavailable", reason };
  throw new Error("Expected change statistics");
}

export function parseStatusResponse(value: unknown): ProjectStatus {
  const check = parseChangeCheckResponse(value);
  if (check.kind === "not_git") return check;
  const outer = expectRecord(value, "server response");
  const rawEntries = outer["entries"];
  if (!Array.isArray(rawEntries)) throw new Error("Expected status entries to be an array");
  const seen = new Set<string>();
  const entries: ReviewChangeEntry[] = rawEntries.map((raw: unknown) => {
    const entry = expectRecord(raw, "status entry");
    const layer = entry["layer"];
    const kind = entry["kind"];
    const oldPath = entry["oldPath"];
    if (
      layer !== "staged" &&
      layer !== "unstaged" &&
      layer !== "untracked" &&
      layer !== "conflict"
    ) {
      throw new Error("Expected a valid change layer");
    }
    if (
      kind !== "added" &&
      kind !== "modified" &&
      kind !== "deleted" &&
      kind !== "renamed" &&
      kind !== "copied" &&
      kind !== "type_changed" &&
      kind !== "conflicted"
    ) {
      throw new Error("Expected a valid change kind");
    }
    if (oldPath !== null && typeof oldPath !== "string")
      throw new Error("Expected an old path or null");
    if (typeof entry["isSubmodule"] !== "boolean") throw new Error("Expected a submodule flag");
    const path = expectProjectPath(entry["path"], "entry.path", false);
    if (path.length === 0 || (oldPath !== null && oldPath.length === 0))
      throw new Error("Expected a nonempty change path");
    if (
      oldPath !== null &&
      (oldPath.length > 4096 || oldPath.includes("\0") || oldPath.startsWith("/"))
    )
      throw new Error("Expected a bounded relative rename origin");
    if ((layer === "conflict") !== (kind === "conflicted"))
      throw new Error("Expected a matching conflict state");
    if (layer === "untracked" && kind !== "added")
      throw new Error("Expected an added untracked file");
    const key = JSON.stringify([layer, path]);
    if (seen.has(key)) throw new Error("Expected unique status entries");
    seen.add(key);
    const stats = parseChangeLineStats(entry["stats"]);
    if (
      (layer === "conflict") !== (stats.kind === "not_applicable" && stats.reason === "conflict") ||
      (entry["isSubmodule"] === true &&
        layer !== "conflict" &&
        (stats.kind !== "not_applicable" || stats.reason !== "submodule")) ||
      (stats.kind === "not_applicable" && stats.reason === "submodule" && !entry["isSubmodule"]) ||
      (kind === "added" && stats.kind === "text" && stats.deleted !== 0) ||
      (kind === "deleted" && stats.kind === "text" && stats.added !== 0)
    )
      throw new Error("Expected statistics matching the change entry");
    return {
      layer,
      kind,
      path,
      oldPath,
      isSubmodule: entry["isSubmodule"],
      stats,
    };
  });
  validateChangeGroupTotals(entries);
  return { ...check, entries };
}

export function parseDiffResponse(value: unknown): DiffResult {
  const outer = expectRecord(value, "diff response");
  switch (outer["kind"]) {
    case "stale":
      return { kind: "stale" };
    case "too_large":
      return { kind: "too_large" };
    case "conflict":
      return { kind: "conflict" };
    case "binary": {
      const reason = outer["reason"];
      if (reason !== "binary" && reason !== "symlink" && reason !== "submodule")
        throw new Error("Expected a binary file reason");
      return { kind: "binary", reason };
    }
    case "media":
      return {
        kind: "media",
        old: parseMediaSide(outer["old"]),
        new: parseMediaSide(outer["new"]),
      };
    case "text": {
      const syntax = parseSyntaxState(outer["syntax"]);
      const rawHunks = outer["hunks"];
      if (!Array.isArray(rawHunks) || rawHunks.length > 2000)
        throw new Error("Expected bounded diff hunks");
      let totalLines = 0;
      let totalTokens = 0;
      let totalSpans = 0;
      const hunks: DiffHunk[] = rawHunks.map((rawHunk: unknown) => {
        const hunk = expectRecord(rawHunk, "diff hunk");
        const rawLines = hunk["lines"];
        if (!Array.isArray(rawLines) || rawLines.length > 20_000)
          throw new Error("Expected bounded diff lines");
        totalLines += rawLines.length;
        if (totalLines > 20_000) throw new Error("Expected bounded diff lines");
        const lines: DiffLine[] = rawLines.map((rawLine: unknown) => {
          const line = expectRecord(rawLine, "diff line");
          const kind = line["kind"];
          if (kind !== "context" && kind !== "added" && kind !== "removed")
            throw new Error("Expected a diff line kind");
          const oldLine =
            line["oldLine"] === null
              ? null
              : expectNonNegativeInteger(line["oldLine"], "old line number");
          const newLine =
            line["newLine"] === null
              ? null
              : expectNonNegativeInteger(line["newLine"], "new line number");
          if (oldLine === 0 || newLine === 0)
            throw new Error("Expected positive diff line numbers");
          if (
            (kind === "added" && (oldLine !== null || newLine === null)) ||
            (kind === "removed" && (newLine !== null || oldLine === null)) ||
            (kind === "context" && (oldLine === null || newLine === null))
          ) {
            throw new Error("Expected line numbers matching the diff line kind");
          }
          if (typeof line["noNewlineAtEnd"] !== "boolean")
            throw new Error("Expected a newline marker");
          const lineText = expectString(line["text"], "diff line text");
          const rawTokens = line["tokens"];
          // Preflight the aggregate budget before parsing another token batch.
          if (Array.isArray(rawTokens)) {
            totalTokens += rawTokens.length;
            if (totalTokens > 100_000) throw new Error("Expected bounded syntax tokens");
          }
          const tokens = parseSyntaxTokens(rawTokens, lineText);
          const rawDetail = expectRecord(line["detail"], "diff detail");
          let detail: DiffDetail;
          if (rawDetail["kind"] === "none") {
            detail = { kind: "none" };
          } else if (rawDetail["kind"] === "word_change" && kind !== "context") {
            const rawSpans = rawDetail["spans"];
            if (!Array.isArray(rawSpans) || rawSpans.length === 0 || rawSpans.length > 256)
              throw new Error("Expected bounded word-change spans");
            totalSpans += rawSpans.length;
            if (totalSpans > 100_000) throw new Error("Expected bounded diff detail");
            let previousEnd = 0;
            const spans: TextSpan[] = rawSpans.map((rawSpan: unknown) => {
              const span = expectRecord(rawSpan, "word-change span");
              const start = expectNonNegativeInteger(span["start"], "word-change start");
              const end = expectNonNegativeInteger(span["end"], "word-change end");
              const splitsSurrogate = (offset: number): boolean =>
                offset > 0 &&
                offset < lineText.length &&
                lineText.charCodeAt(offset - 1) >= 0xd800 &&
                lineText.charCodeAt(offset - 1) <= 0xdbff &&
                lineText.charCodeAt(offset) >= 0xdc00 &&
                lineText.charCodeAt(offset) <= 0xdfff;
              if (
                start < previousEnd ||
                end <= start ||
                end > lineText.length ||
                splitsSurrogate(start) ||
                splitsSurrogate(end)
              ) {
                throw new Error("Expected valid word-change offsets");
              }
              previousEnd = end;
              return { start, end };
            });
            detail = { kind: "word_change", spans };
          } else {
            throw new Error("Expected a diff detail kind");
          }
          return {
            kind,
            oldLine,
            newLine,
            text: lineText,
            tokens,
            detail,
            noNewlineAtEnd: line["noNewlineAtEnd"],
          };
        });
        const oldStart = expectNonNegativeInteger(hunk["oldStart"], "old hunk start");
        const oldCount = expectNonNegativeInteger(hunk["oldCount"], "old hunk count");
        const newStart = expectNonNegativeInteger(hunk["newStart"], "new hunk start");
        const newCount = expectNonNegativeInteger(hunk["newCount"], "new hunk count");
        if (
          lines.filter((line) => line.kind !== "added").length !== oldCount ||
          lines.filter((line) => line.kind !== "removed").length !== newCount
        ) {
          throw new Error("Diff hunk counts do not match its lines");
        }
        return {
          oldStart,
          oldCount,
          newStart,
          newCount,
          lines,
        };
      });
      return { kind: "text", syntax, hunks };
    }
    default:
      throw new Error("Expected a diff response kind");
  }
}

export function parseLanguagesResponse(value: unknown): LanguageOption[] {
  const outer = expectRecord(value, "languages response");
  const rawLanguages = outer["languages"];
  if (!Array.isArray(rawLanguages) || rawLanguages.length > 500)
    throw new Error("Expected bounded languages");
  const seen = new Set<string>();
  return rawLanguages.map((raw: unknown) => {
    const entry = expectRecord(raw, "language");
    const id = expectString(entry["id"], "language ID");
    const name = expectString(entry["name"], "language name");
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ||
      name.length === 0 ||
      name.length > 100 ||
      seen.has(id)
    )
      throw new Error("Expected a valid language");
    seen.add(id);
    return { id, name };
  });
}

export function parseApiError(value: unknown): ApiError | null {
  try {
    const outer = expectRecord(value, "server response");
    const error = expectRecord(outer["error"], "error");
    const code = error["code"];
    const message = error["message"];
    if (
      (code === "invalid_request" ||
        code === "forbidden" ||
        code === "not_found" ||
        code === "file_not_found" ||
        code === "project_not_found" ||
        code === "project_changed" ||
        code === "internal_error") &&
      typeof message === "string"
    ) {
      return { code, message };
    }
  } catch {
    return null;
  }
  return null;
}
import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";
