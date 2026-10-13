import type { CommitDetail, CommitStats, CommitSummary } from "@git-review/shared/git";
import { LineCounts } from "./LineCounts.tsx";

type MetaSource =
  { kind: "list"; commit: CommitSummary } | { kind: "detail"; commit: CommitDetail };
const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const exactDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "long",
});
const countFormat = new Intl.NumberFormat();

function comparisonLabel(detail: CommitDetail): { label: string; title: string } {
  if (detail.comparison.kind === "empty")
    return { label: "(root)", title: "Compared with an empty tree" };
  const name = detail.parents.length > 1 ? "first parent" : "parent";
  return {
    label: `(${name}: ${detail.comparison.oid.slice(0, 8)})`,
    title: `${name}: ${detail.comparison.oid}`,
  };
}

function LineTotals({ stats }: { stats: CommitStats }) {
  if (stats.kind === "unavailable")
    return (
      <span
        class="commit-stats"
        title={
          stats.reason === "missing_parent"
            ? "The parent is missing from local history."
            : "Statistics exceeded the read limit."
        }
      >
        Stats unavailable
      </span>
    );
  const label = `${countFormat.format(stats.added)} added lines, ${countFormat.format(stats.deleted)} deleted lines${stats.binaryFiles === 0 ? "" : `, ${stats.binaryFiles} binary ${stats.binaryFiles === 1 ? "file" : "files"}`}`;
  return (
    <span class="commit-stats" title={label} aria-label={label}>
      <LineCounts added={stats.added} deleted={stats.deleted} />
      {stats.binaryFiles > 0 && (
        <span class="commit-binary">{countFormat.format(stats.binaryFiles)} binary</span>
      )}
    </span>
  );
}

export function CommitMeta({ source }: { source: MetaSource }) {
  const commit = source.commit;
  const date = new Date(commit.date);
  const parent = source.kind === "detail" ? comparisonLabel(source.commit) : null;
  return (
    <span class={`commit-meta commit-meta-${source.kind}`}>
      <span class="commit-meta-row">
        <span class="commit-author">{commit.author}</span>
        <time dateTime={commit.date} title={`${exactDateFormat.format(date)} · ${commit.date}`}>
          {dateFormat.format(date)}
        </time>
      </span>
      <span class="commit-meta-row">
        <span class="commit-id-group">
          <code dir="ltr">{source.kind === "list" ? commit.oid.slice(0, 8) : commit.oid}</code>
          {parent !== null && (
            <span class="commit-comparison" title={parent.title}>
              {parent.label}
            </span>
          )}
        </span>
        <LineTotals stats={commit.stats} />
      </span>
    </span>
  );
}
