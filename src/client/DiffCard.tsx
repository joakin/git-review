import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ChangeEntry, DiffHunk, DiffResult, LanguageOption } from "../shared/api.ts";
import { fetchProjectDiff } from "./api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";
import { anchorForLine, type CommentAnchor, type DraftComment, type ReviewSide } from "./comments.ts";
import { MediaDiff } from "./MediaPreview.tsx";
import { decorateDiffTokens } from "./diff-detail.ts";

type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; value: DiffResult }
  | { kind: "error"; message: string };

type DiffCardProps = {
  entry: ChangeEntry;
  projectId: string;
  revision: string;
  refreshKey: number;
  expanded: boolean;
  wrap: boolean;
  languages: readonly LanguageOption[];
  onToggle: () => void;
  onStale: () => void;
  onComment: (anchor: CommentAnchor) => void;
  drafts: readonly DraftComment[];
  reattachSide: ReviewSide | null;
};

type LineAction = {
  row: HTMLElement;
  clientX: number;
  anchor: CommentAnchor;
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  count: number;
  left: number;
  top: number;
  width: number;
};

type LineReveal = (hunk: DiffHunk, index: number, row: HTMLElement, clientX: number) => void;

function lineActionPosition(row: HTMLElement, clientX: number): { left: number; top: number; width: number } | null {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const width = Math.min(280, viewportWidth - 16);
  if (width < 160) return null;
  const rect = row.getBoundingClientRect();
  const topbarBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? viewportTop;
  const cardHeadingBottom = row.closest(".diff-card")?.querySelector(".diff-card-toggle")?.getBoundingClientRect().bottom ?? topbarBottom;
  const topLimit = Math.max(viewportTop + 8, topbarBottom + 8, cardHeadingBottom + 8);
  if (!row.isConnected || rect.bottom <= topLimit || rect.top >= viewportTop + viewportHeight - 8 || topLimit + 48 > viewportTop + viewportHeight - 8) return null;
  const left = Math.max(viewportLeft + 8, Math.min(clientX - width / 2, viewportLeft + viewportWidth - width - 8));
  const above = rect.top - 56;
  const below = rect.bottom + 8;
  let top = above >= topLimit ? above : below + 48 <= viewportTop + viewportHeight - 8 ? below : topLimit;
  const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
  if (feedback !== undefined && left < feedback.right && left + width > feedback.left && top < feedback.bottom && top + 48 > feedback.top) {
    if (feedback.top - 56 >= topLimit) top = feedback.top - 56;
    else if (feedback.bottom + 56 <= viewportTop + viewportHeight - 8) top = feedback.bottom + 8;
  }
  return { left, top, width };
}

export function diffCardKey(entry: ChangeEntry): string {
  return `${entry.layer}:${entry.path}`;
}

export function diffCardId(entry: ChangeEntry): string {
  return `diff-${encodeURIComponent(diffCardKey(entry))}`;
}

