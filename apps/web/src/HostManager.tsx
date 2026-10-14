import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBrowserData } from "./BrowserDataProvider.tsx";
import { createAgentConnection, normalizeAgentEndpoint } from "./agent-connection.ts";
import { defaultAgentLabel, type SavedAgentConnection } from "./agent-data-format.ts";
import type { ProjectReference } from "./agent-project.ts";
import { checkHost, type HostCheck } from "./host-check.ts";
import { useModal } from "./modal.ts";

type CheckState = { kind: "unchecked" } | { kind: "checking" } | HostCheck;
type Props = {
  prefill: string;
  builtIn: readonly SavedAgentConnection[];
  onChanged: () => void;
  onConnect: (endpoint: string) => void;
  onReview: (reference: ProjectReference) => void;
};
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Could not update local host data.";
}
function status(state: CheckState): string {
  switch (state.kind) {
    case "unchecked":
      return "Not checked";
    case "checking":
      return "Checking…";
    case "available":
      return "Available";
    case "incompatible":
      return "Incompatible";
    case "unavailable":
      return "Unavailable";
  }
}
export function HostManager({ prefill, builtIn, onChanged, onConnect, onReview }: Props) {
  const data = useBrowserData();
  const [revision, refresh] = useState(0);
  const [address, setAddress] = useState(prefill);
  const [label, setLabel] = useState("");
  const [candidate, setCandidate] = useState<{ endpoint: string; state: CheckState } | null>(null);
  const [checks, setChecks] = useState(new Map<string, CheckState>());
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new Map<string, AbortController>());
  useEffect(() => {
    requests.current.get("candidate")?.abort();
    requests.current.delete("candidate");
    setAddress(prefill);
    setCandidate(null);
  }, [prefill]);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("storage", update);
      for (const request of requests.current.values()) request.abort();
      requests.current.clear();
    };
  }, []);
  // Read the shared catalog afresh; selections are owned by the caller's tab.
  const { hosts, reviews, readError } = useMemo(() => {
    try {
      const hosts = [
        ...new Map(
          [...builtIn, ...data.readCatalog().connections].map((record) => [
            record.endpoint,
            record,
          ]),
        ).values(),
      ];
      const reviews = data
        .listSavedReviews()
        .filter(
          (review) =>
            review.kind === "unavailable" ||
            review.value.comments.drafts.length > 0 ||
            review.value.comments.history.length > 0,
        );
      return { hosts, reviews, readError: null };
    } catch (cause) {
      return { hosts: [], reviews: [], readError: message(cause) };
    }
  }, [data, builtIn, revision]);

  async function probe(endpoint: string, key: string): Promise<void> {
    requests.current.get(key)?.abort();
    const controller = new AbortController();
    requests.current.set(key, controller);
    const update = (state: CheckState) => {
      if (key === "candidate") setCandidate({ endpoint, state });
      else setChecks((previous) => new Map(previous).set(endpoint, state));
    };
    update({ kind: "checking" });
    try {
      const result = await checkHost(
        createAgentConnection(endpoint, { allowLoopbackHttp: true }),
        controller.signal,
      );
      if (requests.current.get(key) === controller && !controller.signal.aborted) update(result);
    } catch (cause) {
      if (!controller.signal.aborted && requests.current.get(key) === controller)
        update({ kind: "unavailable", message: message(cause) });
    } finally {
      if (requests.current.get(key) === controller) requests.current.delete(key);
    }
  }
  function changed() {
    refresh((value) => value + 1);
    onChanged();
  }
  function mutate(action: () => void) {
    try {
      action();
      setError(null);
      changed();
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <div class="host-manager">
      <div class="hosts-intro">
        <p>Connect to a code host, or open feedback saved on this device.</p>
        <p class="review-hint">
          Your device needs access to the host through Tailscale. Host checks describe access from
          this browser right now.
        </p>
      </div>
      {readError !== null && (
        <p role="alert" class="host-error">
          {readError}
        </p>
      )}
      {error !== null && (
        <p role="alert" class="host-error">
          {error}
        </p>
      )}
      <div class="hosts-grid">
        <section class="host-panel" aria-labelledby="add-host-title">
          <h2 id="add-host-title">Add host</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                setError(null);
                void probe(normalizeAgentEndpoint(address, true), "candidate");
              } catch (cause) {
                setError(message(cause));
              }
            }}
          >
            <label for="host-address">Agent URL</label>
            <input
              id="host-address"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellcheck={false}
              value={address}
              placeholder="https://workspace.example.ts.net"
              onInput={(event) => {
                requests.current.get("candidate")?.abort();
                requests.current.delete("candidate");
                setCandidate(null);
                setError(null);
                setAddress(event.currentTarget.value);
              }}
            />
            <label for="host-label">Display name (optional)</label>
            <input
              id="host-label"
              type="text"
              maxLength={200}
              value={label}
              placeholder="Cloud workspace"
              onInput={(event) => setLabel(event.currentTarget.value)}
            />
            <div class="host-actions">
              <button type="submit" disabled={candidate?.state.kind === "checking"}>
                Check host
              </button>
              {candidate?.state.kind === "available" && (
                <button
                  class="host-primary"
                  type="button"
                  onClick={() => {
                    try {
                      const accepted = data.saveConnection({
                        endpoint: candidate.endpoint,
                        label: label.trim() || defaultAgentLabel(candidate.endpoint),
                      });
                      changed();
                      onConnect(accepted.endpoint);
                    } catch (cause) {
                      setError(message(cause));
                    }
                  }}
                >
                  Add host
                </button>
              )}
            </div>
          </form>
          {candidate !== null && (
            <div class="host-check" role="status" data-state={candidate.state.kind}>
              <strong>{status(candidate.state)}</strong>
              <p class="host-address">{candidate.endpoint}</p>
              {candidate.state.kind === "available" ? (
                <p>Read-only agent · {candidate.state.info.agentVersion}</p>
              ) : (
                (candidate.state.kind === "unavailable" ||
                  candidate.state.kind === "incompatible") && <p>{candidate.state.message}</p>
              )}
            </div>
          )}
        </section>
        <section class="host-panel" aria-labelledby="hosts-title">
          <h2 id="hosts-title">Your hosts</h2>
          {hosts.length === 0 && <p>No hosts added yet.</p>}
          <div class="host-list">
            {hosts.map((host) => {
              const state = checks.get(host.endpoint) ?? { kind: "unchecked" as const };
              const fixed = builtIn.some((record) => record.endpoint === host.endpoint);
              return (
                <article class="host-record" key={host.endpoint} aria-label={host.label}>
                  <strong>{host.label}</strong>
                  <p class="host-address">{host.endpoint}</p>
                  <span class="host-status" data-state={state.kind}>
                    {status(state)}
                  </span>
                  {(state.kind === "unavailable" || state.kind === "incompatible") && (
                    <p class="host-error">{state.message}</p>
                  )}
                  <div class="host-actions">
                    <button
                      type="button"
                      disabled={state.kind === "checking"}
                      onClick={() => void probe(host.endpoint, host.endpoint)}
                    >
                      Check
                    </button>
                    <button type="button" onClick={() => onConnect(host.endpoint)}>
                      Browse folders
                    </button>
                    {!fixed && (
                      <button
                        type="button"
                        onClick={() =>
                          mutate(() => {
                            data.removeConnection(host.endpoint);
                            requests.current.get(host.endpoint)?.abort();
                          })
                        }
                      >
                        Remove host
                      </button>
                    )}
                  </div>
                  <form
                    class="host-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const input = event.currentTarget.elements.namedItem("label");
                      if (input instanceof HTMLInputElement)
                        mutate(() =>
                          fixed
                            ? data.saveConnection({
                                endpoint: host.endpoint,
                                label: input.value.trim(),
                              })
                            : data.renameConnection(host.endpoint, input.value.trim()),
                        );
                    }}
                  >
                    <label class="visually-hidden" for={`label-${host.endpoint}`}>
                      Display name for {host.label}
                    </label>
                    <input
                      id={`label-${host.endpoint}`}
                      name="label"
                      defaultValue={host.label}
                      maxLength={200}
                    />
                    <button type="submit">Save name</button>
                  </form>
                  {fixed && <p class="review-hint">Built-in local host</p>}
                </article>
              );
            })}
          </div>
          <p class="review-hint">
            Removing a host keeps its saved reviews below. A different URL is a new host.
          </p>
        </section>
      </div>
      <section class="host-panel saved-reviews" aria-labelledby="saved-reviews-title">
        <h2 id="saved-reviews-title">Saved reviews</h2>
        {reviews.length === 0 && <p>No saved feedback or copy history on this device yet.</p>}
        {reviews.map((review) => {
          const { project, comments } = review.value;
          const host = hosts.find((record) => record.endpoint === project.endpoint);
          return (
            <article
              class="saved-review-record"
              key={JSON.stringify([project.endpoint, project.projectPath])}
            >
              <div>
                <h3>{project.name}</h3>
                <p class="host-address">
                  {host?.label ?? "Host removed or not added"} · {project.endpoint}
                </p>
                <p class="host-address">{project.projectPath}</p>
                {review.kind === "unavailable" ? (
                  <p class="host-error">Saved review unreadable. Original data retained.</p>
                ) : (
                  <p>
                    {comments.drafts.length} saved draft{comments.drafts.length === 1 ? "" : "s"} ·{" "}
                    {comments.history.length} copy history{" "}
                    {comments.history.length === 1 ? "entry" : "entries"}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => onReview(project)}>
                Open saved review
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
export function HostsDialog({
  onClose,
  onLocalData,
  ...props
}: Props & { onClose: () => void; onLocalData: () => void }) {
  const modal = useModal(onClose);
  return (
    <dialog
      class="review-dialog hosts-dialog"
      ref={modal.ref}
      onCancel={modal.onCancel}
      aria-labelledby="hosts-dialog-title"
    >
      <div class="review-dialog-head">
        <div>
          <p class="eyebrow">THIS DEVICE</p>
          <h2 id="hosts-dialog-title">Hosts & saved reviews</h2>
        </div>
        <button
          type="button"
          class="review-dialog-close"
          aria-label="Close hosts"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div class="review-dialog-content">
        <HostManager {...props} />
      </div>
      <div class="review-dialog-actions">
        <button type="button" onClick={onLocalData}>
          Install & local data
        </button>
      </div>
    </dialog>
  );
}
