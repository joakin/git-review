# Loading and screen transitions

Status: implemented, reviewed by the maintainer, and committed as `471521e` on 2026-09-30. The maintainer confirmed snappy navigation and the corrected expand/collapse behavior.

## Behavior

- A fast request shows the destination's existing frame without a loading sentence or spinner. After 300 ms, a short status message appears. Errors still appear immediately when known.
- Navigating to another project, host directory, project directory, or submitted Search query never paints data from the previous destination while the new request starts. Request results are associated with their project/path/query, and aborted requests cannot replace the current view.
- Returning to a project already opened in this tab reuses its validated project handle and visible data. Explicitly opening that folder from the picker renews the handle, which also provides recovery after a server restart. Switching to a different project sends one open request. A status read still refreshes Git changes; the existing content stays visible during that read.
- A refresh of a loaded file or list keeps its current content on screen until the replacement arrives. A newly selected file or directory starts with an empty content area and shows delayed feedback only if the wait is noticeable.
- The project picker does not appear as an interim screen while an explicit project link opens. If opening fails, the error and recovery action appear in that project's screen.
- Expanded diff results survive Changes → Files/Search → Changes and browser Back/Forward within the current tab. Their already rendered content and height are available on the first Changes render, so the saved scroll position can be restored before paint. A quick Back also uses the latest route when recording scroll positions.
- Opening a changed file from the list or a direct URL expands and scrolls to that card once for that navigation. Expanding or collapsing cards afterwards does not repeat that scroll or force the selected card open. Refresh preserves that choice; choosing the file again or navigating Back/Forward to its URL focuses it again.

## Diff cache scope

The Git status, latest folder list, Files tree, and Search results already live in app state across section switches; expanded-card choices persist in browser storage. The missing piece was the diff payload, which lived only in `DiffCard` component state and disappeared whenever Changes unmounted. Validated diff results now live in a tab-memory cache bounded to 128 entries and roughly 32 MiB. They are keyed by project, layer, path, Git revision, change token, manual refresh generation, and language choice. Stale responses and errors are not cached. A manual Refresh or accepted new Git change token fetches fresh diffs.

The cache is intentionally absent from local/session storage and backup data: diff payloads can be large and are reproducible from the host. Working-tree file contents still refetch when the Files viewer remounts; caching those would need a separate freshness policy because files can change outside the app.

The delay is a presentation choice, not a delay before starting requests. Network and parsing errors retain their existing messages and retry actions. We avoid retaining results from another project or query as if they belonged to the new route.

## QA

`bun run qa:loading http://127.0.0.1:3000/` uses the inventory fixture and holds project-open, directory, file, and Search responses in the browser. It checks that short waits do not show loading text, slow waits do, old destinations do not flash, returning to the same project does not reopen it, and switching projects sends one open request. It also verifies that an expanded diff sends no new diff request across two Back/Forward cycles, keeps its height and scroll position, and fetches again on Refresh. `bun run qa:navigation` checks the broader Back/Forward and responsive flows, including phone/desktop card toggles without repeat scrolling, collapsing the URL-selected card, Refresh without reopening it, and refocusing after reselection or Forward. Four-size captures cover [loaded Files](../qa/screenshots/loading-polish-file/mobile.png), an [expanded diff](../qa/screenshots/diff-cache-expanded/mobile.png), and [reviewing another card after URL selection](../qa/screenshots/diff-navigation-focus/mobile.png).

Browser QA and the maintainer's review cover the current loading and navigation behavior. The broader device pass still includes iOS, slower network transitions, and installed-PWA interruptions.
