import { useEffect, useRef, useState } from "preact/hooks";
import type { FileReadResult, LanguageOption } from "../shared/api.ts";
import { fetchProjectFile } from "./api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";
import { MediaPreview } from "./MediaPreview.tsx";

type FileState = { kind: "loading" } | { kind: "ready"; value: FileReadResult } | { kind: "error"; message: string };

export function FileViewer({ projectId, path, wrap, languages, refreshKey, searchTarget }: {
  projectId: string;
  path: string;
  wrap: boolean;
  languages: readonly LanguageOption[];
  refreshKey: number;
  searchTarget: { path: string; line: number; query: string | null } | null;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [override, setOverride] = useState<string | null>(() => readLanguageOverride(projectId, path));
  const [state, setState] = useState<FileState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const effectiveOverride = override === null || override === "text" || languages.some((language) => language.id === override) ? override : null;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchProjectFile(projectId, path, effectiveOverride, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setState({ kind: "ready", value }); },
      (error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "File could not be loaded" }); },
    );
    return () => controller.abort();
  }, [projectId, path, effectiveOverride, refreshKey, retry]);

  const result = state.kind === "ready" ? state.value : null;
  const targetMatches = result?.kind === "text" && searchTarget !== null && result.lines[searchTarget.line - 1] !== undefined && (searchTarget.query === null || result.lines[searchTarget.line - 1]?.text.includes(searchTarget.query) === true);
  useEffect(() => {
    if (result?.kind !== "text" || searchTarget === null) return;
    const frame = requestAnimationFrame(() => {
      const row = panelRef.current?.querySelector<HTMLElement>(`.file-code-row[data-line="${searchTarget.line}"]`);
      row?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [result, searchTarget?.line, searchTarget?.query]);

  return <article class="file-panel" data-path={path} ref={panelRef}>
    <div class="file-panel-head">
      <span class="section-label">WORKING TREE</span>
      {result?.kind === "text" && <span class="file-size">{result.lines.length} lines · {result.byteLength} bytes</span>}
    </div>
    {languages.length > 0 && (result === null || result.kind === "text") && <div class="diff-language-row"><label>Language <select value={override ?? "auto"} onChange={(event) => {
      const value = event.currentTarget.value === "auto" ? null : event.currentTarget.value;
      setOverride(value);
      saveLanguageOverride(projectId, path, value);
    }}><option value="auto">Auto detect</option><option value="text">Plain text</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
      {result?.kind === "text" && <span>{result.syntax.kind === "highlighted" ? result.syntax.language : "Plain text"}</span>}
    </div>}
    {state.kind === "loading" && <p class="diff-message">Loading file…</p>}
    {state.kind === "error" && <div class="diff-message" role="alert">{searchTarget?.query === undefined || searchTarget.query === null ? state.message : `This search result may have changed or been deleted. ${state.message} Refresh Search for updated results.`} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {result?.kind === "binary" && <p class="diff-message">This file contains binary or invalid UTF-8 content. There are no text lines to show.</p>}
    {result?.kind === "media" && <MediaPreview resource={result.resource} path={result.path} label="Current file" />}
    {result?.kind === "too_large" && <p class="diff-message">This file exceeds the viewing limit for its format.</p>}
    {result?.kind === "symlink" && <p class="diff-message">This path is a symbolic link. Links are not followed in the Files view.</p>}
    {result?.kind === "unsupported" && <p class="diff-message">This is not a regular file and cannot be shown as text.</p>}
    {result?.kind === "text" && searchTarget !== null && !targetMatches && <p class="file-search-stale" role="status">{searchTarget.query === null ? "This line is no longer in the current file." : "This search result has changed. The current file is shown; refresh Search for an updated line."}</p>}
    {result?.kind === "text" && (result.lines.length === 0 ? <p class="diff-message">This file is empty.</p> : <div class={`file-code-scroll${wrap ? " file-code-wrap" : ""}`} aria-label="File contents">
      <div class="file-code-content">{result.lines.map((line) => <div class={`file-code-row${targetMatches && line.number === searchTarget?.line ? " file-code-row-target" : ""}`} data-line={line.number} key={line.number}>
        <span class="file-line-number" aria-label={`Line ${line.number}`}>{line.number}</span>
        <code class="file-code-line">{line.tokens.map((token, index) => <span class={`syntax-token syntax-token-${token.role}`} key={index}>{token.text}</span>)}</code>
      </div>)}</div>
    </div>)}
  </article>;
}
