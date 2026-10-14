import { useEffect, useRef, useState } from "preact/hooks";
import { maxAgentBackupBytes, type AgentBackup } from "./agent-data-format.ts";
import { assignLegacyData, parseBackupImport, type BackupImport } from "./legacy-data.ts";
import { useModal } from "./modal.ts";
import { useNotification, useNotifications } from "./Notifications.tsx";
import { useBrowserData } from "./BrowserDataProvider.tsx";
import { downloadAgentBackup } from "./backup-download.ts";
import { BackupSummary } from "./BackupSummary.tsx";

export type InstallPromptEvent = Event & { prompt: () => Promise<void> };

export function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

export function InstallDataDialog({
  installPrompt,
  onInstallHandled,
  onClose,
  defaultEndpoint,
}: {
  installPrompt: InstallPromptEvent | null;
  onInstallHandled: () => void;
  onClose: () => void;
  defaultEndpoint: string;
}) {
  const data = useBrowserData();
  const modal = useModal(onClose);
  const [source, setSource] = useState<BackupImport | null>(null);
  const [preview, setPreview] = useState<AgentBackup | null>(null);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const notifications = useNotifications();
  useNotification(
    "local-data-error",
    error !== null ? { message: error, severity: "error" } : null,
  );
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  async function install(): Promise<void> {
    if (installPrompt === null) return;
    try {
      await installPrompt.prompt();
      onInstallHandled();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "The browser could not open its install prompt.",
      );
    }
  }

  function exportData(): void {
    setError(null);
    try {
      const backup = data.exportBackup();
      downloadAgentBackup(backup);
      notifications.push({
        key: "backup-export",
        message: "Backup downloaded: " + backup.reviews.length + " project review records.",
        severity: "success",
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not export review data.");
    }
  }

  async function chooseImport(file: File | undefined): Promise<void> {
    const request = ++generation.current;
    setPreview(null);
    setSource(null);
    notifications.dismissKey("backup-export");
    setError(null);
    if (file === undefined) return;
    if (file.size > maxAgentBackupBytes) {
      setError("Backup exceeds the 25 MiB limit.");
      return;
    }
    try {
      const imported = parseBackupImport(await file.text());
      if (request !== generation.current) return;
      setSource(imported);
      if (imported.kind === "agent") setPreview(imported.backup);
    } catch (cause: unknown) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not read this backup.");
    }
  }

  function prepareLegacy(): void {
    if (source?.kind !== "legacy") return;
    try {
      setPreview(assignLegacyData(source.data, endpoint));
      setError(null);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Could not assign this backup.");
    }
  }

  function importData(): void {
    if (preview === null) return;
    setError(null);
    try {
      data.applyBackup(preview);
      window.location.reload();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not import review data.");
    }
  }

  return (
    <dialog
      class="review-dialog install-data-dialog"
      ref={modal.ref}
      onCancel={modal.onCancel}
      aria-labelledby="install-data-title"
    >
      <div class="review-dialog-head">
        <div>
          <p class="eyebrow">ON THIS DEVICE</p>
          <h2 id="install-data-title">Install & local data</h2>
        </div>
        <button
          type="button"
          class="review-dialog-close"
          aria-label="Close install and local data"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div class="review-dialog-content install-data-content">
        <section>
          <h3>Install the app</h3>
          {standalone ? (
            <p>git-review is already open as an installed app.</p>
          ) : !window.isSecureContext ? (
            <p>Open git-review at an HTTPS address to install it as an app.</p>
          ) : (
            <>
              <p>
                Install it from your browser to open git-review in its own window on this device.
              </p>
              {installPrompt !== null && (
                <button type="button" onClick={() => void install()}>
                  Install app
                </button>
              )}
              <p class="install-hint">
                On Android, use your browser menu’s <strong>Install app</strong> action if no button
                appears here. On iPhone, use <strong>Share → Add to Home Screen</strong> and turn on{" "}
                <strong>Open as Web App</strong>.
              </p>
            </>
          )}
        </section>
        <section>
          <h3>Move local review data</h3>
          <p>
            A different frontend address, or installing on iPhone, can use separate browser storage.
            Download a backup here, then import it in the new app. The file stays on your device.
          </p>
          <button type="button" onClick={exportData}>
            Export local review data
          </button>
          <label class="install-import-label">
            Import a backup
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                void chooseImport(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {data.isTemporary() && (
            <p role="status">This export includes only temporary reviews in this tab.</p>
          )}
          {source?.kind === "legacy" && (
            <div class="install-preview">
              <p>
                This backup does not record a host. Choose the agent that owns its projects before
                importing.
              </p>
              <label class="agent-endpoint-field">
                Agent URL
                <input
                  type="url"
                  value={endpoint}
                  spellcheck={false}
                  autoCapitalize="off"
                  onInput={(event) => {
                    setEndpoint(event.currentTarget.value);
                    setPreview(null);
                    setError(null);
                  }}
                />
              </label>
              <button type="button" onClick={prepareLegacy}>
                Preview host assignment
              </button>
            </div>
          )}
          {preview !== null && (
            <div class="install-preview">
              <BackupSummary backup={preview} data={data} />
              <p>
                Host associations are preserved. Imported paths do not grant access to code. This
                tab stays on its current destination. Reload other open tabs after importing.
              </p>
              <button type="button" onClick={importData}>
                Import and replace matching data
              </button>
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
