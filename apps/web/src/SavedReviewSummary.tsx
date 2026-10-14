import type { CommentStore } from "./comments.ts";

export function SavedReviewSummary({
  store,
  endpoint,
  message,
  onFeedback,
  onRetry,
  onExport,
  onChooseProject = null,
}: {
  store: CommentStore;
  endpoint: string;
  message: string;
  onFeedback: () => void;
  onRetry: (() => void) | null;
  onExport: () => void;
  onChooseProject?: (() => void) | null;
}) {
  return (
    <section class="saved-review-summary" aria-label="Saved project review">
      <p class="eyebrow">SAVED ON THIS DEVICE</p>
      <h2>{message}</h2>
      <p class="sidebar-project-path">{endpoint}</p>
      <p class="sidebar-project-path">{store.projectPath}</p>
      <p>
        {store.drafts.length} saved draft{store.drafts.length === 1 ? "" : "s"} ·{" "}
        {store.history.length} copy history {store.history.length === 1 ? "entry" : "entries"}
      </p>
      <p class="review-hint">
        Feedback is available here. Source quotes are saved captures; current code has not been
        verified.
      </p>
      <div class="local-data-actions">
        <button type="button" onClick={onFeedback}>
          Open saved feedback & history
        </button>
        {onRetry !== null && (
          <button type="button" onClick={onRetry}>
            Retry live access
          </button>
        )}
        <button type="button" onClick={onExport}>
          Export project review
        </button>
        {onChooseProject !== null && (
          <button type="button" onClick={onChooseProject}>
            Choose another project
          </button>
        )}
      </div>
    </section>
  );
}
