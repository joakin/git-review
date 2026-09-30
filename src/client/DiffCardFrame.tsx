import type { ChangeEntry, DiffResult, LanguageOption } from "../shared/api.ts";
import type { CommitFileChange } from "../shared/git.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { DiffBody, type DiffInteraction } from "./DiffBody.tsx";

export type DiffState = { kind: "loading" } | { kind: "ready"; value: DiffResult } | { kind: "error"; message: string };
type CardSource = { kind: "working"; entry: ChangeEntry } | { kind: "commit"; file: CommitFileChange };

export function DiffCardFrame({ source, id, expanded, onToggle, languages, override, onLanguage, current, requestKey, retry, wrap, interaction }: {
  source: CardSource; id: string; expanded: boolean; onToggle: () => void;
  languages: readonly LanguageOption[]; override: string | null; onLanguage: (value: string | null) => void;
  current: DiffState; requestKey: string; retry: () => void; wrap: boolean; interaction: DiffInteraction;
}) {
  const path = source.kind === "working" ? source.entry.path : source.file.path;
  const label = source.kind === "working" ? source.entry.layer : "commit";
  const kind = source.kind === "working" ? source.entry.kind : source.file.kind;
  const oldPath = source.kind === "working" ? source.entry.oldPath : source.file.old.kind === "present" && source.file.old.path !== path ? source.file.old.path : null;
  const submodule = source.kind === "working" ? source.entry.isSubmodule : [source.file.old, source.file.new].some((side) => side.kind === "present" && side.mode === "160000");
  const modeChange = source.kind === "commit" && source.file.old.kind === "present" && source.file.new.kind === "present" && source.file.old.mode !== source.file.new.mode ? ` · mode ${source.file.old.mode} → ${source.file.new.mode}` : "";
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
      {current.kind === "ready" && <DiffBody result={current.value} wrap={wrap} interaction={interaction} />}
    </div>}
  </article>;
}
