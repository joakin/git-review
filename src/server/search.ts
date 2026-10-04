import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Project, SearchMatch, SearchResponse } from "../shared/api.ts";
import { expectNonNegativeInteger, expectRecord, expectString } from "../shared/validation.ts";
import { AppError } from "./paths.ts";
import { validateProjectFilePath } from "./project-files.ts";

const maxMatches = 100;
const maxOutputBytes = 8 * 1024 * 1024;
const maxRecordBytes = 2 * 1024 * 1024;
const timeoutMs = 10_000;
const maxExcerptLength = 240;

function executableAt(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ripgrepExecutable(): string {
  const configured = process.env["GIT_REVIEW_RG_PATH"];
  if (configured !== undefined) {
    if (!isAbsolute(configured) || !executableAt(configured))
      throw new AppError(
        "internal_error",
        503,
        "Search is unavailable: GIT_REVIEW_RG_PATH must point to an executable ripgrep binary",
      );
    return configured;
  }
  const pathEntries = (process.env["PATH"] ?? "").split(":").filter((entry) => entry !== "");
  for (const directory of ["/opt/homebrew/bin", "/usr/local/bin", ...pathEntries]) {
    const candidate = join(directory, "rg");
    if (executableAt(candidate)) return candidate;
  }
  throw new AppError(
    "internal_error",
    503,
    "Search is unavailable: install ripgrep or set GIT_REVIEW_RG_PATH",
  );
}

export function validateSearchQuery(value: unknown): string {
  if (typeof value !== "string")
    throw new AppError("invalid_request", 400, "Specify a search query");
  const query = value.trim();
  if (query.length === 0 || query.length > 128 || /[\0\r\n]/.test(query))
    throw new AppError("invalid_request", 400, "Search query must be 1–128 characters on one line");
  return query;
}

function excerptFor(line: string, query: string): string {
  const source = line.replace(/[\r\n]+$/, "").replaceAll("\r", " ");
  if (source.length <= maxExcerptLength) return source;
  const matchIndex = source.indexOf(query);
  const start = Math.max(
    0,
    Math.min(matchIndex < 0 ? 0 : matchIndex - 60, source.length - maxExcerptLength),
  );
  const end = start + maxExcerptLength;
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function parseMatch(raw: unknown, query: string): SearchMatch | null {
  const record = expectRecord(raw, "ripgrep record");
  if (record["type"] !== "match") return null;
  const data = expectRecord(record["data"], "ripgrep match");
  const rawPath = expectRecord(data["path"], "ripgrep path");
  const rawLines = expectRecord(data["lines"], "ripgrep line");
  // The Files API cannot address a non-UTF-8 path or display a non-UTF-8 line.
  if (rawPath["bytes"] !== undefined || rawLines["bytes"] !== undefined) return null;
  const emittedPath = expectString(rawPath["text"], "ripgrep path");
  const path = validateProjectFilePath(
    emittedPath.startsWith("./") ? emittedPath.slice(2) : emittedPath,
  );
  if (path === "") throw new Error("Ripgrep returned an empty path");
  const line = expectNonNegativeInteger(data["line_number"], "ripgrep line number");
  if (line === 0) throw new Error("Ripgrep returned line zero");
  const source = expectString(rawLines["text"], "ripgrep line text");
  return { path, line, excerpt: excerptFor(source, query) };
}

export async function searchProject(
  project: Project,
  rawQuery: unknown,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const query = validateSearchQuery(rawQuery);
  const executable = ripgrepExecutable();
  const args = [
    "--json",
    "--no-config",
    "--hidden",
    "-g",
    "!.git/",
    "-F",
    "-n",
    "--max-filesize",
    "1M",
    "-e",
    query,
    ".",
  ];
  return new Promise<SearchResponse>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: project.absolutePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const matches: SearchMatch[] = [];
    let pending = Buffer.alloc(0);
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = signal?.aborted ?? false;
    let failure: unknown = null;
    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    if (aborted) child.kill();

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated || failure !== null) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        truncated = true;
        child.kill();
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(10);
      while (newline !== -1) {
        const recordBytes = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        if (recordBytes.byteLength > maxRecordBytes) {
          truncated = true;
          child.kill();
          return;
        }
        try {
          const source = new TextDecoder("utf-8", { fatal: true }).decode(recordBytes);
          const match = parseMatch(JSON.parse(source) as unknown, query);
          if (match !== null) {
            if (matches.length === maxMatches) {
              truncated = true;
              child.kill();
              return;
            }
            matches.push(match);
          }
        } catch (error: unknown) {
          failure = error;
          child.kill();
          return;
        }
        newline = pending.indexOf(10);
      }
      if (pending.byteLength > maxRecordBytes) {
        truncated = true;
        child.kill();
      }
    });
    // Keep stderr drained without echoing host paths or subprocess details to the browser.
    child.stderr.resume();
    child.on("error", (error: unknown) => {
      failure = error;
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (aborted) {
        reject(new AppError("internal_error", 499, "Search was cancelled"));
        return;
      }
      if (timedOut) {
        reject(
          new AppError("internal_error", 503, "Search timed out. Narrow the folder or try again."),
        );
        return;
      }
      if (
        failure !== null ||
        (!truncated && pending.byteLength > 0) ||
        (!truncated && code !== 0 && code !== 1)
      ) {
        reject(
          new AppError(
            "internal_error",
            503,
            "Search could not be completed. Check folder permissions and try again.",
          ),
        );
        return;
      }
      resolve({ query, matches, truncated });
    });
  });
}
