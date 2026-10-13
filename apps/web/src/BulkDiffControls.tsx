export function BulkDiffControls({
  canExpand,
  canCollapse,
  onExpand,
  onCollapse,
}: {
  canExpand: boolean;
  canCollapse: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  return (
    <div class="diff-bulk-controls" role="group" aria-label="Diff cards">
      <button type="button" disabled={!canExpand} onClick={onExpand}>
        Expand all
      </button>
      <button type="button" disabled={!canCollapse} onClick={onCollapse}>
        Collapse all
      </button>
    </div>
  );
}
