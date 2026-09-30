import { useEffect, useState } from "preact/hooks";
import type { LanguageOption, Project } from "../shared/api.ts";
import type { CommitDetail, CommitFileChange } from "../shared/git.ts";
import { fetchCommitDiff } from "./git-api.ts";
import { DiffCardFrame, type DiffState } from "./DiffCardFrame.tsx";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";
import { readCachedDiff, rememberDiff } from "./diff-cache.ts";
import { CommitMeta } from "./CommitMeta.tsx";

const collapsedCommits = new Map<string, Set<string>>();

function CommitCard({ projectId, detail, file, expanded, onToggle, wrap, languages }: { projectId: string; detail: CommitDetail; file: CommitFileChange; expanded: boolean; onToggle: () => void; wrap: boolean; languages: readonly LanguageOption[] }) {
  const [override, setOverride] = useState<string | null>(() => readLanguageOverride(projectId, file.path));
  const effective = override === null || override === "text" || languages.some((language) => language.id === override) ? override : null;
  const key = JSON.stringify(["commit", projectId, detail.oid, detail.comparison.kind === "empty" ? "empty" : detail.comparison.oid, file.path, effective]);
  const [loaded, setLoaded] = useState<{ key: string; state: DiffState } | null>(null);
  const [retry, setRetry] = useState(0);
  const cached = expanded ? readCachedDiff(key) : null;
  const current: DiffState = loaded?.key === key ? loaded.state : cached === null ? { kind: "loading" } : { kind: "ready", value: cached };
  useEffect(() => {
    if (!expanded || current.kind === "ready") return;
    const controller = new AbortController();
    setLoaded({ key, state: { kind: "loading" } });
    fetchCommitDiff(projectId, detail.oid, file.path, effective, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      rememberDiff(key, value);
      setLoaded({ key, state: { kind: "ready", value } });
    }, (error: unknown) => { if (!controller.signal.aborted) setLoaded({ key, state: { kind: "error", message: error instanceof Error ? error.message : "Commit diff could not be loaded" } }); });
    return () => controller.abort();
  }, [expanded, projectId, detail.oid, file.path, key, retry]);
  return <DiffCardFrame source={{ kind: "commit", file }} id={`commit-diff-${detail.oid}-${encodeURIComponent(file.path)}`} expanded={expanded} onToggle={onToggle} languages={languages} override={override} onLanguage={(value) => { setOverride(value); saveLanguageOverride(projectId, file.path, value); }} current={current} requestKey={key} retry={() => setRetry((value) => value + 1)} wrap={wrap} interaction={{ kind: "inspect" }} />;
}

export function CommitViewer({ project, detail, wrap, languages }: { project: Project; detail: CommitDetail; wrap: boolean; languages: readonly LanguageOption[] }) {
  const key = `${project.id}:${detail.oid}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => collapsedCommits.get(key) ?? new Set());
  function toggle(path: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      collapsedCommits.delete(key);
      collapsedCommits.set(key, next);
      while (collapsedCommits.size > 64) { const oldest = collapsedCommits.keys().next().value; if (oldest === undefined) break; collapsedCommits.delete(oldest); }
      return next;
    });
  }
  return <div class="commit-view" data-commit={detail.oid}>
    <section class="commit-message-card" aria-label="Commit message">
      <pre class="commit-message">{detail.message || "No commit message."}</pre>
      <CommitMeta source={{ kind: "detail", commit: detail }} />
      {detail.scope !== "" && <p class="commit-scope">Files scoped to /{detail.scope}</p>}
    </section>
    {detail.comparison.kind === "missing_parent" ? <p class="status-message" role="status">The parent is missing from local history. This commit’s diff is unavailable in this shallow repository.</p> : detail.files.length === 0 ? <p class="status-message">No file changes in this project scope.</p> : <div class="commit-diff-list">{detail.files.map((file) => <CommitCard key={file.path} projectId={project.id} detail={detail} file={file} expanded={!collapsed.has(file.path)} onToggle={() => toggle(file.path)} wrap={wrap} languages={languages} />)}</div>}
  </div>;
}
