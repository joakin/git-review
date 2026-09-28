import { useEffect, useState } from "preact/hooks";
import type { ChangeEntry, DiffHunk, DiffResult, LanguageOption } from "../shared/api.ts";
import { fetchProjectDiff } from "./api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";
import { anchorForLine, type CommentAnchor, type DraftComment } from "./comments.ts";

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
};

export function diffCardKey(entry: ChangeEntry): string {
  return `${entry.layer}:${entry.path}`;
}

export function diffCardId(entry: ChangeEntry): string {
  return `diff-${encodeURIComponent(diffCardKey(entry))}`;
}

function HunkRows({ hunk, entry, onComment, drafts }: { hunk: DiffHunk; entry: ChangeEntry; onComment: (anchor: CommentAnchor) => void; drafts: readonly DraftComment[] }) {
  const gutter = (index: number, side: "old" | "new") => {
    const anchor = anchorForLine(entry.layer, entry.path, hunk, index, side);
    if (anchor === null) return <span class="diff-number diff-number-empty" aria-hidden="true" />;
    const count = drafts.filter((draft) => draft.anchor.side === side && draft.anchor.line === anchor.line).length;
    return <button class={`diff-number diff-number-button${count > 0 ? " diff-number-commented" : ""}`} type="button" aria-label={`${side === "old" ? "Old" : "New"} line ${anchor.line}${count > 0 ? `, ${count} comments` : ""}. Add comment`} title={`Comment on ${side} line ${anchor.line}`} onClick={() => onComment(anchor)}>{anchor.line}{count > 0 && <span class="diff-comment-dot" aria-hidden="true" />}</button>;
  };
  return <div class="diff-hunk">
    <div class="diff-hunk-label"><span>{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</span></div>
    {hunk.lines.map((line, index) => <div class={`diff-row diff-row-${line.kind}`} key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}>
      <span class="diff-sign" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
      {gutter(index, "old")}
      {gutter(index, "new")}
      <code class="diff-code">{line.tokens.map((token, tokenIndex) => <span class={`syntax-token syntax-token-${token.role}`} key={tokenIndex}>{token.text}</span>)}{line.noNewlineAtEnd && <span class="diff-no-newline"> No newline at end</span>}</code>
    </div>)}
  </div>;
}

function DiffBody({ result, wrap, entry, onComment, drafts }: { result: DiffResult; wrap: boolean; entry: ChangeEntry; onComment: (anchor: CommentAnchor) => void; drafts: readonly DraftComment[] }) {
  if (result.kind === "stale") return <p class="diff-message">The file changed while loading. Refreshing its status…</p>;
  if (result.kind === "conflict") return <p class="diff-message">This file has unresolved Git conflicts. A conflict view is planned for a later slice.</p>;
  if (result.kind === "too_large") return <p class="diff-message">This diff is too large for the current text view.</p>;
  if (result.kind === "binary") {
    const label = result.reason === "symlink" ? "a symbolic link" : result.reason === "submodule" ? "a submodule" : "binary content";
    return <p class="diff-message">This change contains {label}; there are no text lines to show.</p>;
  }
  if (result.hunks.length === 0) return <p class="diff-message">No text lines changed. This can happen with a rename, mode change, or empty file.</p>;
  return <div class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`} aria-label="File diff">
    <div class="diff-scroll-content">
      {result.hunks.map((hunk, index) => <HunkRows hunk={hunk} entry={entry} onComment={onComment} drafts={drafts} key={`${index}:${hunk.oldStart}:${hunk.newStart}`} />)}
    </div>
  </div>;
}

export function DiffCard({ entry, projectId, revision, refreshKey, expanded, wrap, languages, onToggle, onStale, onComment, drafts }: DiffCardProps) {
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
      {languages.length > 0 && <div class="diff-language-row"><label>Language <select value={override ?? "auto"} onChange={(event) => {
        const value = event.currentTarget.value === "auto" ? null : event.currentTarget.value;
        setOverride(value);
        saveLanguageOverride(projectId, entry.path, value);
      }}><option value="auto">Auto detect</option><option value="text">Plain text</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
        {current.kind === "ready" && current.value.kind === "text" && <span>{current.value.syntax.kind === "highlighted" ? current.value.syntax.language : "Plain text"}</span>}
      </div>}
      {current.kind === "loading" && <p class="diff-message">Loading diff…</p>}
      {current.kind === "error" && <div class="diff-message" role="alert">{current.message} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      {current.kind === "ready" && <DiffBody result={current.value} wrap={wrap} entry={entry} onComment={onComment} drafts={drafts} />}
    </div>}
  </article>;
}
