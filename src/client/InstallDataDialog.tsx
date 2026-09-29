import { useState } from "preact/hooks";
import { applyReviewBackup, createReviewBackup, maxBackupBytes, parseReviewBackup, type ReviewBackup } from "./backup.ts";
import { readCommentStore } from "./comments.ts";
import { useModal } from "./ReviewDialogs.tsx";

export type InstallPromptEvent = Event & { prompt: () => Promise<void> };

export function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

export function InstallDataDialog({ rootPath, installPrompt, onInstallHandled, onClose }: {
  rootPath: string | null;
  installPrompt: InstallPromptEvent | null;
  onInstallHandled: () => void;
  onClose: () => void;
}) {
  const modal = useModal(onClose);
  const [preview, setPreview] = useState<ReviewBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const replacedDrafts = preview?.comments.reduce((count, store) => count + readCommentStore(store.projectId).drafts.length, 0) ?? 0;
  const replacedHistory = preview?.comments.reduce((count, store) => count + readCommentStore(store.projectId).history.length, 0) ?? 0;

  async function install(): Promise<void> {
    if (installPrompt === null) return;
    try {
      await installPrompt.prompt();
      onInstallHandled();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The browser could not open its install prompt.");
    }
  }

  function exportData(): void {
    if (rootPath === null) return;
    setError(null);
    try {
      const backup = createReviewBackup(rootPath);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `git-review-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage(`Backup downloaded: ${backup.comments.length} project review record${backup.comments.length === 1 ? "" : "s"}.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not export review data.");
    }
  }

  async function chooseImport(file: File | undefined): Promise<void> {
    setPreview(null);
    setMessage(null);
    setError(null);
    if (file === undefined || rootPath === null) return;
    if (file.size > maxBackupBytes) { setError("Backup exceeds the 25 MiB limit."); return; }
    try {
      const value: unknown = JSON.parse(await file.text()) as unknown;
      setPreview(parseReviewBackup(value, rootPath));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not read this backup.");
    }
  }

  function importData(): void {
    if (preview === null) return;
    setError(null);
    try {
      applyReviewBackup(preview);
      window.location.reload();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not import review data.");
    }
  }

  return <dialog class="review-dialog install-data-dialog" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="install-data-title">
    <div class="review-dialog-head"><div><p class="eyebrow">ON THIS DEVICE</p><h2 id="install-data-title">Install & local data</h2></div><button type="button" class="review-dialog-close" aria-label="Close install and local data" onClick={onClose}>×</button></div>
    <div class="review-dialog-content install-data-content">
      <section>
        <h3>Install the app</h3>
        {standalone ? <p>git-review is already open as an installed app.</p> : !window.isSecureContext ? <p>Open git-review at its HTTPS Tailscale address to install it as an app.</p> : <>
          <p>Install it from your browser to open git-review in its own window on this device.</p>
          {installPrompt !== null && <button type="button" onClick={() => void install()}>Install app</button>}
          <p class="install-hint">On Android, use your browser menu’s <strong>Install app</strong> action if no button appears here. On iPhone, use <strong>Share → Add to Home Screen</strong> and turn on <strong>Open as Web App</strong>.</p>
        </>}
      </section>
      <section>
        <h3>Move local review data</h3>
        <p>Moving from the old HTTP address to HTTPS, or installing on iPhone, starts with separate browser storage. Download a backup here, then import it in the new app. The file stays on your device.</p>
        <button type="button" disabled={rootPath === null} onClick={exportData}>Export local review data</button>
        <label class="install-import-label">Import a backup<input type="file" accept=".json,application/json" disabled={rootPath === null} onChange={(event) => { void chooseImport(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
        {preview !== null && <div class="install-preview"><p>Ready to import {preview.comments.length} project review record{preview.comments.length === 1 ? "" : "s"}, {preview.workspace.recentPaths.length} recent folder{preview.workspace.recentPaths.length === 1 ? "" : "s"}, and preferences.</p><p>Matching local records will be replaced{replacedDrafts + replacedHistory > 0 ? `, including ${replacedDrafts} existing draft${replacedDrafts === 1 ? "" : "s"} and ${replacedHistory} history entr${replacedHistory === 1 ? "y" : "ies"}` : ""}. {preview.version === 1 ? "Your current code typography stays as it is." : "Code typography will use the backup's choice."} {preview.version === 3 ? "Appearance will use the backup's choice." : "Your current appearance stays as it is."} Other projects remain here. Your active tab stays on its current folder.</p><button type="button" onClick={importData}>Import and replace matching data</button></div>}
      </section>
      {message !== null && <p class="review-status" role="status">{message}</p>}
      {error !== null && <p class="review-error" role="alert">{error}</p>}
    </div>
  </dialog>;
}
