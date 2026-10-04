import type { ChangeEntry, ChangeLayer, LanguageOption, ProjectStatus } from "../shared/api.ts";
import type { CommentAnchor, DraftComment, ReviewSide } from "./comments.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { diffCardKey, DiffCard } from "./DiffCard.tsx";
import { Icon } from "./Icons.tsx";
import type { LoadState } from "./load-state.ts";

type ChangesModel = {
  projectId: string;
  status: LoadState<ProjectStatus>;
  refreshing: boolean;
  pendingUpdate: boolean;
  checkError: boolean;
  refreshKey: number;
  expandedKeys: ReadonlySet<string>;
  wrap: boolean;
  languages: readonly LanguageOption[];
  drafts: readonly DraftComment[];
  reattachSide: ReviewSide | null;
};
type ChangesCommands = {
  back: () => void;
  toggleWrap: () => void;
  refresh: () => void;
  toggleEntry: (entry: ChangeEntry) => void;
  comment: (anchor: CommentAnchor) => void;
};

const changeLayers: readonly { key: ChangeLayer; label: string }[] = [
  { key: "conflict", label: "Conflicts" },
  { key: "staged", label: "Staged" },
  { key: "unstaged", label: "Unstaged" },
  { key: "untracked", label: "Untracked" },
];

function ChangeGroups({ entries, onSelect }: { entries: readonly ChangeEntry[]; onSelect: (entry: ChangeEntry) => void }) {
  return <div class="change-groups change-groups-compact">
    {changeLayers.map(({ key, label }) => {
      const group = entries.filter((entry) => entry.layer === key);
      if (key === "conflict" && group.length === 0) return null;
      return <section class={`change-group change-group-${key}`} key={key}>
        <h2><span>{label}</span><span class="change-count">{group.length}</span></h2>
        {group.length === 0 ? <p class="change-empty">No {label.toLowerCase()} files</p> : <ul>
          {group.map((entry) => <li key={diffCardKey(entry)}><button class="change-row-button" type="button" onClick={() => onSelect(entry)} aria-label={`Open ${entry.layer} diff for ${entry.path}`}>
            <span class={`change-mark change-mark-${entry.kind}`} aria-hidden="true">{entry.kind === "conflicted" ? "!" : entry.kind === "deleted" ? "−" : entry.kind === "added" ? "+" : "•"}</span>
            <span class="change-file">
              <strong title={entry.path}>{entry.path}</strong>
              <small><span class="change-kind">{entry.kind.replace("_", " ")}</span>{entry.oldPath === null ? "" : ` from ${entry.oldPath}`}{entry.isSubmodule ? " · submodule" : ""}</small>
            </span>
          </button></li>)}
        </ul>}
      </section>;
    })}
  </div>;
}

export function ChangesSidebar({ status, onSelect, onReviewAll }: { status: LoadState<ProjectStatus>; onSelect: (entry: ChangeEntry) => void; onReviewAll: () => void }) {
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;
  return <div class="sidebar-changes">
    {status.kind === "loading" && <DelayedLoading className="sidebar-message" message="Reading Git changes…" />}
    {status.kind === "error" && <p class="sidebar-error" role="alert">{status.message}</p>}
    {status.kind === "ready" && status.value.kind === "not_git" && <p class="sidebar-message">This folder is not a Git worktree.</p>}
    {gitStatus !== null && <><button class="changes-review-all" type="button" onClick={onReviewAll}>Review all changes <span aria-hidden="true">→</span></button><ChangeGroups entries={gitStatus.entries} onSelect={onSelect} /></>}
  </div>;
}

export function ChangesView({ model, commands }: { model: ChangesModel; commands: ChangesCommands }) {
  const { projectId, status, refreshing, pendingUpdate, checkError, refreshKey, expandedKeys, wrap, languages, drafts, reattachSide } = model;
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;
  return <>
    <div class="changes-heading">
      <div class="content-heading-title"><button class="content-back" type="button" aria-label="Open list" onClick={commands.back}><Icon name="back" /></button><h2>Changed files</h2></div>
      <div class="changes-actions">
        <button type="button" aria-pressed={wrap} onClick={commands.toggleWrap}>{wrap ? "Wrap: on" : "Wrap: off"}</button>
        <span class="visually-hidden" role="status">{pendingUpdate && !refreshing ? "New edits are available. Use Update to load them." : ""}</span>
        {pendingUpdate && <button class="changes-update" type="button" disabled={refreshing} onClick={commands.refresh}>{refreshing ? "Updating…" : "New edits · Update"}</button>}
        <button type="button" disabled={refreshing} onClick={commands.refresh}>{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>
    </div>
    {checkError && <p class="changes-check-error" role="status">Could not check for new edits. Refresh is still available.</p>}
    {status.kind === "loading" && <DelayedLoading className="status-message" message="Reading Git changes…" />}
    {status.kind === "error" && <p class="status-message" role="alert">{status.message}</p>}
    {status.kind === "ready" && status.value.kind === "not_git" && <p class="status-message">This folder is not a Git worktree. Use Files to browse its contents.</p>}
    {gitStatus !== null && <>
      {gitStatus.entries.length === 0 && <p class="status-message">No changes in this folder.</p>}
      <div class="diff-groups">
        {changeLayers.map(({ key, label }) => {
          const group = gitStatus.entries.filter((entry) => entry.layer === key);
          if (key === "conflict" && group.length === 0) return null;
          return <section class={`diff-section diff-section-${key}`} key={key}>
            <h3><span>{label}</span><span class="change-count">{group.length}</span></h3>
            {group.length === 0 ? <p class="diff-section-empty">No {label.toLowerCase()} files</p> : group.map((entry) => <DiffCard
              key={`${projectId}:${diffCardKey(entry)}`}
              entry={entry}
              projectId={projectId}
              revision={gitStatus.revision}
              changeToken={gitStatus.changeToken}
              refreshKey={refreshKey}
              expanded={expandedKeys.has(diffCardKey(entry))}
              wrap={wrap}
              languages={languages}
              onToggle={() => commands.toggleEntry(entry)}
              onStale={commands.refresh}
              onComment={commands.comment}
              reattachSide={reattachSide}
              drafts={drafts.filter((draft) => draft.anchor.layer === entry.layer && draft.anchor.path === entry.path)}
            />)}
          </section>;
        })}
      </div>
    </>}
  </>;
}
