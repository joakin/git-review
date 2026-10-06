import { useEffect, useRef, useState } from "preact/hooks";
import type { FileReadResult, LanguageOption } from "../shared/api.ts";
import { fetchProjectFile } from "./api.ts";
import { useLanguageOverride } from "./language-override.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import {
  anchorForFileLine,
  type CommentAnchor,
  type DraftComment,
  type FileCommentAnchor,
} from "./comments.ts";
import { lineActionPosition, useLineAction, useLineTap } from "./line-action.ts";
import { SelectableCode } from "./code-selection.tsx";
import { MediaPreview } from "./MediaPreview.tsx";
import { DelayedLoading } from "./DelayedLoading.tsx";

type FileState =
  | { kind: "loading" }
  | { kind: "ready"; value: FileReadResult }
  | { kind: "error"; message: string };

export function FileViewer({
  projectPath,
  path,
  wrap,
  languages,
  refreshKey,
  searchTarget,
  drafts,
  onComment,
}: {
  projectPath: string;
  path: string;
  drafts: readonly DraftComment[];
  onComment: (anchor: CommentAnchor) => void;
  wrap: boolean;
  languages: readonly LanguageOption[];
  refreshKey: number;
  searchTarget: { path: string; line: number; query: string | null } | null;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const { override, effectiveOverride, changeLanguage } = useLanguageOverride(
    projectPath,
    path,
    languages,
  );
  const [state, setState] = useState<FileState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    fetchProjectFile(projectPath, path, effectiveOverride, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ kind: "ready", value });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "File could not be loaded",
          });
      },
    );
    return () => controller.abort();
  }, [projectPath, path, effectiveOverride, refreshKey, retry]);

  const result = state.kind === "ready" ? state.value : null;
  const targetMatches =
    result?.kind === "text" &&
    searchTarget !== null &&
    result.lines[searchTarget.line - 1] !== undefined &&
    (searchTarget.query === null ||
      result.lines[searchTarget.line - 1]?.text.includes(searchTarget.query) === true);
  useEffect(() => {
    if (result?.kind !== "text" || searchTarget === null) return;
    const frame = requestAnimationFrame(() => {
      const row = panelRef.current?.querySelector<HTMLElement>(
        `.file-code-row[data-line="${searchTarget.line}"]`,
      );
      row?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [result, searchTarget?.line, searchTarget?.query]);

  return (
    <article class="file-panel" data-path={path} ref={panelRef}>
      <div class="file-panel-head">
        <span class="section-label">WORKING TREE</span>
        {result?.kind === "text" && (
          <span class="file-size">
            {result.lines.length} lines · {result.byteLength} bytes
          </span>
        )}
      </div>
      {(result === null || result.kind === "text") && (
        <LanguagePicker
          languages={languages}
          override={override}
          onChange={changeLanguage}
          syntax={result?.syntax ?? null}
        />
      )}
      {state.kind === "loading" && (
        <DelayedLoading className="diff-message" message="Loading file…" />
      )}
      {state.kind === "error" && (
        <div class="diff-message" role="alert">
          {searchTarget?.query === undefined || searchTarget.query === null
            ? state.message
            : `This search result may have changed or been deleted. ${state.message} Refresh Search for updated results.`}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {result?.kind === "binary" && (
        <p class="diff-message">
          This file contains binary or invalid UTF-8 content. There are no text lines to show.
        </p>
      )}
      {result?.kind === "media" && (
        <MediaPreview resource={result.resource} path={result.path} label="Current file" />
      )}
      {result?.kind === "too_large" && (
        <p class="diff-message">This file exceeds the viewing limit for its format.</p>
      )}
      {result?.kind === "symlink" && (
        <p class="diff-message">
          This path is a symbolic link. Links are not followed in the Files view.
        </p>
      )}
      {result?.kind === "unsupported" && (
        <p class="diff-message">This is not a regular file and cannot be shown as text.</p>
      )}
      {result?.kind === "text" && searchTarget !== null && !targetMatches && (
        <p class="file-search-stale" role="status">
          {searchTarget.query === null
            ? "This line is no longer in the current file."
            : "This search result has changed. The current file is shown; refresh Search for an updated line."}
        </p>
      )}
      {result?.kind === "text" &&
        (result.lines.length === 0 ? (
          <p class="diff-message">This file is empty.</p>
        ) : (
          <FileLines
            projectPath={projectPath}
            result={result}
            wrap={wrap}
            drafts={drafts}
            onComment={onComment}
            targetLine={targetMatches ? (searchTarget?.line ?? null) : null}
          />
        ))}
    </article>
  );
}

type FileLineAction = {
  row: HTMLElement;
  clientX: number;
  left: number;
  top: number;
  width: number;
  anchor: FileCommentAnchor;
};

function FileLines({
  projectPath,
  result,
  wrap,
  drafts,
  onComment,
  targetLine,
}: {
  projectPath: string;
  result: Extract<FileReadResult, { kind: "text" }>;
  wrap: boolean;
  drafts: readonly DraftComment[];
  onComment: (anchor: CommentAnchor) => void;
  targetLine: number | null;
}) {
  const [action, setAction] = useLineAction<FileLineAction>(result, wrap);
  const counts = new Map<number, number>();
  for (const draft of drafts)
    if (draft.anchor.kind === "file" && draft.anchor.path === result.path)
      counts.set(draft.anchor.line, (counts.get(draft.anchor.line) ?? 0) + 1);
  const reveal = (index: number, row: HTMLElement, clientX: number) => {
    const anchor = anchorForFileLine(result.path, result.lines, index);
    const position = lineActionPosition(row, clientX);
    if (anchor !== null && position !== null) setAction({ row, clientX, anchor, ...position });
  };
  const lineTap = useLineTap(reveal);
  return (
    <>
      <div class={`file-code-scroll${wrap ? " file-code-wrap" : ""}`} aria-label="File contents">
        <div class="file-code-content">
          {result.lines.map((line, index) => {
            const count = counts.get(line.number) ?? 0;
            const anchor = anchorForFileLine(result.path, result.lines, index);
            return (
              <div
                class={`file-code-row${line.number === targetLine ? " file-code-row-target" : ""}`}
                data-line={line.number}
                key={line.number}
                {...lineTap(index)}
              >
                <button
                  class={`file-line-number${count > 0 ? " file-line-commented" : ""}`}
                  type="button"
                  disabled={anchor === null}
                  aria-label={`Line ${line.number}${count > 0 ? `, ${count} comments` : ""}. Add comment`}
                  title={
                    anchor === null
                      ? "This line or its context is too long to save as feedback"
                      : `Comment on working-tree line ${line.number}`
                  }
                  onClick={() => {
                    setAction(null);
                    if (anchor !== null) onComment(anchor);
                  }}
                >
                  {line.number}
                  {count > 0 && <span class="diff-comment-dot" aria-hidden="true" />}
                </button>
                <SelectableCode
                  className="file-code-line"
                  projectPath={projectPath}
                  resource={result}
                  anchor={anchor}
                  text={line.text}
                >
                  {line.tokens.map((token, tokenIndex) => (
                    <span class={`syntax-token syntax-token-${token.role}`} key={tokenIndex}>
                      {token.text}
                    </span>
                  ))}
                </SelectableCode>
              </div>
            );
          })}
        </div>
      </div>
      {action !== null && (
        <button
          class="diff-line-action file-line-action"
          type="button"
          style={{ left: `${action.left}px`, top: `${action.top}px`, width: `${action.width}px` }}
          aria-label={`Working tree line ${action.anchor.line}. Comment`}
          onClick={() => {
            setAction(null);
            onComment(action.anchor);
          }}
        >
          <span class="diff-line-action-numbers" aria-hidden="true">
            <span>
              <small>LINE</small> {action.anchor.line}
            </span>
          </span>
          <span class="diff-line-action-divider" aria-hidden="true" />
          <strong>
            Comment
            {(counts.get(action.anchor.line) ?? 0) > 0
              ? ` (${counts.get(action.anchor.line)})`
              : ""}
          </strong>
        </button>
      )}
    </>
  );
}
