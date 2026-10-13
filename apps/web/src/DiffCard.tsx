import type { ChangeEntry, LanguageOption, ReviewChangeEntry } from "@git-review/shared/api";
import { useAgentApi } from "./AgentApiProvider.tsx";
import { type CommentAnchor, type DraftComment, type ReviewSide } from "./comments.ts";
import { DiffCardFrame } from "./DiffCardFrame.tsx";
import { diffCacheKey } from "./diff-cache.ts";
import { useDiffLoading } from "./diff-loading.ts";
import { useLanguageOverride } from "./language-override.ts";
import type { ChangeSnapshot } from "@git-review/shared/change-snapshot";
import { useDiffContext } from "./use-diff-context.ts";

type DiffCardProps = ChangeSnapshot & {
  entry: ReviewChangeEntry;
  projectPath: string;
  refreshKey: number;
  expanded: boolean;
  wrap: boolean;
  languages: readonly LanguageOption[];
  onToggle: () => void;
  onOpenFile: () => void;
  onStale: () => void;
  onComment: (anchor: CommentAnchor) => void;
  drafts: readonly DraftComment[];
  reattachSide: ReviewSide | null;
};

export function diffCardKey(entry: Pick<ChangeEntry, "layer" | "path">): string {
  return `${entry.layer}:${entry.path}`;
}

export function diffCardId(entry: ChangeEntry): string {
  return `diff-${encodeURIComponent(diffCardKey(entry))}`;
}

export function DiffCard({
  entry,
  projectPath,
  revision,
  changeToken,
  refreshKey,
  expanded,
  wrap,
  languages,
  onToggle,
  onOpenFile,
  onStale,
  onComment,
  drafts,
  reattachSide,
}: DiffCardProps) {
  const api = useAgentApi();
  const { override, effectiveOverride, changeLanguage } = useLanguageOverride(
    projectPath,
    entry.path,
    languages,
  );
  const requestKey = diffCacheKey({
    projectPath,
    layer: entry.layer,
    path: entry.path,
    revision,
    changeToken,
    refreshKey,
    language: effectiveOverride,
  });
  const { current, retry } = useDiffLoading(expanded, {
    key: requestKey,
    read: (signal) =>
      api.fetchChangeDiff(
        projectPath,
        { layer: entry.layer, path: entry.path, language: effectiveOverride },
        { revision, changeToken, refreshKey },
        signal,
      ),
    errorMessage: "Diff could not be loaded",
    onLoaded: (value) => {
      if (value.kind === "stale") onStale();
    },
  });

  const context = useDiffContext(
    expanded,
    {
      projectPath,
      layer: entry.layer,
      path: entry.path,
      revision,
      changeToken,
      refreshKey,
      language: effectiveOverride,
    },
    current.kind === "ready" ? current.value : null,
    onStale,
  );
  return (
    <DiffCardFrame
      mode={{ kind: "review", projectPath, entry, onComment, drafts, reattachSide, onOpenFile }}
      id={diffCardId(entry)}
      expanded={expanded}
      onToggle={onToggle}
      languages={languages}
      override={override}
      onLanguage={changeLanguage}
      current={current}
      requestKey={requestKey}
      retry={retry}
      wrap={wrap}
      context={context}
    />
  );
}
