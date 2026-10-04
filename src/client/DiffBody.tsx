import { lineActionPosition, useLineAction, useLineTap } from "./line-action.ts";
import type { ChangeEntry, DiffHunk, DiffResult } from "../shared/api.ts";
import {
  anchorForLine,
  type DiffCommentAnchor,
  type DraftComment,
  type ReviewSide,
} from "./comments.ts";
import { MediaDiff } from "./MediaPreview.tsx";
import { decorateDiffTokens } from "./diff-detail.ts";

export type DiffInteraction =
  | {
      kind: "review";
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

function HunkRows({
  hunk,
  interaction,
  onReveal,
}: {
  hunk: DiffHunk;
  interaction: DiffInteraction;
  onReveal: LineReveal;
}) {
  const lineTap = useLineTap((index, row, x) => onReveal(hunk, index, row, x));
  const gutter = (index: number, side: "old" | "new") => {
    if (interaction.kind === "inspect") {
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
    const anchor = anchorForLine(
      interaction.entry.layer,
      interaction.entry.path,
      hunk,
      index,
      side,
    );
    if (anchor === null) return <span class="diff-number diff-number-empty" aria-hidden="true" />;
    const count = interaction.drafts.filter(
      (draft) =>
        draft.anchor.kind === "diff" &&
        draft.anchor.side === side &&
        draft.anchor.line === anchor.line,
    ).length;
    return (
      <button
        class={`diff-number diff-number-button${count > 0 ? " diff-number-commented" : ""}`}
        type="button"
        aria-label={`${side === "old" ? "Old" : "New"} line ${anchor.line}${count > 0 ? `, ${count} comments` : ""}. Add comment`}
        title={`Comment on ${side} line ${anchor.line}`}
        onClick={() => interaction.onComment(anchor)}
      >
        {anchor.line}
        {count > 0 && <span class="diff-comment-dot" aria-hidden="true" />}
      </button>
    );
  };
  return (
    <div class="diff-hunk">
      <div class="diff-hunk-label">
        <span>{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</span>
      </div>
      {hunk.lines.map((line, index) => (
        <div
          class={`diff-row diff-row-${line.kind}`}
          key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
          {...lineTap(index)}
        >
          <span class="diff-sign" aria-hidden="true">
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </span>
          {gutter(index, "old")}
          {gutter(index, "new")}
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
          <code class="diff-code">
            {decorateDiffTokens(line.tokens, line.detail).map((token, tokenIndex) => (
              <span
                class={`syntax-token syntax-token-${token.role}${token.changed ? " diff-word-change" : ""}`}
                key={tokenIndex}
              >
                {token.text}
              </span>
            ))}
            {line.noNewlineAtEnd && <span class="diff-no-newline"> No newline at end</span>}
          </code>
        </div>
      ))}
    </div>
  );
}

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

  const reveal: LineReveal = (hunk, index, row, clientX) => {
    const line = hunk.lines[index];
    if (line === undefined) return;
    const position = lineActionPosition(row, clientX);
    if (position === null) return;
    let action: LineAction["action"];
    if (interaction.kind === "inspect") action = { kind: "inspect" };
    else {
      const side =
        line.kind === "removed" || (line.kind === "context" && interaction.reattachSide === "old")
          ? "old"
          : "new";
      const anchor = anchorForLine(
        interaction.entry.layer,
        interaction.entry.path,
        hunk,
        index,
        side,
      );
      if (anchor === null) return;
      const count = interaction.drafts.filter(
        (draft) =>
          draft.anchor.kind === "diff" &&
          ((draft.anchor.side === "old" && draft.anchor.line === line.oldLine) ||
            (draft.anchor.side === "new" && draft.anchor.line === line.newLine)),
      ).length;
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
  };

  if (result.kind === "media") return <MediaDiff old={result.old} next={result.new} />;
  if (result.kind === "stale")
    return <p class="diff-message">The file changed while loading. Refreshing its status…</p>;
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
      <div class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`} aria-label="File diff">
        <div class="diff-scroll-content">
          {result.hunks.map((hunk, index) => (
            <HunkRows
              hunk={hunk}
              interaction={interaction}
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
