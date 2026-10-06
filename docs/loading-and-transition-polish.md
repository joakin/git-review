# Loading and screen transitions

Initial delivery: implemented, reviewed by the maintainer, and committed as `471521e` on 2026-09-30.
The maintainer confirmed snappy navigation and the corrected expand/collapse behavior. The M05c
cancellation fix is accepted and committed as `b20b514`; M06 cache reuse is accepted and committed
as `737a09b`. Their verification is recorded below.

## Behavior

- A fast request shows the destination's existing frame without a loading sentence or spinner. After
  300 ms, a short status message appears. Errors still appear immediately when known.
- Canceling project opening with browser Back returns to the same picker directory with an enabled
  Open control. The [project/session owner](../src/client/project-session.ts) checks that opening
  success/error still belongs to the current root, request, and route even before effect cleanup
  aborts the request; abandoned results cannot save the project or disturb a replacement open.
- Navigating to another project, host directory, project directory, or submitted Search query never
  paints data from the previous destination while the new request starts. Request results are
  associated with their project/path/query, and aborted requests cannot replace the current view.
- Returning to a project already opened in this tab reuses its validated project handle and visible
  data. Explicitly opening that folder from the picker renews the handle, which also provides
  recovery after a server restart. Switching to a different project sends one open request. A status
  read still refreshes Git changes; the existing content stays visible during that read.
- A refresh of a loaded file or list keeps its current content on screen until the replacement
  arrives. A newly selected file or directory starts with an empty content area and shows delayed
  feedback only if the wait is noticeable.
- The [working-copy review owner](../src/client/working-copy-review.ts) accepts status results only
  for the current project handle and route scope. A non-Git result redirects only the current
  Changes destination; completing a refresh after navigation cannot restore its reading position in
  another view.
- The project picker does not appear as an interim screen while an explicit project link opens. If
  opening fails, the error and recovery action appear in that project's screen.
- Expanded diff results survive Changes → Files/Search → Changes and browser Back/Forward within the
  current tab. Their already rendered content and height are available on the first Changes render,
  so the saved scroll position can be restored before paint. A quick Back also uses the latest route
  when recording scroll positions.
- Opening a changed file from the list or a direct URL expands and scrolls to that card once for
  that navigation. Expanding or collapsing cards afterwards does not repeat that scroll or force the
  selected card open. Refresh preserves that choice; choosing the file again or navigating
  Back/Forward to its URL focuses it again.

## Diff cache scope

The Git status, latest folder list, Files tree, and Search results already live in app state across
section switches; expanded-card choices persist in browser storage. The missing piece was the diff
payload, which lived only in `DiffCard` component state and disappeared whenever Changes unmounted.
Validated diff results now live in a tab-memory cache bounded to 128 entries and roughly 32 MiB.
They are keyed by project, layer, path, Git revision, change token, manual refresh generation, and
language choice. Stale responses and errors are not cached. A manual Refresh or accepted new Git
change token fetches fresh diffs.

The cache is intentionally absent from local/session storage and backup data: diff payloads can be
large and are reproducible from the host. Working-tree file contents still refetch when the Files
viewer remounts; caching those would need a separate freshness policy because files can change
outside the app.

[ResourceCache](../src/shared/resource-cache.ts) owns storage, LRU promotion, replacement/removal
accounting, oversized-value rejection, and eviction. The [diff adapter](../src/client/diff-cache.ts)
owns its budget, working-copy identity, and stale-result exclusion. The Git browser uses the same
mechanism with its own identities and budgets; immutable commit diffs share the diff adapter's
capacity. The byte estimate counts serialized UTF-16 data, not total browser memory.

