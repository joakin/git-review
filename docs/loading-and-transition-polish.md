# Loading and screen transitions

## Behavior

Requests start promptly. Fast completion leaves the destination's frame free of transient loading
text; longer waits show a short delayed status message. Errors appear as soon as known. The
[presentation component](../src/client/DelayedLoading.tsx) defines the delay.

Loaded content may remain visible during a same-resource refresh. A newly selected project,
directory, file, or submitted Search query starts with its own empty/loading state and cannot paint
the previous resource's data. Associate responses with resource identity and reject superseded work,
including the interval before effect cleanup aborts it. Navigation intent takes effect synchronously
so request completion can check the latest destination.

Canceling project opening with Back returns to the same picker directory with Open enabled.
Abandoned success/error cannot change the saved project, recents, feedback store, or a replacement
open. An explicit project link never shows the picker as an interim screen; failures and recovery
belong to that project destination.

Section navigation within the currently accepted project reuses its resolved metadata and applicable
loaded state. Choosing that folder again through the picker resolves metadata afresh; switching to
another project also resolves its metadata. Lookup is not registration or handle renewal. Each
resource request independently resolves the canonical project path, so a server restart needs no new
lookup under the [stateless project contract](stateless-project-access-plan.md).

Working-copy status results belong to the current accepted project and route scope. A non-Git
redirect applies only to the current Changes destination. Refresh completion after navigation cannot
restore a Changes reading position in Files, Settings, or another project. The
[live-change contract](live-change-detection-slice-proposal.md) defines background checks and
explicit acceptance of updated review data.

## Diff cache scope

Matching expanded diffs are available on the first Changes render when returning from another
section or Back/Forward, restoring content height before reading position. The bounded tab-memory
cache belongs to the current resource/version: project, layer, path, Git revision, change token,
manual refresh generation, and language. Stale responses and errors are excluded; Refresh and an
accepted new version request fresh payloads.

Diff payloads are reproducible and may be large, so they are absent from browser storage and backups
and disappear on reload. Working-tree files refetch when their viewer remounts; they require a
separate freshness policy because edits can occur outside the app. Immutable historical diffs use
the same cache mechanism while retaining their own identity. The
[diff cache](../src/client/diff-cache.ts) and [Git browser](../src/client/git-browser.ts) define
keys and budgets; [ResourceCache](../src/shared/resource-cache.ts) defines bounded retention.
Serialized payload size is an estimate, not total browser memory.

Collapsed or superseded card requests cannot accept late results into the view or cache. Retry keeps
the selected language. The [shared loader](../src/client/diff-loading.ts) enforces that ownership;
[bounded batching](diff-batching-and-bulk-controls-proposal.md) defines request scheduling.

[Revealed diff context](diff-slice.md#revealing-unchanged-context) has a separate bounded projection
cache tied to that same resource/version. Its owner defines collapse/reopen retention, language
replay, per-card request cancellation and insertion-position compensation; expansion does not create
a route focus intent.

## Route focus and reading position

Opening a changed file from the list or a URL expands and focuses its card once per navigation.
Subsequent card toggles, Refresh, or preference changes do not repeat that focus or force the
selected card open. Choosing that file again or Back/Forward to its URL provides a fresh navigation
intent.

Saved position belongs to its route. Restore it only after the corresponding content is available;
working-copy Refresh waits for renewed expanded diff bodies so temporary loading heights cannot
clamp the scroll. A quick Back records against the latest route. Menu/drawer visibility and viewport
changes retain their [navigation rules](navigation-and-url-history-slice-proposal.md).

## QA

Existing browser checks hold project, directory, file, Search, status, and diff responses to verify
fast/slow loading, stale-resource exclusion, canceled-opening recovery, replacement ownership,
same-resource refresh, first-render cache reuse, Retry, and selected-card focus. Buffered responses
that ignore abort verify ownership independently of network cancellation. Recovery also covers
failed directory reads, empty listings, and picker errors. The [QA workflow](qa-workflow.md) owns
commands and fixtures.

Inspected four-size Chrome-emulation evidence remains in these milestone sets:

| State                      | Phone                                                                   | Tablet portrait                                                                  | Tablet landscape                                                                  | Desktop                                                                  |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Loaded file                | [Image](../qa/screenshots/loading-polish-file/mobile.png)               | [Image](../qa/screenshots/loading-polish-file/tablet-portrait.png)               | [Image](../qa/screenshots/loading-polish-file/tablet-landscape.png)               | [Image](../qa/screenshots/loading-polish-file/desktop.png)               |
| Cached diff                | [Image](../qa/screenshots/diff-cache-expanded/mobile.png)               | [Image](../qa/screenshots/diff-cache-expanded/tablet-portrait.png)               | [Image](../qa/screenshots/diff-cache-expanded/tablet-landscape.png)               | [Image](../qa/screenshots/diff-cache-expanded/desktop.png)               |
| Later card after URL focus | [Image](../qa/screenshots/diff-navigation-focus/mobile.png)             | [Image](../qa/screenshots/diff-navigation-focus/tablet-portrait.png)             | [Image](../qa/screenshots/diff-navigation-focus/tablet-landscape.png)             | [Image](../qa/screenshots/diff-navigation-focus/desktop.png)             |
| Canceled-open recovery     | [Image](../qa/screenshots/maintenance-m05c-opening-recovery/mobile.png) | [Image](../qa/screenshots/maintenance-m05c-opening-recovery/tablet-portrait.png) | [Image](../qa/screenshots/maintenance-m05c-opening-recovery/tablet-landscape.png) | [Image](../qa/screenshots/maintenance-m05c-opening-recovery/desktop.png) |

The maintainer accepted loading/focus behavior and its cancellation follow-up. These milestones do
not verify physical iOS/Android interruption behavior, slower real-device networking, or
installed-PWA resume behavior; those device checks remain unverified.
