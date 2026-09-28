import { useEffect, useState } from "preact/hooks";
import type { FileReadResult, LanguageOption } from "../shared/api.ts";
import { fetchProjectFile } from "./api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";

type FileState = { kind: "loading" } | { kind: "ready"; value: FileReadResult } | { kind: "error"; message: string };

export function FileViewer({ projectId, path, wrap, languages, refreshKey }: {
  projectId: string;
  path: string;
  wrap: boolean;
  languages: readonly LanguageOption[];
  refreshKey: number;
}) {
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
  return <article class="file-panel" data-path={path}>
    <div class="file-panel-head">
      <div><span class="section-label">WORKING TREE</span><h3>{path}</h3></div>
      {result?.kind === "text" && <span class="file-size">{result.lines.length} lines · {result.byteLength} bytes</span>}
    </div>
    {languages.length > 0 && <div class="diff-language-row"><label>Language <select value={override ?? "auto"} onChange={(event) => {
      const value = event.currentTarget.value === "auto" ? null : event.currentTarget.value;
      setOverride(value);
      saveLanguageOverride(projectId, path, value);
    }}><option value="auto">Auto detect</option><option value="text">Plain text</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
      {result?.kind === "text" && <span>{result.syntax.kind === "highlighted" ? result.syntax.language : "Plain text"}</span>}
    </div>}
    {state.kind === "loading" && <p class="diff-message">Loading file…</p>}
    {state.kind === "error" && <div class="diff-message" role="alert">{state.message} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {result?.kind === "binary" && <p class="diff-message">This file contains binary or invalid UTF-8 content. There are no text lines to show.</p>}
    {result?.kind === "too_large" && <p class="diff-message">This file exceeds the 1 MiB or 20,000 line viewing limit.</p>}
    {result?.kind === "symlink" && <p class="diff-message">This path is a symbolic link. Links are not followed in the Files view.</p>}
    {result?.kind === "unsupported" && <p class="diff-message">This is not a regular file and cannot be shown as text.</p>}
    {result?.kind === "text" && (result.lines.length === 0 ? <p class="diff-message">This file is empty.</p> : <div class={`file-code-scroll${wrap ? " file-code-wrap" : ""}`} aria-label="File contents">
      <div class="file-code-content">{result.lines.map((line) => <div class="file-code-row" key={line.number}>
        <span class="file-line-number" aria-label={`Line ${line.number}`}>{line.number}</span>
        <code class="file-code-line">{line.tokens.map((token, index) => <span class={`syntax-token syntax-token-${token.role}`} key={index}>{token.text}</span>)}</code>
      </div>)}</div>
    </div>)}
  </article>;
}
