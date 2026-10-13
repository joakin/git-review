import type { Project } from "@git-review/shared/api";
import {
  contextStep,
  maxContextResponseBytes,
  parseDiffContextRequest,
  type DiffContextRequest,
  type DiffContextResponse,
} from "@git-review/shared/diff-context";
import { readProjectPatch } from "./git-diff.ts";
import { readProjectStatus } from "./git-status.ts";
import { workingDiffSources } from "./working-diff-sources.ts";
import {
  contextLines,
  diffContextContent,
  sourceLines,
  type ContextContent,
} from "./diff-context-content.ts";
import { AppError, type ApprovedRoot } from "./paths.ts";
import { languageOverride } from "./syntax.ts";
import { withDiffSyntax } from "./diff-syntax.ts";

export async function readDiffContext(
  root: ApprovedRoot,
  project: Project,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let request: DiffContextRequest;
  try {
    request = parseDiffContextRequest(body);
    if (request.language !== null && languageOverride(request.language) === null)
      throw new Error("Unsupported context language");
  } catch {
    throw new AppError("invalid_request", 400, "Invalid diff context request");
  }
  const reply = (value: DiffContextResponse) => {
    const encoded = JSON.stringify(value);
    return new Response(
      Buffer.byteLength(encoded) > maxContextResponseBytes
        ? JSON.stringify({ kind: "unavailable", reason: "limit" })
        : encoded,
      { headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  };
  const status = await readProjectStatus(project.absolutePath);
  if (signal.aborted) return new Response(null, { status: 499 });
  if (
    status.kind !== "git" ||
    status.revision !== request.revision ||
    status.changeToken !== request.changeToken
  )
    return reply({ kind: "stale" });
  const entry = status.entries.find(
    (entry) => entry.layer === request.layer && entry.path === request.path,
  );
  if (entry === undefined) throw new AppError("not_found", 404, "Changed file was not found");
  const sources = await workingDiffSources(root, project, entry);
  const [old, next, diff] = await Promise.all([
    request.kind === "expand" || request.anchors.some((anchor) => anchor.side === "old")
      ? sources.readOld()
      : Promise.resolve({ kind: "text" as const, text: "" }),
    request.kind === "expand" || request.anchors.some((anchor) => anchor.side === "new")
      ? sources.readNew()
      : Promise.resolve({ kind: "text" as const, text: "" }),
    request.kind === "expand" ? readProjectPatch(root, project, entry) : Promise.resolve(null),
  ]);
  let response: DiffContextResponse;
  if (old.kind === "stale" || next.kind === "stale" || diff?.kind === "stale")
    response = { kind: "stale" };
  else if (old.kind === "limit" || next.kind === "limit")
    response = { kind: "unavailable", reason: "limit" };
  else if (request.kind === "check") {
    const lines = {
      old: old.kind === "text" ? sourceLines(old.text) : [],
      new: next.kind === "text" ? sourceLines(next.text) : [],
    };
    response = {
      kind: "checked",
      matches: request.anchors.map((anchor) => {
        const side = lines[anchor.side];
        return (
          side[anchor.line - 1] === anchor.sourceText &&
          (side[anchor.line - 2] ?? null) === anchor.before &&
          (side[anchor.line] ?? null) === anchor.after
        );
      }),
    };
  } else if (old.kind !== "text" || next.kind !== "text" || diff?.kind !== "text")
    response = { kind: "unavailable", reason: "source" };
  else {
    let content: ContextContent | null = null;
    try {
      content = diffContextContent(diff, old.text, next.text);
    } catch {
      /* A mutable comparison stopped matching its exact sources. */
    }
    if (content === null || content.metadata.source !== request.source)
      response = { kind: "stale" };
    else {
      const gap = content.metadata.gaps.find((gap) => gap.id === request.gap);
      if (
        gap === undefined ||
        request.up + request.down >= gap.count ||
        (gap.id === 0 && request.direction === "down") ||
        (gap.id === diff.hunks.length && request.direction === "up")
      )
        throw new AppError("invalid_request", 400, "Invalid diff context range");
      const count = Math.min(contextStep, gap.count - request.up - request.down);
      const offset = request.direction === "down" ? request.down : gap.count - request.up - count;
      const lines = contextLines(content, gap.id, offset, count);
      const decorated = await withDiffSyntax(
        {
          kind: "text",
          syntax: { kind: "plain", reason: "unavailable" },
          hunks: [
            {
              oldStart: gap.oldStart + offset,
              newStart: gap.newStart + offset,
              oldCount: count,
              newCount: count,
              lines,
            },
          ],
        },
        entry.path,
        request.language,
        () => Promise.resolve(old.text),
        () => Promise.resolve(next.text),
      );
      const tokens = decorated.hunks[0]?.lines;
      response = {
        kind: "expanded",
        source: request.source,
        gap: gap.id,
        offset,
        lines: lines.map((line, index) => ({
          ...line,
          tokens: tokens?.[index]?.tokens ?? line.tokens,
        })),
      };
    }
  }
  const after = await readProjectStatus(project.absolutePath);
  if (signal.aborted) return new Response(null, { status: 499 });
  return reply(
    after.kind === "git" &&
      after.revision === request.revision &&
      after.changeToken === request.changeToken
      ? response
      : { kind: "stale" },
  );
}
