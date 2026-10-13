import { memo } from "preact/compat";
import { CodeRenderBlocks } from "./CodeRenderBlocks.tsx";
import { useCodeRendering } from "./code-rendering.ts";
import { useMemo } from "preact/hooks";
import { useStableCallback } from "./use-stable-callback.ts";
import { lineActionPosition, useLineAction, useLineTap } from "./line-action.ts";
import type { ChangeEntry, DiffHunk, DiffLine, DiffResult } from "@git-review/shared/api";
import {
  anchorForLine,
  type DiffCommentAnchor,
  type DraftComment,
  type ReviewSide,
} from "./comments.ts";
import { SelectableCode } from "./code-selection.tsx";
import type { SelectionSourceRow } from "./code-selection-target.ts";
import {
  diffDraftCounts,
  diffRowDraftCount,
  type DiffDraftCounts,
} from "./diff-feedback-counts.ts";
import { MediaDiff } from "./MediaPreview.tsx";
import { decorateDiffTokens } from "./diff-detail.ts";
import type { DiffContextLine } from "@git-review/shared/diff-context";
import type { DiffContextControl } from "./use-diff-context.ts";
import { anchorForContextLine } from "./diff-context-anchor.ts";
import { DiffContextGap } from "./DiffContextGap.tsx";
import { contextDisplayResource, emptyContext } from "./diff-context-state.ts";

export type DiffInteraction =
  | {
      kind: "review";
      projectPath: string;
      entry: ChangeEntry;
      onComment: (anchor: DiffCommentAnchor) => void;
      drafts: readonly DraftComment[];
      reattachSide: ReviewSide | null;
    }
  | { kind: "inspect" };

type LineAction = {
  row: HTMLElement;
  clientX: number;
  action: { kind: "comment"; anchor: DiffCommentAnchor; count: number } | { kind: "inspect" };
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  left: number;
  top: number;
  width: number;
};

type LineReveal = (
  hunk: DiffHunk,
  index: number,
  row: HTMLElement,
  clientX: number,
  context: DiffContextLine | null,
) => void;

function preferredSide(kind: DiffLine["kind"], reattachSide: ReviewSide | null): ReviewSide {
  return kind === "removed" || (kind === "context" && reattachSide === "old") ? "old" : "new";
}

type DiffSource =
  | {
      kind: "review";
      projectPath: string;
      entry: Pick<ChangeEntry, "layer" | "path">;
      reattachSide: ReviewSide | null;
    }
  | { kind: "inspect" };

const noDrafts: readonly DraftComment[] = [];

