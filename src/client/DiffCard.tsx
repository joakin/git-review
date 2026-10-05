import type { ChangeEntry, LanguageOption } from "../shared/api.ts";
import { fetchProjectDiff } from "./api.ts";
import { type CommentAnchor, type DraftComment, type ReviewSide } from "./comments.ts";
import { DiffCardFrame } from "./DiffCardFrame.tsx";
import { diffCacheKey } from "./diff-cache.ts";
import { useDiffLoading } from "./diff-loading.ts";
import { useLanguageOverride } from "./language-override.ts";

type DiffCardProps = {
  entry: ChangeEntry;
  projectId: string;
  revision: string;
  changeToken: string;
  refreshKey: number;
  expanded: boolean;
  wrap: boolean;
  languages: readonly LanguageOption[];
  onToggle: () => void;
  onStale: () => void;
  onComment: (anchor: CommentAnchor) => void;
  drafts: readonly DraftComment[];
  reattachSide: ReviewSide | null;
};

export function diffCardKey(entry: ChangeEntry): string {
  return `${entry.layer}:${entry.path}`;
}

export function diffCardId(entry: ChangeEntry): string {
  return `diff-${encodeURIComponent(diffCardKey(entry))}`;
}

export function DiffCard({
  entry,
  projectId,
  revision,
  changeToken,
  refreshKey,
  expanded,
  wrap,
  languages,
  onToggle,
  onStale,
  onComment,
  drafts,
  reattachSide,
}: DiffCardProps) {
  const { override, effectiveOverride, changeLanguage } = useLanguageOverride(
    projectId,
    entry.path,
    languages,
  );
  const requestKey = diffCacheKey({
    projectId,
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
      fetchProjectDiff(projectId, entry.layer, entry.path, revision, effectiveOverride, signal),
    errorMessage: "Diff could not be loaded",
    onLoaded: (value) => {
      if (value.kind === "stale") onStale();
    },
  });

  return (
    <DiffCardFrame
      mode={{ kind: "review", projectId, entry, onComment, drafts, reattachSide }}
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
    />
  );
}
