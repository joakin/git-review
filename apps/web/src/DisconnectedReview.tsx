import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { useBrowserData } from "./BrowserDataProvider.tsx";
import { useNotifications } from "./Notifications.tsx";
import type { ClipboardWriter } from "./clipboard-writer.ts";
import { useReviewFeedback } from "./review-feedback.ts";
import { FeedbackDialog } from "./ReviewDialogs.tsx";
import { SavedReviewSummary } from "./SavedReviewSummary.tsx";
import { projectReviewBackup } from "./agent-feedback.ts";
import { downloadAgentBackup } from "./backup-download.ts";
import { useAppearancePreferences } from "./appearance-preferences.ts";

/** Recovery composition has no agent API, connection lifetime or agent requests. */
export function DisconnectedReview({
  endpoint,
  projectPath,
  clipboard,
  onChooseHost,
}: {
  endpoint: string;
  projectPath: string | null;
  clipboard: ClipboardWriter;
  onChooseHost: () => void;
}) {
  const data = useBrowserData();
  const notifications = useNotifications();
  useAppearancePreferences();
  const active = useRef(true);
  useLayoutEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const storage = useMemo(() => data.projectState(endpoint), [data, endpoint]);
  const saved = projectPath === null ? null : data.readSavedReview({ endpoint, projectPath });
  const feedback = useReviewFeedback({
    project: null,
    projectPath,
    endpoint,
    storage,
    clipboard,
    checkAnchors: null,
    ownsSession: () => active.current,
    onRevealAnchor: () => {},
    onNotice: (message, severity = "warning") =>
      notifications.push({ key: "saved-review-copy", message, severity }),
  });
  function exportReview() {
    if (projectPath === null) return;
    try {
      downloadAgentBackup(projectReviewBackup(data.exportBackup(), { endpoint, projectPath }));
      notifications.push({
        key: "project-backup",
        message: "Project review backup downloaded.",
        severity: "success",
      });
    } catch (error) {
      notifications.push({
        key: "project-backup",
        message: error instanceof Error ? error.message : "Could not export saved review.",
        severity: "error",
      });
    }
  }
  const preview = feedback.model.preview;
  return (
    <main class="local-data-setup connection-required">
      <section class="install-data-content">
        <h1>Host connection needed</h1>
        <p>This host has not been added to this client.</p>
        <p class="sidebar-project-path">{endpoint}</p>
        {saved?.kind === "ready" && feedback.model.store !== null && (
          <SavedReviewSummary
            store={feedback.model.store}
            endpoint={endpoint}
            message="Live source unavailable"
            onFeedback={feedback.actions.openPreview}
            onRetry={null}
            onExport={exportReview}
          />
        )}
        {saved?.kind === "unavailable" && (
          <p role="alert">
            Saved review data could not be read. Original records have been retained.
          </p>
        )}
        <button type="button" class="primary-action" onClick={onChooseHost}>
          Hosts & saved reviews
        </button>
      </section>
      {preview !== null && saved?.kind === "ready" && (
        <FeedbackDialog
          {...preview}
          onClose={feedback.actions.closePreview}
          onCheck={feedback.actions.check}
          onCopy={feedback.actions.copy}
          onEdit={feedback.actions.editDraft}
          onReattach={feedback.actions.reattachDraft}
          onUndo={feedback.actions.undo}
          onCopyHistory={feedback.actions.copyHistory}
          onRecovery={feedback.actions.recover}
          onBeginRecovery={feedback.actions.beginRecovery}
          onExport={exportReview}
        />
      )}
    </main>
  );
}
