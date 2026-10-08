import type {
  ChangeEntry,
  ChangeLayer,
  LanguageOption,
  ProjectStatus,
  ReviewChangeEntry,
} from "../shared/api.ts";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { ChangeStats, ChangeGroupStats, ChangeGroupNotes } from "./ChangeStats.tsx";
import type { CommentAnchor, DraftComment, ReviewSide } from "./comments.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { diffCardKey, DiffCard } from "./DiffCard.tsx";
import { ContentHeading } from "./ContentHeading.tsx";
import type { LoadState } from "./load-state.ts";
import { BulkDiffControls } from "./BulkDiffControls.tsx";

type ChangesModel = {
  projectPath: string;
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
  notifyStale: (revision: string, changeToken: string, refreshKey: number) => void;
  toggleEntry: (entry: ChangeEntry) => void;
  expandAll: () => void;
  collapseAll: () => void;
  comment: (anchor: CommentAnchor) => void;
  openFile: (path: string) => void;
};

const changeLayers: readonly { key: ChangeLayer; label: string }[] = [
  { key: "conflict", label: "Conflicts" },
  { key: "staged", label: "Staged" },
  { key: "unstaged", label: "Unstaged" },
  { key: "untracked", label: "Untracked" },
];
const noDrafts: readonly DraftComment[] = [];

