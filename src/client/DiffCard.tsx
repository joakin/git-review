import { useEffect, useState } from "preact/hooks";
import type { ChangeEntry, LanguageOption } from "../shared/api.ts";
import { fetchProjectDiff } from "./api.ts";
import { readLanguageOverride, saveLanguageOverride } from "./storage.ts";
import { type CommentAnchor, type DraftComment, type ReviewSide } from "./comments.ts";
import { DiffCardFrame, type DiffState } from "./DiffCardFrame.tsx";
import { diffCacheKey, readCachedDiff, rememberDiff } from "./diff-cache.ts";

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
  const [override, setOverride] = useState<string | null>(() =>
    readLanguageOverride(projectId, entry.path),
  );
  const effectiveOverride =
    override === null ||
    override === "text" ||
    languages.some((language) => language.id === override)
      ? override
      : null;
  const requestKey = diffCacheKey({
    projectId,
    layer: entry.layer,
    path: entry.path,
    revision,
    changeToken,
    refreshKey,
    language: effectiveOverride,
  });
  const [loaded, setLoaded] = useState<{ key: string; state: DiffState } | null>(null);
  const [retry, setRetry] = useState(0);
  const cached = expanded ? readCachedDiff(requestKey) : null;
  const current: DiffState =
    loaded?.key === requestKey
      ? loaded.state
      : cached === null
        ? { kind: "loading" }
        : { kind: "ready", value: cached };

  useEffect(() => {
    if (!expanded || current.kind === "ready") return;
    const controller = new AbortController();
    setLoaded({ key: requestKey, state: { kind: "loading" } });
    fetchProjectDiff(
      projectId,
      entry.layer,
      entry.path,
      revision,
      effectiveOverride,
      controller.signal,
    ).then(
      (value) => {
        if (controller.signal.aborted) return;
        rememberDiff(requestKey, value);
        setLoaded({ key: requestKey, state: { kind: "ready", value } });
        if (value.kind === "stale") onStale();
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            state: {
              kind: "error",
              message: error instanceof Error ? error.message : "Diff could not be loaded",
            },
          });
      },
    );
    return () => controller.abort();
  }, [expanded, projectId, entry.layer, entry.path, requestKey, retry]);

  return (
    <DiffCardFrame
      mode={{ kind: "review", projectId, entry, onComment, drafts, reattachSide }}
      id={diffCardId(entry)}
      expanded={expanded}
      onToggle={onToggle}
      languages={languages}
      override={override}
      onLanguage={(value) => {
        setOverride(value);
        saveLanguageOverride(projectId, entry.path, value);
      }}
      current={current}
      requestKey={requestKey}
      retry={() => setRetry((value) => value + 1)}
      wrap={wrap}
    />
  );
}
