import type { DiffResult, LanguageOption } from "../shared/api.ts";
import type { CommitFileChange } from "../shared/git.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { DiffBody, type DiffInteraction } from "./DiffBody.tsx";

export type DiffState = { kind: "loading" } | { kind: "ready"; value: DiffResult } | { kind: "error"; message: string };
type DiffCardMode = Extract<DiffInteraction, { kind: "review" }> | { kind: "inspect"; file: CommitFileChange };

export function DiffCardFrame({ mode, id, expanded, onToggle, languages, override, onLanguage, current, requestKey, retry, wrap }: {
  mode: DiffCardMode; id: string; expanded: boolean; onToggle: () => void;
  languages: readonly LanguageOption[]; override: string | null; onLanguage: (value: string | null) => void;
  current: DiffState; requestKey: string; retry: () => void; wrap: boolean;
}) {
  const path = mode.kind === "review" ? mode.entry.path : mode.file.path;
  const label = mode.kind === "review" ? mode.entry.layer : "commit";
  const kind = mode.kind === "review" ? mode.entry.kind : mode.file.kind;
  const oldPath = mode.kind === "review" ? mode.entry.oldPath : mode.file.old.kind === "present" && mode.file.old.path !== path ? mode.file.old.path : null;
  const submodule = mode.kind === "review" ? mode.entry.isSubmodule : [mode.file.old, mode.file.new].some((side) => side.kind === "present" && side.mode === "160000");
  const modeChange = mode.kind === "inspect" && mode.file.old.kind === "present" && mode.file.new.kind === "present" && mode.file.old.mode !== mode.file.new.mode ? ` · mode ${mode.file.old.mode} → ${mode.file.new.mode}` : "";
  return <article class={`diff-card diff-card-${label}`} id={id} data-layer={label} data-path={path}>
    <button class="diff-card-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span class="diff-card-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      <span class="diff-card-title"><strong>{path}</strong><small><span class="change-kind">{kind.replace("_", " ")}</span>{oldPath === null ? "" : ` from ${oldPath}`}{submodule ? " · submodule" : ""}{modeChange}</small></span>
      <span class="diff-card-layer">{label}</span>
    </button>
    {expanded && <div class="diff-card-body">
      {languages.length > 0 && (current.kind !== "ready" || current.value.kind === "text") && <div class="diff-language-row"><label>Language <select value={override ?? "auto"} onChange={(event) => onLanguage(event.currentTarget.value === "auto" ? null : event.currentTarget.value)}><option value="auto">Auto detect</option><option value="text">Plain text</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
        {current.kind === "ready" && current.value.kind === "text" && <span>{current.value.syntax.kind === "highlighted" ? current.value.syntax.language : "Plain text"}</span>}
      </div>}
      {current.kind === "loading" && <DelayedLoading key={requestKey} className="diff-message" message="Loading diff…" />}
      {current.kind === "error" && <div class="diff-message" role="alert">{current.message} <button type="button" onClick={retry}>Retry</button></div>}
      {current.kind === "ready" && <DiffBody result={current.value} wrap={wrap} interaction={mode} />}
    </div>}
  </article>;
}
