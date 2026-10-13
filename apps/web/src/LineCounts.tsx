const countFormat = new Intl.NumberFormat();

/** Shared count typography, locale formatting and accessible wording for Git and Changes. */
export function LineCounts({ added, deleted }: { added: number; deleted: number }) {
  const label = `${countFormat.format(added)} added lines, ${countFormat.format(deleted)} deleted lines`;
  return (
    <span class="line-counts" dir="ltr" title={label} aria-label={label}>
      <span class="line-added">+{countFormat.format(added)}</span>
      <span class="line-deleted">−{countFormat.format(deleted)}</span>
    </span>
  );
}
