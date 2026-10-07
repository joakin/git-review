import type { ChangeEntry, LanguageOption, ReviewChangeEntry } from "../shared/api.ts";
import { fetchChangeDiff } from "./change-diff-api.ts";
import { type CommentAnchor, type DraftComment, type ReviewSide } from "./comments.ts";
import { DiffCardFrame } from "./DiffCardFrame.tsx";
import { diffCacheKey } from "./diff-cache.ts";
import { useDiffLoading } from "./diff-loading.ts";
import { useLanguageOverride } from "./language-override.ts";
import type { ChangeSnapshot } from "../shared/change-snapshot.ts";

type DiffCardProps = ChangeSnapshot & {
  entry: ReviewChangeEntry;
  projectPath: string;
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
  onStale,
  onComment,
  drafts,
  reattachSide,
}: DiffCardProps) {
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
      fetchChangeDiff(
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

  return (
    <DiffCardFrame
      mode={{ kind: "review", projectPath, entry, onComment, drafts, reattachSide }}
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