function ChangeGroups({
  entries,
  onSelect,
}: {
  entries: readonly ReviewChangeEntry[];
  onSelect: (entry: ChangeEntry) => void;
}) {
  return (
    <div class="change-groups change-groups-compact">
      {changeLayers.map(({ key, label }) => {
        const group = entries.filter((entry) => entry.layer === key);
        if (key === "conflict" && group.length === 0) return null;
        return (
          <section class={`change-group change-group-${key}`} key={key}>
            <h2>
              <span>{label}</span>
              <span class="change-heading-counts">
                {group.length > 0 && key !== "conflict" && <ChangeGroupStats entries={group} />}
                <span class="change-count">{group.length}</span>
              </span>
            </h2>
            {key !== "conflict" && <ChangeGroupNotes entries={group} />}
            {group.length === 0 ? (
              <p class="change-empty">No {label.toLowerCase()} files</p>
            ) : (
              <ul>
                {group.map((entry) => (
                  <li key={diffCardKey(entry)}>
                    <button
                      class="change-row-button"
                      type="button"
                      onClick={() => onSelect(entry)}
                      aria-label={`Open ${entry.layer} diff for ${entry.path}`}
                    >
                      <span class={`change-mark change-mark-${entry.kind}`} aria-hidden="true">
                        {entry.kind === "conflicted"
                          ? "!"
                          : entry.kind === "deleted"
                            ? "−"
                            : entry.kind === "added"
                              ? "+"
                              : "•"}
                      </span>
                      <span class="change-file">
                        <strong title={entry.path}>{entry.path}</strong>
                        <small class="change-metadata">
                          <span class="change-description">
                            <span class="change-kind">{entry.kind.replace("_", " ")}</span>
                            {entry.oldPath === null ? "" : ` from ${entry.oldPath}`}
                            {entry.isSubmodule ? " · submodule" : ""}
                          </span>
                          <ChangeStats stats={entry.stats} />
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ChangesSidebar({
  status,
  onSelect,
  onReviewAll,
}: {
  status: LoadState<ProjectStatus>;
  onSelect: (entry: ChangeEntry) => void;
  onReviewAll: () => void;
}) {
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;
  return (
    <div class="sidebar-changes">
      {status.kind === "loading" && (
        <DelayedLoading className="sidebar-message" message="Reading Git changes…" />
      )}
      {status.kind === "error" && (
        <p class="sidebar-error" role="alert">
          {status.message}
        </p>
      )}
      {status.kind === "ready" && status.value.kind === "not_git" && (
        <p class="sidebar-message">This folder is not a Git worktree.</p>
      )}
      {gitStatus !== null && (
        <>
          <button class="changes-review-all" type="button" onClick={onReviewAll}>
            Review all changes <span aria-hidden="true">→</span>
          </button>
          <ChangeGroups entries={gitStatus.entries} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}

function ChangeSection({
  layer,
  label,
  entries,
  children,
}: {
  layer: ChangeLayer;
  label: string;
  entries: readonly ReviewChangeEntry[];
  children: ComponentChildren;
}) {
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLElement>(null);
  function measureHeading(): void {
    const container = section.current;
    const header = heading.current;
    if (container === null || header === null) return;
    const height = header.getBoundingClientRect().height;
    // A hidden phone content view keeps its last visible offset for the next selection.
    if (height > 0) container.style.setProperty("--change-section-heading-height", `${height}px`);
  }
  useLayoutEffect(measureHeading);
  useLayoutEffect(() => {
    const header = heading.current;
    if (header === null) return;
    const observer = new ResizeObserver(measureHeading);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <section class={`diff-section diff-section-${layer}`} ref={section}>
      <header class="diff-section-heading" ref={heading}>
        <h3>
          <button
            type="button"
            class="diff-section-jump"
            aria-label={`Go to start of ${label.toLowerCase()} changes`}
            onClick={() => section.current?.scrollIntoView({ block: "start", behavior: "instant" })}
          >
            <span>{label}</span>
            <span class="change-heading-counts">
              {entries.length > 0 && layer !== "conflict" && <ChangeGroupStats entries={entries} />}
              <span class="change-count">{entries.length}</span>
            </span>
          </button>
        </h3>
        {layer !== "conflict" && <ChangeGroupNotes entries={entries} />}
      </header>
      {children}
    </section>
  );
}

export function ChangesView({
  model,
  commands,
}: {
  model: ChangesModel;
  commands: ChangesCommands;
}) {
  const {
    projectPath,
    status,
    refreshing,
    pendingUpdate,
    checkError,
    refreshKey,
    expandedKeys,
    wrap,
    languages,
    drafts,
    reattachSide,
  } = model;
  const gitStatus = status.kind === "ready" && status.value.kind === "git" ? status.value : null;
  const draftsByCard = useMemo(() => {
    const grouped = new Map<string, DraftComment[]>();
    for (const draft of drafts) {
      if (draft.anchor.kind !== "diff") continue;
      const key = diffCardKey(draft.anchor);
      const group = grouped.get(key);
      if (group === undefined) grouped.set(key, [draft]);
      else group.push(draft);
    }
    return grouped;
  }, [drafts]);
  return (
    <>
      <ContentHeading title="Changed files" onBack={commands.back}>
        <BulkDiffControls
          canExpand={
            gitStatus?.entries.some((entry) => !expandedKeys.has(diffCardKey(entry))) ?? false
          }
          canCollapse={
            gitStatus?.entries.some((entry) => expandedKeys.has(diffCardKey(entry))) ?? false
          }
          onExpand={commands.expandAll}
          onCollapse={commands.collapseAll}
        />
        <button type="button" aria-pressed={wrap} onClick={commands.toggleWrap}>
          {wrap ? "Wrap: on" : "Wrap: off"}
        </button>
        <span class="visually-hidden" role="status">
          {pendingUpdate && !refreshing ? "New edits are available. Use Update to load them." : ""}
        </span>
        {pendingUpdate && (
          <button
            class="changes-update"
            type="button"
            disabled={refreshing}
            onClick={commands.refresh}
          >
            {refreshing ? "Updating…" : "New edits · Update"}
          </button>
        )}
        <button type="button" disabled={refreshing} onClick={commands.refresh}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </ContentHeading>
      {checkError && (
        <p class="changes-check-error" role="status">
          Could not check for new edits. Refresh is still available.
        </p>
      )}
      {status.kind === "loading" && (
        <DelayedLoading className="status-message" message="Reading Git changes…" />
      )}
      {status.kind === "error" && (
        <p class="status-message" role="alert">
          {status.message}
        </p>
      )}
      {status.kind === "ready" && status.value.kind === "not_git" && (
        <p class="status-message">
          This folder is not a Git worktree. Use Files to browse its contents.
        </p>
      )}
      {gitStatus !== null && (
        <>
          {gitStatus.entries.length === 0 && (
            <p class="status-message">No changes in this folder.</p>
          )}
          <div class="diff-groups">
            {changeLayers.map(({ key, label }) => {
              const group = gitStatus.entries.filter((entry) => entry.layer === key);
              if (key === "conflict" && group.length === 0) return null;
              return (
                <ChangeSection layer={key} label={label} entries={group} key={key}>
                  {group.length === 0 ? (
                    <p class="diff-section-empty">No {label.toLowerCase()} files</p>
                  ) : (
                    group.map((entry) => (
                      <DiffCard
                        key={JSON.stringify([projectPath, diffCardKey(entry)])}
                        entry={entry}
                        projectPath={projectPath}
                        revision={gitStatus.revision}
                        changeToken={gitStatus.changeToken}
                        refreshKey={refreshKey}
                        expanded={expandedKeys.has(diffCardKey(entry))}
                        wrap={wrap}
                        languages={languages}
                        onToggle={() => commands.toggleEntry(entry)}
                        onOpenFile={() => commands.openFile(entry.path)}
                        onStale={() =>
                          commands.notifyStale(
                            gitStatus.revision,
                            gitStatus.changeToken,
                            refreshKey,
                          )
                        }
                        onComment={commands.comment}
                        reattachSide={reattachSide}
                        drafts={draftsByCard.get(diffCardKey(entry)) ?? noDrafts}
                      />
                    ))
                  )}
                </ChangeSection>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
