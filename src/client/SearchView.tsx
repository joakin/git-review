import type { SearchMatch, SearchResponse } from "../shared/api.ts";
import { maxSearchQueryLength } from "../shared/search-query.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import type { LoadState } from "./load-state.ts";
import { useNotification } from "./Notifications.tsx";

export type SearchState = { kind: "idle" } | LoadState<SearchResponse>;

export function SearchView({
  notificationKey,
  query,
  state,
  onQuery,
  onSubmit,
  onRefresh,
  canRefresh,
  onOpen,
}: {
  notificationKey: string;
  query: string;
  state: SearchState;
  onQuery: (query: string) => void;
  onSubmit: (query: string) => void;
  onRefresh: () => void;
  canRefresh: boolean;
  onOpen: (match: SearchMatch, query: string) => void;
}) {
  useNotification(
    `search-error:${notificationKey}`,
    state.kind === "error"
      ? {
          message: state.message,
          severity: "error",
          ...(canRefresh ? { action: { label: "Retry", run: onRefresh } } : {}),
        }
      : null,
  );
  const groups = new Map<string, SearchMatch[]>();
  if (state.kind === "ready") {
    for (const match of state.value.matches) {
      const group = groups.get(match.path) ?? [];
      group.push(match);
      groups.set(match.path, group);
    }
  }
  return (
    <section class="search-view" aria-label="Search project files">
      <p class="search-scope">
        Search current text files in this folder, including untracked files. Ignored files and Git
        internals are skipped.
      </p>
      <form
        class="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("query");
          if (typeof value === "string") onSubmit(value);
        }}
      >
        <label for="project-search-query">Find text</label>
        <div class="search-form-row">
          <input
            id="project-search-query"
            name="query"
            type="search"
            value={query}
            maxLength={maxSearchQueryLength}
            required
            autoComplete="off"
            placeholder="Symbol or text"
            onInput={(event) => onQuery(event.currentTarget.value)}
          />
          <div class="search-form-actions">
            <button type="submit" disabled={state.kind === "loading"}>
              Search
            </button>
            {state.kind === "ready" && (
              <button
                class="search-refresh"
                type="button"
                aria-label="Refresh results"
                onClick={onRefresh}
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      </form>
      {state.kind === "idle" && (
        <p class="status-message">Enter a word or phrase to search this project.</p>
      )}
      {state.kind === "loading" && (
        <DelayedLoading className="status-message" message="Searching files…" />
      )}
      {state.kind === "error" && <p class="status-message">Search unavailable.</p>}
      {state.kind === "ready" && (
        <>
          <p class="search-count" role="status">
            Results for “{state.value.query}”: {state.value.matches.length} matching{" "}
            {state.value.matches.length === 1 ? "line" : "lines"} in {groups.size}{" "}
            {groups.size === 1 ? "file" : "files"}
            {state.value.truncated ? " · Results are incomplete" : ""}
          </p>
          {state.value.matches.length === 0 && (
            <p class="status-message">No matches for “{state.value.query}”. Try another search.</p>
          )}
          <div class="search-results">
            {[...groups].map(([path, matches]) => (
              <section class="search-result-file" key={path}>
                <h3 title={path}>
                  {path}
                  <span>{matches.length}</span>
                </h3>
                <ul>
                  {matches.map((match) => (
                    <li key={`${match.path}:${match.line}`}>
                      <button
                        type="button"
                        onClick={() => onOpen(match, state.value.query)}
                        aria-label={`Open ${path} at line ${match.line}: ${match.excerpt}`}
                      >
                        <span class="search-result-line">{match.line}</span>
                        <code>{match.excerpt}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
