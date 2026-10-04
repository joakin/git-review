import type { SearchMatch, SearchResponse } from "../shared/api.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";

export type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; value: SearchResponse }
  | { kind: "error"; message: string };

export function SearchView({
  query,
  state,
  onQuery,
  onSubmit,
  onRefresh,
  canRefresh,
  onOpen,
}: {
  query: string;
  state: SearchState;
  onQuery: (query: string) => void;
  onSubmit: (query: string) => void;
  onRefresh: () => void;
  canRefresh: boolean;
  onOpen: (match: SearchMatch, query: string) => void;
}) {
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
      {state.kind === "ready" && (
        <div class="search-refresh-row">
          <button type="button" onClick={onRefresh}>
            Refresh results
          </button>
        </div>
      )}
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
            maxLength={128}
            required
            autoComplete="off"
            placeholder="Symbol or text"
            onInput={(event) => onQuery(event.currentTarget.value)}
          />
          <button type="submit" disabled={state.kind === "loading"}>
            Search
          </button>
        </div>
      </form>
      {state.kind === "idle" && (
        <p class="status-message">Enter a word or phrase to search this project.</p>
      )}
      {state.kind === "loading" && (
        <DelayedLoading className="status-message" message="Searching files…" />
      )}
      {state.kind === "error" && (
        <div class="status-message" role="alert">
          {state.message}{" "}
          {canRefresh && (
            <button type="button" onClick={onRefresh}>
              Retry
            </button>
          )}
        </div>
      )}
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