[The shared diff loader](../src/client/diff-loading.ts) now owns keyed loaded/error state,
cancellation, retry, and immediate cache reads for working-copy and historical cards. Each card
adapter supplies its resource key, request, error fallback, and any response policy. Working-copy
stale handling stays in [DiffCard](../src/client/DiffCard.tsx); immutable commit keys stay in
[CommitViewer](../src/client/CommitViewer.tsx). The adapters in
[git-api.ts](../src/client/git-api.ts) and [change-diff-api.ts](../src/client/change-diff-api.ts)
use the bounded [batch queue](../src/client/diff-batch-queue.ts); see the
[batching record](diff-batching-and-bulk-controls-proposal.md) for policy and measurements. The
loader checks current expansion and identity before accepting results, including before effect
cleanup aborts a superseded request.

The delay is a presentation choice, not a delay before starting requests. Network and parsing errors
retain their existing messages and retry actions. We avoid retaining results from another project or
query as if they belonged to the new route.

## QA

The loading suite also covers view recovery: a failed Files directory read retries in place and
opens a recovered file; an empty parent directory removes previous rows; a picker read failure
disables opening until Back to root and reselection recover it.

`bun qa/check-loading.ts http://127.0.0.1:3000/` uses the inventory and history fixtures and holds
project-open, directory, file, and Search responses in the browser. It checks that short waits do
not show loading text, slow waits do, old destinations do not flash, returning to the same project
does not reopen it, and switching projects sends one open request. It also verifies that an expanded
diff sends no new diff request across two Back/Forward cycles, keeps its height and scroll position,
and fetches again on Refresh. The suite also uses the history fixture to exercise both diff adapters
with fully buffered responses that ignore abort: collapse and language supersession exclude late
results from the view and cache, Retry retains the override, and reload restores it. A current
working-copy stale response still refreshes its status and diff. Held working-copy status and
renewed diff responses verify that navigation preserves the selected Files URL, Files/Settings
reading positions, and replacement project ownership without an old redirect or error.
`bun qa/check-navigation.ts` checks the broader Back/Forward and responsive flows, including
phone/desktop card toggles without repeat scrolling, collapsing the URL-selected card, Refresh
without reopening it, and refocusing after reselection or Forward. Four-size captures cover
[loaded Files](../qa/screenshots/loading-polish-file/mobile.png), an
[expanded diff](../qa/screenshots/diff-cache-expanded/mobile.png), and
[reviewing another card after URL selection](../qa/screenshots/diff-navigation-focus/mobile.png).

Browser QA and the maintainer's review cover the current loading and navigation behavior. The
broader device pass still includes iOS, slower network transitions, and installed-PWA interruptions.

## Maintenance verification — 2026-10-01

M05c is accepted and committed as `b20b514`. It resets the picker after canceled project opening and
adds a synchronous route-ownership guard to both completion branches. The new
[project-opening helper](../qa/project-opening-check.ts), invoked by `qa:loading`, fails on
committed `1d28fc5` after Back; a further success released during `popstate` also failed until the
route guard was added. Native cancellation/retry now pass at 320 px and all four standard viewport
sizes. Controlled buffered success/error cases check persisted ownership while a replacement is
pending and after it completes; a normal opening error still permits recovery/retry. Existing
loading/cache/scroll, navigation, and feedback transaction checks passed, along with strict gates,
build, and navigation parser tests. Four-size
[recovered picker captures](../qa/screenshots/maintenance-m05c-opening-recovery/mobile.png) were
taken only after a controlled open → abort → Back sequence and inspected without page overflow.
These are Chrome checks; real-device interruptions remain unverified.

M06 is accepted and committed as `737a09b`. The shared cache mechanism passes 11 new invariant
tests, the full 99-test suite, strict gates, and build. Loading QA confirms first-render expanded
content/height and Back/Forward scroll reuse, with new data after Refresh. Git QA confirms immutable
cache reuse and the three-request bound at all four standard sizes; live-change QA confirms fresh
diffs after accepted Update and manual Refresh while preserving card, draft, and reading position.
All 451 tracked screenshot-tree files remain unchanged; only the ordinary live-change check
generated ignored diagnostic captures. Real-device behavior was not reverified.
