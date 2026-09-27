import { useEffect, useState } from "preact/hooks";
import type { ChangeEntry, DiffHunk, DiffResult } from "../shared/api.ts";
import { fetchProjectDiff } from "./api.ts";

type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; value: DiffResult }
  | { kind: "error"; message: string };

type DiffCardProps = {
  entry: ChangeEntry;
  projectId: string;
  revision: string;
  expanded: boolean;
  wrap: boolean;
  onToggle: () => void;
  onStale: () => void;
};

export function diffCardKey(entry: ChangeEntry): string {
  return `${entry.layer}:${entry.path}`;
}

export function diffCardId(entry: ChangeEntry): string {
  return `diff-${encodeURIComponent(diffCardKey(entry))}`;
}

function HunkRows({ hunk }: { hunk: DiffHunk }) {
  return <div class="diff-hunk">
    <div class="diff-hunk-label">{`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}</div>
    {hunk.lines.map((line, index) => <div class={`diff-row diff-row-${line.kind}`} key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}>
      <span class="diff-number" aria-label={line.oldLine === null ? "No old line" : `Old line ${line.oldLine}`}>{line.oldLine ?? ""}</span>
      <span class="diff-number" aria-label={line.newLine === null ? "No new line" : `New line ${line.newLine}`}>{line.newLine ?? ""}</span>
      <span class="diff-sign" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
      <code class="diff-code">{line.text}{line.noNewlineAtEnd && <span class="diff-no-newline"> No newline at end</span>}</code>
    </div>)}
  </div>;
}

function DiffBody({ result, wrap }: { result: DiffResult; wrap: boolean }) {
  if (result.kind === "stale") return <p class="diff-message">The file changed while loading. Refreshing its status…</p>;
  if (result.kind === "conflict") return <p class="diff-message">This file has unresolved Git conflicts. A conflict view is planned for a later slice.</p>;
  if (result.kind === "too_large") return <p class="diff-message">This diff is too large for the current text view.</p>;
  if (result.kind === "binary") {
    const label = result.reason === "symlink" ? "a symbolic link" : result.reason === "submodule" ? "a submodule" : "binary content";
    return <p class="diff-message">This change contains {label}; there are no text lines to show.</p>;
  }
  if (result.hunks.length === 0) return <p class="diff-message">No text lines changed. This can happen with a rename, mode change, or empty file.</p>;
  return <div class={`diff-scroll${wrap ? " diff-scroll-wrap" : ""}`} aria-label="File diff">
    {result.hunks.map((hunk, index) => <HunkRows hunk={hunk} key={`${index}:${hunk.oldStart}:${hunk.newStart}`} />)}
  </div>;
}

export function DiffCard({ entry, projectId, revision, expanded, wrap, onToggle, onStale }: DiffCardProps) {
  const [loaded, setLoaded] = useState<{ revision: string; state: DiffState } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!expanded || (loaded?.revision === revision && loaded.state.kind === "ready")) return;
    const controller = new AbortController();
    setLoaded({ revision, state: { kind: "loading" } });
    fetchProjectDiff(projectId, entry.layer, entry.path, revision, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setLoaded({ revision, state: { kind: "ready", value } });
        if (value.kind === "stale") onStale();
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ revision, state: { kind: "error", message: error instanceof Error ? error.message : "Diff could not be loaded" } });
      },
    );
    return () => controller.abort();
  }, [expanded, projectId, entry.layer, entry.path, revision, retry]);

  const current = loaded?.revision === revision ? loaded.state : { kind: "loading" } as const;
  return <article class={`diff-card diff-card-${entry.layer}`} id={diffCardId(entry)} data-layer={entry.layer} data-path={entry.path}>
    <button class="diff-card-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span class="diff-card-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      <span class="diff-card-title"><strong>{entry.path}</strong><small><span class="change-kind">{entry.kind.replace("_", " ")}</span>{entry.oldPath === null ? "" : ` from ${entry.oldPath}`}{entry.isSubmodule ? " · submodule" : ""}</small></span>
      <span class="diff-card-layer">{entry.layer}</span>
    </button>
    {expanded && <div class="diff-card-body">
      {current.kind === "loading" && <p class="diff-message">Loading diff…</p>}
      {current.kind === "error" && <div class="diff-message" role="alert">{current.message} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      {current.kind === "ready" && <DiffBody result={current.value} wrap={wrap} />}
    </div>}
  </article>;
}
