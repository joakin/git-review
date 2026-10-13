import type { ChangeLineStats, ReviewChangeEntry } from "@git-review/shared/api";
import { summarizeChangeStats } from "@git-review/shared/change-line-stats";
import { LineCounts } from "./LineCounts.tsx";

export function ChangeStats({ stats }: { stats: ChangeLineStats }) {
  if (stats.kind === "text") return <LineCounts added={stats.added} deleted={stats.deleted} />;
  const reason =
    stats.kind === "binary"
      ? "Binary files do not have text line counts."
      : stats.kind === "not_applicable"
        ? {
            conflict: "Line counts are not available for conflicted files.",
            symlink: "Symbolic links do not have source line counts.",
            submodule: "Submodules do not have source line counts.",
          }[stats.reason]
        : {
            limit: "Statistics exceeded the read limit.",
            read_error: "Statistics could not be read. Refresh to retry.",
            changed: "The file changed while statistics were read. Refresh to retry.",
          }[stats.reason];
  return (
    <span class="change-stats-state" title={reason} aria-label={reason}>
      {stats.kind === "binary"
        ? "Binary"
        : stats.kind === "not_applicable"
          ? "—"
          : "Stats unavailable"}
    </span>
  );
}

export function ChangeGroupStats({ entries }: { entries: readonly ReviewChangeEntry[] }) {
  const stats = summarizeChangeStats(entries);
  if (stats.textFiles === 0) return null;
  return (
    <span class="change-group-stats">
      {stats.unavailableFiles > 0 && <span>Known</span>}
      <LineCounts added={stats.added} deleted={stats.deleted} />
    </span>
  );
}

export function ChangeGroupNotes({ entries }: { entries: readonly ReviewChangeEntry[] }) {
  const stats = summarizeChangeStats(entries);
  const notes = [
    ...(stats.binaryFiles === 0 ? [] : [`${stats.binaryFiles} binary`]),
    ...(stats.nonTextFiles === 0 ? [] : [`${stats.nonTextFiles} without line counts`]),
    ...(stats.unavailableFiles === 0 ? [] : [`${stats.unavailableFiles} unavailable`]),
  ];
  return notes.length === 0 ? null : <p class="change-stats-note">{notes.join(" · ")}</p>;
}