function HunkRows({ hunk, entry, onComment, onReveal, drafts }: { hunk: DiffHunk; entry: ChangeEntry; onComment: (anchor: CommentAnchor) => void; onReveal: LineReveal; drafts: readonly DraftComment[] }) {
  const press = useRef<{ pointerId: number; index: number; x: number; y: number; startedAt: number } | null>(null);
  const completedTap = useRef<{ index: number; x: number } | null>(null);
  const gutter = (index: number, side: "old" | "new") => {
    const anchor = anchorForLine(entry.layer, entry.path, hunk, index, side);
    if (anchor === null) return <span class="diff-number diff-number-empty" aria-hidden="true" />;
    const count = drafts.filter((draft) => draft.anchor.side === side && draft.anchor.line === anchor.line).length;
    return <button class={`diff-number diff-number-button${count > 0 ? " diff-number-commented" : ""}`} type="button" aria-label={`${side === "old" ? "Old" : "New"} line ${anchor.line}${count > 0 ? `, ${count} comments` : ""}. Add comment`} title={`Comment on ${side} line ${anchor.line}`} onClick={() => onComment(anchor)}>{anchor.line}{count > 0 && <span class="diff-comment-dot" aria-hidden="true" />}</button>;
  };
  return <div class="diff-hunk">
    <div class="diff-hunk-label"><span>{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</span></div>
    {hunk.lines.map((line, index) => <div class={`diff-row diff-row-${line.kind}`} key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
      onPointerDown={(event) => {
        completedTap.current = null;
        if (!event.isPrimary || event.button !== 0 || document.getSelection()?.isCollapsed === false || (event.target instanceof Element && event.target.closest("button, a"))) { press.current = null; return; }
        press.current = { pointerId: event.pointerId, index, x: event.clientX, y: event.clientY, startedAt: performance.now() };
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (start !== null && start.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) press.current = null;
      }}
      onPointerCancel={() => { press.current = null; }}
      onPointerUp={(event) => {
        const start = press.current;
        press.current = null;
        if (start === null || start.pointerId !== event.pointerId || start.index !== index || performance.now() - start.startedAt > 500 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 || document.getSelection()?.isCollapsed === false) return;
        completedTap.current = { index, x: event.clientX };
      }}
      onClick={(event) => {
        const tap = completedTap.current;
        completedTap.current = null;
        if (tap !== null && tap.index === index && document.getSelection()?.isCollapsed !== false) onReveal(hunk, index, event.currentTarget, tap.x);
      }}>
      <span class="diff-sign" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
      {gutter(index, "old")}
      {gutter(index, "new")}
      <button class="diff-mobile-line-trigger" type="button" aria-label={`Review ${line.kind} line${line.oldLine === null ? "" : `, old ${line.oldLine}`}${line.newLine === null ? "" : `, new ${line.newLine}`}`} onClick={(event) => {
        const row = event.currentTarget.parentElement;
        if (row instanceof HTMLElement) { const rect = row.getBoundingClientRect(); onReveal(hunk, index, row, rect.left + Math.min(rect.width / 2, 140)); }
      }} />
      <code class="diff-code">{decorateDiffTokens(line.tokens, line.detail).map((token, tokenIndex) => <span class={`syntax-token syntax-token-${token.role}${token.changed ? " diff-word-change" : ""}`} key={tokenIndex}>{token.text}</span>)}{line.noNewlineAtEnd && <span class="diff-no-newline"> No newline at end</span>}</code>
    </div>)}
  </div>;
}

function DiffBody({ result, wrap, entry, onComment, drafts, reattachSide }: { result: DiffResult; wrap: boolean; entry: ChangeEntry; onComment: (anchor: CommentAnchor) => void; drafts: readonly DraftComment[]; reattachSide: ReviewSide | null }) {
  const [action, setAction] = useState<LineAction | null>(null);
  useEffect(() => { setAction(null); }, [result, wrap]);
  useLayoutEffect(() => {
    if (action === null) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".diff-line-action")) setAction(null);
    };
    const dismissSelection = () => { if (document.getSelection()?.isCollapsed === false) setAction(null); };
    const dismissEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAction(null); };
    const trackRow = () => {
      const position = lineActionPosition(action.row, action.clientX);
      if (position === null) { setAction(null); return; }
      setAction((current) => current === null || (current.left === position.left && current.top === position.top && current.width === position.width) ? current : { ...current, ...position });
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("selectionchange", dismissSelection);
    document.addEventListener("scroll", trackRow, true);
    window.addEventListener("keydown", dismissEscape);
    window.addEventListener("resize", trackRow);
    window.visualViewport?.addEventListener("scroll", trackRow);
    window.visualViewport?.addEventListener("resize", trackRow);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("selectionchange", dismissSelection);
      document.removeEventListener("scroll", trackRow, true);
      window.removeEventListener("keydown", dismissEscape);
      window.removeEventListener("resize", trackRow);
      window.visualViewport?.removeEventListener("scroll", trackRow);
      window.visualViewport?.removeEventListener("resize", trackRow);
    };
  }, [action]);

  const reveal: LineReveal = (hunk, index, row, clientX) => {
    const line = hunk.lines[index];
    if (line === undefined) return;
    const side = line.kind === "removed" || (line.kind === "context" && reattachSide === "old") ? "old" : "new";
    const anchor = anchorForLine(entry.layer, entry.path, hunk, index, side);
    if (anchor === null) return;
    const position = lineActionPosition(row, clientX);
    if (position === null) return;
    const count = drafts.filter((draft) => (draft.anchor.side === "old" && draft.anchor.line === line.oldLine) || (draft.anchor.side === "new" && draft.anchor.line === line.newLine)).length;
    setAction({ row, clientX, anchor, kind: line.kind, oldLine: line.oldLine, newLine: line.newLine, count, ...position });
  };

  if (result.kind === "media") return <MediaDiff old={result.old} next={result.new} />;
  if (result.kind === "stale") return <p class="diff-message">The file changed while loading. Refreshing its status…</p>;
  if (result.kind === "conflict") return <p class="diff-message">This file has unresolved Git conflicts. A conflict view is planned for a later slice.</p>;
  if (result.kind === "too_large") return <p class="diff-message">This diff is too large for the current text view.</p>;
  if (result.kind === "binary") {
    const label = result.reason === "symlink" ? "a symbolic link" : result.reason === "submodule" ? "a submodule" : "binary content";
    return <p class="diff-message">This change contains {label}; there are no text lines to show.</p>;
  }
  if (result.hunks.length === 0) return <p class="diff-message">No text lines changed. This can happen with a rename, mode change, or empty file.</p>;
  return <>
    <div class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`} aria-label="File diff">
      <div class="diff-scroll-content">
        {result.hunks.map((hunk, index) => <HunkRows hunk={hunk} entry={entry} onComment={onComment} onReveal={reveal} drafts={drafts} key={`${index}:${hunk.oldStart}:${hunk.newStart}`} />)}
      </div>
    </div>
    {action !== null && <button class="diff-line-action" type="button" style={{ left: `${action.left}px`, top: `${action.top}px`, width: `${action.width}px` }} aria-label={`${entry.layer} ${action.kind} line, ${action.oldLine === null ? "" : `old ${action.oldLine}, `}${action.newLine === null ? "" : `new ${action.newLine}, `}Comment on ${action.anchor.side} line ${action.anchor.line}`} onClick={() => { setAction(null); onComment(action.anchor); }}>
      {action.kind !== "context" && <span class="diff-line-action-sign" aria-hidden="true">{action.kind === "added" ? "+" : "−"}</span>}
      <span class="diff-line-action-numbers" aria-hidden="true">{action.oldLine !== null && <span><small>OLD</small> {action.oldLine}</span>}{action.newLine !== null && <span><small>NEW</small> {action.newLine}</span>}</span>
      <span class="diff-line-action-divider" aria-hidden="true" /><strong>Comment{action.count > 0 ? ` (${action.count})` : ""}</strong>
    </button>}
  </>;
}

export function DiffCard({ entry, projectId, revision, refreshKey, expanded, wrap, languages, onToggle, onStale, onComment, drafts, reattachSide }: DiffCardProps) {
  const [override, setOverride] = useState<string | null>(() => readLanguageOverride(projectId, entry.path));
  const effectiveOverride = override === null || override === "text" || languages.some((language) => language.id === override) ? override : null;
  const requestKey = `${revision}:${refreshKey}:${effectiveOverride ?? "auto"}`;
  const [loaded, setLoaded] = useState<{ key: string; state: DiffState } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!expanded || (loaded?.key === requestKey && loaded.state.kind === "ready")) return;
    const controller = new AbortController();
    setLoaded({ key: requestKey, state: { kind: "loading" } });
    fetchProjectDiff(projectId, entry.layer, entry.path, revision, effectiveOverride, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setLoaded({ key: requestKey, state: { kind: "ready", value } });
        if (value.kind === "stale") onStale();
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, state: { kind: "error", message: error instanceof Error ? error.message : "Diff could not be loaded" } });
      },
    );
    return () => controller.abort();
  }, [expanded, projectId, entry.layer, entry.path, requestKey, retry]);

  const current = loaded?.key === requestKey ? loaded.state : { kind: "loading" } as const;
  return <article class={`diff-card diff-card-${entry.layer}`} id={diffCardId(entry)} data-layer={entry.layer} data-path={entry.path}>
    <button class="diff-card-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span class="diff-card-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      <span class="diff-card-title"><strong>{entry.path}</strong><small><span class="change-kind">{entry.kind.replace("_", " ")}</span>{entry.oldPath === null ? "" : ` from ${entry.oldPath}`}{entry.isSubmodule ? " · submodule" : ""}</small></span>
      <span class="diff-card-layer">{entry.layer}</span>
    </button>
    {expanded && <div class="diff-card-body">
      {languages.length > 0 && (current.kind !== "ready" || current.value.kind === "text") && <div class="diff-language-row"><label>Language <select value={override ?? "auto"} onChange={(event) => {
        const value = event.currentTarget.value === "auto" ? null : event.currentTarget.value;
        setOverride(value);
        saveLanguageOverride(projectId, entry.path, value);
      }}><option value="auto">Auto detect</option><option value="text">Plain text</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
        {current.kind === "ready" && current.value.kind === "text" && <span>{current.value.syntax.kind === "highlighted" ? current.value.syntax.language : "Plain text"}</span>}
      </div>}
      {current.kind === "loading" && <p class="diff-message">Loading diff…</p>}
      {current.kind === "error" && <div class="diff-message" role="alert">{current.message} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      {current.kind === "ready" && <DiffBody result={current.value} wrap={wrap} entry={entry} onComment={onComment} drafts={drafts} reattachSide={reattachSide} />}
    </div>}
  </article>;
}
