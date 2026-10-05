import { useState } from "preact/hooks";
import type { LanguageOption, Project } from "../shared/api.ts";
import type { CommitDetail, CommitFileChange } from "../shared/git.ts";
import { fetchCommitDiff } from "./git-api.ts";
import { DiffCardFrame } from "./DiffCardFrame.tsx";
import { useDiffLoading } from "./diff-loading.ts";
import { useLanguageOverride } from "./language-override.ts";
import { CommitMeta } from "./CommitMeta.tsx";

const collapsedCommits = new Map<string, Set<string>>();

function CommitCard({
  projectId,
  detail,
  file,
  expanded,
  onToggle,
  wrap,
  languages,
}: {
  projectId: string;
  detail: CommitDetail;
  file: CommitFileChange;
  expanded: boolean;
  onToggle: () => void;
  wrap: boolean;
  languages: readonly LanguageOption[];
}) {
  const { override, effectiveOverride, changeLanguage } = useLanguageOverride(
    projectId,
    file.path,
    languages,
  );
  const key = JSON.stringify([
    "commit",
    projectId,
    detail.oid,
    detail.comparison.kind === "empty" ? "empty" : detail.comparison.oid,
    file.path,
    effectiveOverride,
  ]);
  const { current, retry } = useDiffLoading(expanded, {
    key,
    read: (signal) => fetchCommitDiff(projectId, detail.oid, file.path, effectiveOverride, signal),
    errorMessage: "Commit diff could not be loaded",
  });
  return (
    <DiffCardFrame
      mode={{ kind: "inspect", file }}
      id={`commit-diff-${detail.oid}-${encodeURIComponent(file.path)}`}
      expanded={expanded}
      onToggle={onToggle}
      languages={languages}
      override={override}
      onLanguage={changeLanguage}
      current={current}
      requestKey={key}
      retry={retry}
      wrap={wrap}
    />
  );
}

export function CommitViewer({
  project,
  detail,
  wrap,
  languages,
}: {
  project: Project;
  detail: CommitDetail;
  wrap: boolean;
  languages: readonly LanguageOption[];
}) {
  const key = `${project.id}:${detail.oid}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => collapsedCommits.get(key) ?? new Set(),
  );
  function toggle(path: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      collapsedCommits.delete(key);
      collapsedCommits.set(key, next);
      while (collapsedCommits.size > 64) {
        const oldest = collapsedCommits.keys().next().value;
        if (oldest === undefined) break;
        collapsedCommits.delete(oldest);
      }
      return next;
    });
  }
  return (
    <div class="commit-view" data-commit={detail.oid}>
      <section class="commit-message-card" aria-label="Commit message">
        <pre class="commit-message">{detail.message || "No commit message."}</pre>
        <CommitMeta source={{ kind: "detail", commit: detail }} />
        {detail.scope !== "" && <p class="commit-scope">Files scoped to /{detail.scope}</p>}
      </section>
      {detail.comparison.kind === "missing_parent" ? (
        <p class="status-message" role="status">
          The parent is missing from local history. This commit’s diff is unavailable in this
          shallow repository.
        </p>
      ) : detail.files.length === 0 ? (
        <p class="status-message">No file changes in this project scope.</p>
      ) : (
        <div class="commit-diff-list">
          {detail.files.map((file) => (
            <CommitCard
              key={file.path}
              projectId={project.id}
              detail={detail}
              file={file}
              expanded={!collapsed.has(file.path)}
              onToggle={() => toggle(file.path)}
              wrap={wrap}
              languages={languages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
