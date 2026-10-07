import { memo } from "preact/compat";
import { CodeRenderBlocks } from "./CodeRenderBlocks.tsx";
import { useCodeRendering } from "./code-rendering.ts";
import { useMemo } from "preact/hooks";
import { useStableCallback } from "./use-stable-callback.ts";
import { lineActionPosition, useLineAction, useLineTap } from "./line-action.ts";
import type { ChangeEntry, DiffHunk, DiffLine, DiffResult } from "../shared/api.ts";
import {
  anchorForLine,
  type DiffCommentAnchor,
  type DraftComment,
  type ReviewSide,
} from "./comments.ts";
import { SelectableCode } from "./code-selection.tsx";
import { MediaDiff } from "./MediaPreview.tsx";
import { decorateDiffTokens } from "./diff-detail.ts";

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

type LineReveal = (hunk: DiffHunk, index: number, row: HTMLElement, clientX: number) => void;
type DraftCounts = Record<ReviewSide, ReadonlyMap<number, number>>;

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
}: {
  resource: DiffResult;
  hunk: DiffHunk;
  index: number;
  line: DiffLine;
  source: DiffSource;
  oldCount: number;
  newCount: number;
  onReveal: LineReveal;
  onComment: (anchor: DiffCommentAnchor) => void;
}) {
  const lineTap = useLineTap((_, row, x) => onReveal(hunk, index, row, x));
  const anchors = useMemo(
    () =>
      source.kind === "review"
        ? {
            old: anchorForLine(source.entry.layer, source.entry.path, hunk, index, "old"),
            new: anchorForLine(source.entry.layer, source.entry.path, hunk, index, "new"),
          }
        : null,
    [source, hunk, index],
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
              onReveal(hunk, index, row, row.getBoundingClientRect().left + 100);
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
  return (
    <div
      class={`diff-row diff-row-${line.kind}`}
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
            onReveal(hunk, index, row, rect.left + Math.min(rect.width / 2, 140));
          }
        }}
      />
      <SelectableCode
        className="diff-code"
        resource={resource}
        projectPath={source.kind === "review" ? source.projectPath : null}
        text={line.text}
        anchor={
          source.kind === "review"
            ? (anchors?.[preferredSide(line.kind, source.reattachSide)] ?? null)
            : null
        }
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
}: {
  resource: DiffResult;
  hunk: DiffHunk;
  source: DiffSource;
  draftCounts: DraftCounts;
  onReveal: LineReveal;
  onComment: (anchor: DiffCommentAnchor) => void;
}) {
  return (
    <div class="diff-hunk">
      <div class="diff-hunk-label">
        <span>{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</span>
      </div>
      <CodeRenderBlocks>
        {hunk.lines.map((line, index) => (
          <DiffRow
            key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
            resource={resource}
            hunk={hunk}
            index={index}
            line={line}
            source={source}
            oldCount={line.oldLine === null ? 0 : (draftCounts.old.get(line.oldLine) ?? 0)}
            newCount={line.newLine === null ? 0 : (draftCounts.new.get(line.newLine) ?? 0)}
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
}: {
  result: DiffResult;
  wrap: boolean;
  interaction: DiffInteraction;
}) {
  const [action, setAction] = useLineAction<LineAction>(result, wrap);
  const codePane = useCodeRendering(result, wrap);
  const rowCount = useMemo(
    () =>
      result.kind === "text"
        ? result.hunks.reduce((count, hunk) => count + hunk.lines.length, 0)
        : 0,
    [result],
  );
  const drafts = interaction.kind === "review" ? interaction.drafts : noDrafts;
  const draftCounts = useMemo<DraftCounts>(() => {
    const counts = { old: new Map<number, number>(), new: new Map<number, number>() };
    for (const draft of drafts) {
      if (draft.anchor.kind !== "diff") continue;
      const side = counts[draft.anchor.side];
      side.set(draft.anchor.line, (side.get(draft.anchor.line) ?? 0) + 1);
    }
    return counts;
  }, [drafts]);
  const projectPath = interaction.kind === "review" ? interaction.projectPath : null;
  const layer = interaction.kind === "review" ? interaction.entry.layer : null;
  const path = interaction.kind === "review" ? interaction.entry.path : null;
  const reattachSide = interaction.kind === "review" ? interaction.reattachSide : null;
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
    (hunk: DiffHunk, index: number, row: HTMLElement, clientX: number) => {
      const line = hunk.lines[index];
      if (line === undefined) return;
      const position = lineActionPosition(row, clientX);
      if (position === null) return;
      let action: LineAction["action"];
      if (interaction.kind === "inspect") action = { kind: "inspect" };
      else {
        const anchor = anchorForLine(
          interaction.entry.layer,
          interaction.entry.path,
          hunk,
          index,
          preferredSide(line.kind, interaction.reattachSide),
        );
        if (anchor === null) return;
        const count =
          (line.oldLine === null ? 0 : (draftCounts.old.get(line.oldLine) ?? 0)) +
          (line.newLine === null ? 0 : (draftCounts.new.get(line.newLine) ?? 0));
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
    return (
      <p class="diff-message">
        The file changed while loading. Choose Update or Refresh to read the latest edits.
      </p>
    );
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
      <div
        class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`}
        aria-label="File diff"
        ref={codePane.ref}
        data-code-contained={codePane.contained ? "" : undefined}
        style={{ "--code-row-count": rowCount, "--code-hunk-count": result.hunks.length }}
      >
        <div class="diff-scroll-content">
          {result.hunks.map((hunk, index) => (
            <HunkRows
              resource={result}
              hunk={hunk}
              source={source}
              onComment={onComment}
              draftCounts={draftCounts}
              onReveal={reveal}
              key={`${index}:${hunk.oldStart}:${hunk.newStart}`}
            />
          ))}
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
