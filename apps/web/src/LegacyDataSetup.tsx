import { useState } from "preact/hooks";
import type { BrowserData } from "./browser-data.ts";
import type { LegacySnapshot } from "./legacy-data.ts";
import { assignLegacyData } from "./legacy-data.ts";
import { downloadAgentBackup } from "./backup-download.ts";
import { BackupSummary } from "./BackupSummary.tsx";

export function LegacyDataSetup({
  data,
  snapshot,
  defaultEndpoint,
}: {
  data: BrowserData;
  snapshot: LegacySnapshot;
  defaultEndpoint: string;
}) {
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof assignLegacyData> | null>(null);
  function prepare(): void {
    try {
      setPreview(assignLegacyData(snapshot.data, endpoint));
      setError(null);
    } catch (error) {
      setPreview(null);
      setError(error instanceof Error ? error.message : "Could not prepare existing data.");
    }
  }
  function convert(): void {
    if (preview === null) return;
    try {
      data.convertLegacy(snapshot, endpoint);
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save converted reviews.");
    }
  }
  return (
    <main class="local-data-setup">
      <section class="install-data-content">
        <p class="eyebrow">EXISTING REVIEWS ON THIS DEVICE</p>
        <h1>Choose the host for your saved reviews</h1>
        <p>
          These reviews were saved before hosts were recorded separately. Assign them to the agent
          that owns their code. Nothing is assigned until you confirm.
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
        {error !== null && <p role="alert">{error}</p>}
        <button type="button" onClick={prepare}>
          Preview conversion
        </button>
        {preview !== null && (
          <div class="install-preview">
            <BackupSummary backup={preview} data={data} />
            <p>
              Original saved records are retained. Reload older tabs after conversion; their later
              saves will not be imported again.
            </p>
            <div class="local-data-actions">
              <button type="button" onClick={convert}>
                Assign reviews and continue
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    downloadAgentBackup(preview);
                    setError(null);
                  } catch (error) {
                    setError(error instanceof Error ? error.message : "Could not export reviews.");
                  }
                }}
              >
                Export assigned backup
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
