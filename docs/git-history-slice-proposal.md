# Git branches and commit inspection

Git browses local and already-present remote-tracking branches through read-only commands. Choosing
a branch changes the history list without checking out files or contacting a remote. Symbolic
aliases such as `origin/HEAD` are omitted. The default is the checked-out branch or a labeled
detached HEAD; an unborn repository has a no-commits state and a non-Git folder has an unavailable
state.

Selecting a commit opens its complete message as text and every changed file in the selected project
scope. Cards start expanded and reuse syntax, word detail, wrapping and media presentation. A row
tap reveals Old/New line information, while native selection and copying remain available.
Historical inspection has no Comment or selected-code Search action: current feedback anchors refer
to working-copy layers and Search searches the working tree. Existing drafts remain accessible in
Feedback.

Graph views, Git writes, remote fetching, arbitrary comparisons, file-specific history and browsing
an entire old tree remain in the
[optional backlog](initial-implementation-plan.md#remaining-roadmap).

## Comparison rules

| Commit          | Old side         | New side            |
| --------------- | ---------------- | ------------------- |
| Ordinary commit | Its parent       | The selected commit |
| Root commit     | Empty tree       | The selected commit |
| Merge commit    | Its first parent | The selected commit |

First-parent merge comparison shows what the merge brought into that parent as one ordinary diff.
The summary labels parent, first parent or root beside the full hash. Combined diffs and choosing
another parent are outside the current scope.

Parent IDs come from the actual commit object so shallow traversal cannot turn a missing parent into
a root. A missing local parent makes comparison and totals explicitly unavailable while leaving the
message readable. An empty commit still has its message and a no-file-changes state. Available
objects can recover on a later request.

The file inventory determines exact Old/New blob IDs. Comparing those blobs keeps a renamed file
separate when another change occupies its old path. Additions and deletions use bounded one-sided
content; syntax uses complete source blobs. Working-tree edits or deletion never substitute for a
historical side. Mode-only changes, renames, links and submodules retain meaningful metadata; links
and submodules are not followed.

A project inside a repository subfolder limits history and file comparisons to that subtree and
labels its scope. A rename entering or leaving the subtree becomes a scoped addition or deletion;
the outside side is absent and is not read. Historical paths need not exist on disk.

## Navigation and history snapshots

The URL records project, full branch ref or detached HEAD, and an optional full commit ID. Resolving
the default branch replaces the initial URL while preserving an opened list drawer and reading
position. Branch changes clear the selected commit; commit selection and Back/Forward follow the
[navigation contract](navigation-and-url-history-slice-proposal.md).

History uses bounded pages with Git's date order, keeping children before parents and including
merge history. Load older stays pinned to the resolved tip and uses the next offset. Refresh rereads
refs and starts a new tip snapshot without changing an opened commit's ID. New commits never reorder
a list under the reader. Returning through navigation reuses an available snapshot and reading
position; reload reads current branch history and the exact selected commit.

A full commit ID remains the destination if its branch advances or is rewritten. A deleted branch
can leave an available commit readable with another branch offered for the list. Missing refs or
objects produce recoverable errors instead of silently selecting a different commit. Slow loads
follow the [loading policy](loading-and-transition-polish.md), retaining ready same-resource content
during refresh and rejecting superseded results.

## Line totals and metadata

List and detail share two metadata rows: author/date-time, then hash/added-deleted totals. Detail
shows the full hash and compact comparison label. Dates use the author timestamp and browser locale
and timezone, with the exact timestamp available. Long authors and hashes wrap while totals stay
together; metadata does not cause horizontal page overflow.

Totals follow the comparison and scope above, independently of expanding patches. Git numeric
statistics count binary files separately; a textual media file such as SVG can contribute lines even
when displayed as an image. Pure renames and permission changes add no lines; empty commits show
zeroes. A rename crossing a subtree boundary counts the scoped addition/deletion. Missing parents
and protective limits show Stats unavailable rather than fabricated zeroes. Invalid output remains
an error. [git-stats.ts](../src/server/git-stats.ts) owns counting and its immutable ready-results
cache; unavailable statistics are retried when objects become available.

## Boundaries and limits

[shared/git.ts](../src/shared/git.ts) defines and validates refs, history, commits, comparison sides
and immutable diff results. [git-history.ts](../src/server/git-history.ts) owns interpretation; the
[Git read boundaries](git-read-boundaries.md) own transport and bounded object access.
[Stateless project access](stateless-project-access-plan.md#project-contract-and-validation) owns
project resolution.

Refs come from the branch inventory or explicit HEAD choice. Object IDs must be complete for the
repository's actual hash format and name commits; arbitrary revision expressions are rejected.
Over-limit inventories and messages fail explicitly rather than truncating ordinary commits.
Per-file text and media limits have named outcomes. A failed Old-side read cannot fall back to the
working file. [Media](media-preview-slice-proposal.md) owns immutable raw bytes and range behavior;
[batching](diff-batching-and-bulk-controls-proposal.md) owns bounded expanded-card demand.

### Data lifetime

Refs, pinned history snapshots, commit metadata, diffs, card choices and reading positions use
bounded tab memory. Commit diff identity includes project, commit, comparison base, path and
language; working-copy tokens cannot invalidate immutable data. Historical choices reset on reload.
Wrapping, appearance and language overrides use shared browser preferences. Git payloads enter
neither local-data backups nor the service-worker cache.

Cache byte accounting estimates serialized payload size, not total browser or process memory.

The server caches only validated commit details with an available comparison and ready statistics.
Its key includes canonical project, repository scope/object format and full commit ID. Every request
revalidates project and Git context; cache hits recheck the commit and first parent. Missing objects
evict details, and errors/unavailable results are not stored. LRU eviction, oversized-entry
rejection and restart bound retention without time expiry. Raw blobs and rendered diffs keep their
read boundaries. [git-browser.ts](../src/client/git-browser.ts),
[diff-cache.ts](../src/client/diff-cache.ts) and [git-history.ts](../src/server/git-history.ts) own
identities and budgets; [ResourceCache](../src/shared/resource-cache.ts) owns shared storage.

### Cache measurement evidence

Local fixtures included TypeScript, SVG and WAV at root and subfolder scope. Git Trace2 counted
subprocesses; separate untraced runs timed detail plus all file/raw requests with three requests in
flight. Cold means a fresh server, without flushing OS caches.

| Scope              | Files | Cold, before → after | Repeated, before → after | Repeated Git calls, before → after |
| ------------------ | ----: | -------------------: | -----------------------: | ---------------------------------: |
| Ordinary root      |    12 |        0.46 → 0.41 s |            0.36 → 0.29 s |                          148 → 109 |
| Ordinary subfolder |     6 |        0.30 → 0.28 s |            0.20 → 0.16 s |                            78 → 57 |
| Larger root        |   220 |        6.67 → 5.84 s |            6.51 → 5.72 s |                      2,468 → 1,805 |
| Larger subfolder   |   110 |        3.49 → 3.03 s |            3.36 → 2.89 s |                        1,238 → 905 |

Repeated detail reads fell from eight Git calls to five, with median latency falling from 35–36 ms
to 22–24 ms. The first detail still performs the full lookup; subsequent reads reuse validated
metadata and inventory. These local API results support the bounded cache, not a device or
remote-network performance claim.

## Verification — 2026-09-30

[History tests](../src/server/git-history.test.ts) and
[API tests](../src/server/git-history-api.test.ts) guard branch/detached/unborn states, pinned
pagination, full messages, root/merge/empty commits, renames and unusual names, exact sources after
disk changes, scoped comparisons, shallow-parent recovery, limits and SHA-256 IDs.
[Git browser QA](../qa/check-git.ts) exercises navigation, cache/card reuse, line inspection,
immutable media, contained scrolling and first-parent labels.

The [list](../qa/screenshots/git-history-list/mobile.png),
[full message/diffs](../qa/screenshots/git-commit-inspection/mobile.png) and
[historical code](../qa/screenshots/git-historical-code/mobile.png) sets were inspected at phone,
tablet portrait, tablet landscape and desktop sizes. Host Chrome also exercised the private HTTPS
phone flow. These are browser checks; real iOS/Android selection and installed navigation remain
unverified.

### Verification — metadata refinement, 2026-09-30

The [list metadata](../qa/screenshots/git-metadata-list-review/mobile.png) and
[commit metadata](../qa/screenshots/git-metadata-summary-review/mobile.png) sets were inspected at
all four sizes. Browser QA also covered long authors/hashes/totals at 320 px and default-branch
resolution with an open tablet drawer, without page-wide overflow.