const DiffRow = memo(function DiffRow({
  resource,
  hunk,
  index,
  line,
  source,
  oldCount,
  newCount,
  onReveal,
  onComment,
  contextLine,
}: {
  resource: object;
  hunk: DiffHunk;
  index: number;
  line: DiffLine;
  source: DiffSource;
  oldCount: number;
  newCount: number;
  onReveal: LineReveal;
  onComment: (anchor: DiffCommentAnchor) => void;
  contextLine: DiffContextLine | null;
}) {
  const lineTap = useLineTap((_, row, x) => onReveal(hunk, index, row, x, contextLine));
  const anchors = useMemo(
    () =>
      source.kind === "review"
        ? {
            old:
              contextLine === null
                ? anchorForLine(source.entry.layer, source.entry.path, hunk, index, "old")
                : anchorForContextLine(source.entry.layer, source.entry.path, contextLine, "old"),
            new:
              contextLine === null
                ? anchorForLine(source.entry.layer, source.entry.path, hunk, index, "new")
                : anchorForContextLine(source.entry.layer, source.entry.path, contextLine, "new"),
          }
        : null,
    [source, hunk, index, contextLine],
  );
  const tokens = useMemo(
    () =>
      decorateDiffTokens(line.tokens, line.detail).map((token, tokenIndex) => (
        <span
          class={`syntax-token syntax-token-${token.role}${token.changed ? " diff-word-change" : ""}`}
          key={tokenIndex}
        >
          {token.text}
        </span>
      )),
    [line],
  );
  const gutter = (side: "old" | "new") => {
    if (source.kind === "inspect") {
      const line = hunk.lines[index];
      const number = side === "old" ? line?.oldLine : line?.newLine;
      if (number === null || number === undefined)
        return <span class="diff-number diff-number-empty" aria-hidden="true" />;
      return (
        <button
          class="diff-number diff-number-button"
          type="button"
          aria-label={`Inspect ${side} line ${number}`}
          onClick={(event) => {
            const row = event.currentTarget.parentElement;
            if (row instanceof HTMLElement)
              onReveal(hunk, index, row, row.getBoundingClientRect().left + 100, contextLine);
          }}
        >
          {number}
        </button>
      );
    }
    const anchor = anchors?.[side] ?? null;
    if (anchor === null) return <span class="diff-number diff-number-empty" aria-hidden="true" />;
    const count = side === "old" ? oldCount : newCount;
    return (
      <button
        class={`diff-number diff-number-button${count > 0 ? " diff-number-commented" : ""}`}
        type="button"
        aria-label={`${side === "old" ? "Old" : "New"} line ${anchor.line}${count > 0 ? `, ${count} comments` : ""}. Add comment`}
        title={`Comment on ${side} line ${anchor.line}`}
        onClick={() => onComment(anchor)}
      >
        {anchor.line}
        {count > 0 && <span class="diff-comment-dot" aria-hidden="true" />}
      </button>
    );
  };
  const selectionRow = useMemo<SelectionSourceRow>(
    () =>
      source.kind === "review" && anchors !== null
        ? {
            kind: "diff",
            text: line.text,
            lineKind: line.kind,
            preferredSide: preferredSide(line.kind, source.reattachSide),
            anchors,
            anchor: anchors[preferredSide(line.kind, source.reattachSide)],
          }
        : { kind: "inspect", text: line.text, anchor: null },
    [source, line, anchors],
  );
  return (
    <div
      class={`diff-row diff-row-${line.kind}`}
      data-old-line={line.oldLine}
      data-new-line={line.newLine}
      key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
      {...lineTap(index)}
    >
      <span class="diff-sign" aria-hidden="true">
        {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
      </span>
      {gutter("old")}
      {gutter("new")}
      <button
        class="diff-mobile-line-trigger"
        type="button"
        aria-label={`Review ${line.kind} line${line.oldLine === null ? "" : `, old ${line.oldLine}`}${line.newLine === null ? "" : `, new ${line.newLine}`}`}
        onClick={(event) => {
          const row = event.currentTarget.parentElement;
          if (row instanceof HTMLElement) {
            const rect = row.getBoundingClientRect();
            onReveal(hunk, index, row, rect.left + Math.min(rect.width / 2, 140), contextLine);
          }
        }}
      />
      <SelectableCode
        className="diff-code"
        resource={resource}
        projectPath={source.kind === "review" ? source.projectPath : null}
        row={selectionRow}
      >
        {tokens}
        {line.noNewlineAtEnd && <span class="diff-no-newline"> No newline at end</span>}
      </SelectableCode>
    </div>
  );
});

const HunkRows = memo(function HunkRows({
  resource,
  hunk,
  source,
  draftCounts,
  onReveal,
  onComment,
  contextLines,
  heading,
}: {
  resource: object;
  hunk: DiffHunk;
  source: DiffSource;
  draftCounts: DiffDraftCounts;
  onReveal: LineReveal;
  onComment: (anchor: DiffCommentAnchor) => void;
  contextLines: readonly DiffContextLine[] | null;
  heading: boolean;
}) {
  return (
    <div class="diff-hunk">
      {heading && (
        <div class="diff-hunk-label">
          <span>{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</span>
        </div>
      )}
      <CodeRenderBlocks>
        {hunk.lines.map((line, index) => (
          <DiffRow
            key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
            resource={resource}
            hunk={hunk}
            index={index}
            line={line}
            contextLine={contextLines?.[index] ?? null}
            source={source}
            oldCount={line.oldLine === null ? 0 : (draftCounts.old.get(line.oldLine)?.size ?? 0)}
            newCount={line.newLine === null ? 0 : (draftCounts.new.get(line.newLine)?.size ?? 0)}
            onReveal={onReveal}
            onComment={onComment}
          />
        ))}
      </CodeRenderBlocks>
    </div>
  );
});

export function DiffBody({
  result,
  wrap,
  interaction,
  context = null,
}: {
  result: DiffResult;
  wrap: boolean;
  interaction: DiffInteraction;
  context?: DiffContextControl | null;
}) {
  const [action, setAction] = useLineAction<LineAction>(result, wrap);
  const displayResource = contextDisplayResource(result, context?.data ?? emptyContext);
  const codePane = useCodeRendering(displayResource, wrap);
  const rowCount = useMemo(
    () =>
      result.kind === "text"
        ? result.hunks.reduce((count, hunk) => count + hunk.lines.length, 0)
        : 0,
    [result],
  );
  const drafts = interaction.kind === "review" ? interaction.drafts : noDrafts;
  const projectPath = interaction.kind === "review" ? interaction.projectPath : null;
  const layer = interaction.kind === "review" ? interaction.entry.layer : null;
  const path = interaction.kind === "review" ? interaction.entry.path : null;
  const reattachSide = interaction.kind === "review" ? interaction.reattachSide : null;
  const draftCounts = useMemo<DiffDraftCounts>(
    () =>
      layer === null || layer === "conflict" || path === null
        ? { old: new Map(), new: new Map() }
        : diffDraftCounts(drafts, layer, path),
    [drafts, layer, path],
  );
  const source = useMemo<DiffSource>(
    () =>
      projectPath !== null && layer !== null && path !== null
        ? { kind: "review", projectPath, entry: { layer, path }, reattachSide }
        : { kind: "inspect" },
    [projectPath, layer, path, reattachSide],
  );
  const onComment = useStableCallback((anchor: DiffCommentAnchor) => {
    if (interaction.kind === "review") interaction.onComment(anchor);
  });

  const reveal: LineReveal = useStableCallback(
    (
      hunk: DiffHunk,
      index: number,
      row: HTMLElement,
      clientX: number,
      contextLine: DiffContextLine | null,
    ) => {
      const line = hunk.lines[index];
      if (line === undefined) return;
      const position = lineActionPosition(row, clientX);
      if (position === null) return;
      let action: LineAction["action"];
      if (interaction.kind === "inspect") action = { kind: "inspect" };
      else {
        const anchor =
          contextLine !== null
            ? anchorForContextLine(
                interaction.entry.layer,
                interaction.entry.path,
                contextLine,
                preferredSide(line.kind, interaction.reattachSide),
              )
            : anchorForLine(
                interaction.entry.layer,
                interaction.entry.path,
                hunk,
                index,
                preferredSide(line.kind, interaction.reattachSide),
              );
        if (anchor === null) return;
        const count = diffRowDraftCount(draftCounts, line.oldLine, line.newLine);
        action = { kind: "comment", anchor, count };
      }
      setAction({
        row,
        clientX,
        action,
        kind: line.kind,
        oldLine: line.oldLine,
        newLine: line.newLine,
        ...position,
      });
    },
  );

  if (result.kind === "media") return <MediaDiff old={result.old} next={result.new} />;
  if (result.kind === "stale")
    return <p class="diff-message">Diff unavailable for the current snapshot.</p>;
  if (result.kind === "conflict")
    return (
      <p class="diff-message">
        This file has unresolved Git conflicts. A conflict view is planned for a later slice.
      </p>
    );
  if (result.kind === "too_large")
    return <p class="diff-message">This diff is too large for the current text view.</p>;
  if (result.kind === "binary") {
    const label =
      result.reason === "symlink"
        ? "a symbolic link"
        : result.reason === "submodule"
          ? "a submodule"
          : "binary content";
    return (
      <p class="diff-message">This change contains {label}; there are no text lines to show.</p>
    );
  }
  if (result.hunks.length === 0)
    return (
      <p class="diff-message">
        No text lines changed. This can happen with a rename, mode change, or empty file.
      </p>
    );
  return (
    <>
      {result.context?.kind === "unavailable" && (
        <p class="diff-message diff-context-notice">
          {result.context.reason === "limit"
            ? "More context is unavailable: the source exceeds the current read limit."
            : "More context is unavailable for this source."}
        </p>
      )}
      {context?.activity.kind === "loading" && context.activity.gap === null && (
        <p class="diff-message" role="status">
          Updating context highlighting…
        </p>
      )}
      <div
        class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`}
        aria-label="File diff"
        ref={codePane.ref}
        data-code-contained={codePane.contained ? "" : undefined}
        style={{
          "--code-row-count":
            rowCount +
            (context?.data.chunks.reduce((sum, chunk) => sum + chunk.lines.length, 0) ?? 0),
          "--code-hunk-count": result.hunks.length,
        }}
      >
        <div class="diff-scroll-content">
          {Array.from({ length: result.hunks.length + 1 }, (_, index) => {
            const hunk = result.hunks[index];
            const gap =
              result.context?.kind === "available"
                ? result.context.gaps.find((gap) => gap.id === index)
                : undefined;
            const chunks =
              context?.data.chunks
                .filter((chunk) => chunk.gap === index)
                .sort((a, b) => a.offset - b.offset) ?? [];
            const rows = (direction: "up" | "down") =>
              chunks
                .filter((chunk) => chunk.direction === direction)
                .map((chunk) => (
                  <HunkRows
                    resource={displayResource}
                    hunk={chunk.hunk}
                    source={source}
                    onComment={onComment}
                    draftCounts={draftCounts}
                    onReveal={reveal}
                    contextLines={chunk.lines}
                    heading={false}
                    key={`context:${index}:${chunk.offset}`}
                  />
                ));
            return [
              ...rows("down"),
              gap !== undefined && context !== null ? (
                <DiffContextGap
                  gap={gap}
                  hunkCount={result.hunks.length}
                  control={context}
                  key={`gap:${index}`}
                />
              ) : null,
              ...rows("up"),
              hunk === undefined ? null : (
                <HunkRows
                  resource={displayResource}
                  hunk={hunk}
                  source={source}
                  onComment={onComment}
                  draftCounts={draftCounts}
                  onReveal={reveal}
                  contextLines={null}
                  heading={context === null}
                  key={`${index}:${hunk.oldStart}:${hunk.newStart}`}
                />
              ),
            ];
          })}
        </div>
      </div>
      {action !== null && (
        <button
          class="diff-line-action"
          type="button"
          style={{ left: `${action.left}px`, top: `${action.top}px`, width: `${action.width}px` }}
          aria-label={`${interaction.kind === "review" ? interaction.entry.layer : "Historical"} ${action.kind} line, ${action.oldLine === null ? "" : `old ${action.oldLine}, `}${action.newLine === null ? "" : `new ${action.newLine}, `}${action.action.kind === "comment" ? `Comment on ${action.action.anchor.side} line ${action.action.anchor.line}` : "Close line information"}`}
          onClick={() => {
            setAction(null);
            if (action.action.kind === "comment" && interaction.kind === "review")
              interaction.onComment(action.action.anchor);
          }}
        >
          {action.kind !== "context" && (
            <span class="diff-line-action-sign" aria-hidden="true">
              {action.kind === "added" ? "+" : "−"}
            </span>
          )}
          <span class="diff-line-action-numbers" aria-hidden="true">
            {action.oldLine !== null && (
              <span>
                <small>OLD</small> {action.oldLine}
              </span>
            )}
            {action.newLine !== null && (
              <span>
                <small>NEW</small> {action.newLine}
              </span>
            )}
          </span>
          {action.action.kind === "comment" && (
            <>
              <span class="diff-line-action-divider" aria-hidden="true" />
              <strong>Comment{action.action.count > 0 ? ` (${action.action.count})` : ""}</strong>
            </>
          )}
        </button>
      )}
    </>
  );
}
