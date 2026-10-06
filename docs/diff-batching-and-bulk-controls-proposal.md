# Diff batching and bulk card controls

Status: all three implementation slices completed, reviewed and approved on 2026-10-06. This feature
follow-up is complete and closed; no further implementation is planned.

The maintainer requested consistent batching for Changes and Git, followed by Expand all and
Collapse all controls in both views. This is a separate feature follow-up; the maintenance pass
remains closed.

## User flow

- Put **Expand all** and **Collapse all** beside the existing controls above the file cards in
  Changes and the selected commit view. Wrap the controls on narrow screens and retain touch
  targets.
- Expand all opens every card in the current displayed inventory. Changes includes every layer;
  staged and unstaged versions of one path remain distinct. Git affects only the selected commit
  within the opened project scope.
- Collapse all closes those cards and cancels their queued demand. An active batch can finish work
  for other still-expanded cards, but a canceled card cannot accept a late result. Abort the request
  when none of its cards still need it.
- Bulk actions change expansion only: preserve the URL, selected file, drafts and individual
  toggles. They do not refresh the inventory or repeat navigation focus. Disable each action when it
  would change nothing, or when there is no usable inventory.
- Retain existing persistence: Changes saves open-card choices; Git keeps bounded per-commit choices
  in tab memory. Existing defaults remain unchanged. Expansion still requests uncached cards below
  the viewport; viewport-based loading is outside this first slice.

## Shared mechanism, distinct source checks

Use one client batch queue and result-delivery mechanism for both adapters, preserving the existing
card loader, individual Retry actions and bounded diff cache. Collect uncached demands without an
intentional loading delay; do not queue cached results or collapsed cards. Queues belong to the
current destination/generation and release demand on cancellation, completion or navigation. Group
requests by project and exact source/version; keep each file's language choice attached to its
identity.

For a new source, start with at most three files to make the first cards available promptly; after a
successful response, collect up to 32 files per batch. Keep one active batch per client queue, three
concurrent file reads per batch, a 256 KiB encoded request limit and an 8 MiB encoded response
limit, also enforced while reading the HTTP response on the client. The queue retains pending demand
and one last-source marker, with no growing source history or result cache. Retain existing per-file
source/patch/line limits. When the response budget cannot include a file, return an explicit
deferred result and use the individual read route with the same source/version checks. Do not loop
through the same over-budget batch or enlarge caches. Raw images and audio/video ranges keep their
existing separate routes.

Revalidate the approved project for every batch and resolve requested files from the server's own
inventory. Share transport, limits, bounded scheduling and result accounting; keep source policy in
the existing domain readers:

- **Git:** select by full commit ID, read validated commit detail once, and retain commit/parent
  availability checks, project scope and missing-parent behavior. Read individual diffs/media from
  that detail.
- **Changes:** compare both `revision` and `changeToken` with the displayed snapshot before reading,
  then check again after the batch. If either changes or a file read reports stale, discard the
  batch's payloads and return stale for the whole batch. Preserve Refresh/Update recovery and avoid
  automatic retry loops. This uses the existing ordinary-edit signal, not an atomic filesystem
  snapshot. Use lightweight status reads for validation rather than calculating line statistics.

## Data and API shape

Use parallel read-only POST resources under today's project API:

```text
POST /api/projects/:id/git/commits/:oid/diffs
{ files: [{ path, language }] }

POST /api/projects/:id/diffs
{ revision, changeToken, files: [{ layer, path, language }] }
```

Require `language` to be a supported override or null. Validate bounded arrays, unique requested
identities, paths, layers and versions before starting work. A ready response echoes the source
identity and has exactly one result per request item in request order, each with its file identity:
`ready` with the existing diff union, `error` with the existing API error shape, or `deferred` for
the batch byte limit. Changes also allows a batch-level `stale` variant. The client validates source
and file correspondence before delivering or caching individual results. Malformed requests and lost
project/commit access fail the whole request; an isolated file error does not hide successful files.
Keep the individual routes for fallback and independent retries.

## Review steps

1. Shared batch contract and bounded scheduling, integrated with Git. Measure first-card latency,
   total workload, response bytes and Git subprocesses against the current individual-read path.
2. Changes batching with before/after version checks, same-path layer separation, media and draft
   safety. Reuse the same client mechanism and limits.
3. Shared bulk-control presentation in both views with their existing expansion owners. Check
   cancellation, retries, route/scroll behavior and persistence; capture and inspect phone, tablet
   portrait, tablet landscape and desktop, including 320 px containment.

Each step was kept uncommitted until maintainer review and approval. Tests cover observable source
correctness, size/work limits, partial failure, stale recovery and cancellation. Document measured
tradeoffs before accepting the batch size; browser checks do not establish real-device latency or
touch behavior.

## Step 1 measurements and review

Local API measurements compare the existing individual reads (three concurrent requests) with the
first-three/then-32 policy (one request, three server file reads). Each variant used a fresh server,
a cold workload and two repeated workloads; OS caches were not flushed. Times below are medians of
the repeated workloads, including commit detail and every file. Returned file values matched the
individual reads exactly. Git command counts came from separate cold traced workloads.

| Fixture / scope      | Files | Total, individual → batch | First file, individual → batch | HTTP requests | Git commands |
| -------------------- | ----- | ------------------------- | ------------------------------ | ------------- | ------------ |
| Ordinary / root      | 12    | 278 → 231 ms              | 91 → 97 ms                     | 13 → 3        | 113 → 63     |
| Ordinary / subfolder | 6     | 153 → 151 ms              | 72 → 98 ms                     | 7 → 3         | 61 → 41      |
| Larger / root        | 220   | 5,370 → 3,679 ms          | 84 → 95 ms                     | 221 → 9       | 1,809 → 749  |
| Larger / subfolder   | 110   | 2,742 → 1,920 ms          | 91 → 96 ms                     | 111 → 6       | 909 → 384    |

For the 220-file workload, fixed batches of eight took 4,205 ms; fixed batches of 32 took 3,622 ms
but delayed the first file to 576 ms. The chosen initial batch preserves most of that throughput
without the first-file delay. Encoded response bytes rose by about 2% for the large fixtures. Small
workloads show little total-time gain and can pay some first-file overhead.

In desktop Chrome, the same 220-file commit rendered its first card in 0.82 → 0.81 s and finished
all cards in 6.23 → 4.37 s, using 220 → 8 diff requests. These are medians of two measured fresh
contexts after a warm-up for each client; both used the current server and the same styles and other
client modules. This measures visible local-browser loading, not phone or remote-network
performance.

Boundary and integration tests cover bounded input/output, correspondence, cancellation, independent
file failures, media ranges, scope, shallow-parent recovery and root revalidation. Strict type and
static gates and the full test suite passed. Git browser QA passed at all four standard sizes and
320 px. The [phone](../qa/screenshots/git-diff-batching/mobile.png),
[tablet portrait](../qa/screenshots/git-diff-batching/tablet-portrait.png),
[tablet landscape](../qa/screenshots/git-diff-batching/tablet-landscape.png) and
[desktop](../qa/screenshots/git-diff-batching/desktop.png) captures were inspected with no page-wide
overflow. The running HTTP and private HTTPS origins serve the current client and batch endpoint.
Physical-device latency remains unverified. Step 1 accepted.

## Step 2 behavior and review

Changes cards now use the same bounded queue, with source identity including project, `revision`,
`changeToken` and the client refresh generation. The server reads lightweight status before and
after each batch; either version changing, or any file returning stale, discards all batch payloads.
Staged/unstaged versions of one path and separate language choices retain distinct identities.
Deferred reads send both snapshot tokens to the individual route. Feedback checks retain their
individual read path, and drafts remain attached to their original anchors.

Stale cards announce **New edits · Update** and explain how to recover; they no longer automatically
refresh the review. The notice remains until an explicit Update or Refresh accepts another snapshot.
Repeated stale responses cannot start a refresh loop, and late results from another snapshot or
refresh generation cannot announce an update for the current review.

Local desktop Chrome measurement used 64 changed TypeScript files with 96 staged/unstaged cards
open. After a warm-up, medians of two fresh contexts showed first-card time of 0.60 → 0.59 s, all
cards loaded in 2.53 → 2.15 s, and 96 → 4 diff requests. Both clients used the current server and
the same styles/other client modules; the baseline used the committed individual card reader. This
modest local timing gain does not establish remote-network or physical-device performance.

Tests cover layer/language correspondence, partial file errors, media ranges, input bounds, path
revalidation, stale fallback and recovery. A real Git read gated after the initial status verifies
that an ordinary edit during the batch invalidates every file while `revision` stays unchanged.
Loading, live-change, feedback and diff browser checks passed; line-count QA passed at all four
standard sizes and 320 px. The [phone](../qa/screenshots/changes-batch-stale/mobile.png),
[tablet portrait](../qa/screenshots/changes-batch-stale/tablet-portrait.png),
[tablet landscape](../qa/screenshots/changes-batch-stale/tablet-landscape.png) and
[desktop](../qa/screenshots/changes-batch-stale/desktop.png) captures use a controlled outdated
status token on an isolated fixture to show the real batch endpoint's stale recovery state. All four
were inspected with no page-wide overflow. The running HTTP and private HTTPS origins serve the
current client and correctly accept current batches and reject stale tokens. Physical-device
behavior remains unverified. Step 2 accepted.

## Step 3 behavior and review

**Expand all** and **Collapse all** now share one presentation beside Wrap/Refresh in both views.
Changes replaces its expansion choices with the displayed layer/path keys or an empty set in one
state change, dropping absent-file keys; Git updates only the selected commit's scoped files.
Actions with no effect are disabled, including empty or unavailable inventories. Individual toggles,
selected URLs and drafts keep their existing behavior.

Collapse cancels demand through the existing card loader and batch queue; re-expansion reuses
accepted cached results. Persistence keeps its existing bounds: Changes saves at most 100 open-card
keys across reloads (all displayed cards can still open in memory), and Git retains at most 64
commit choices in tab memory. No new caches or API changes were added.

Strict type, formatting and CSS-token gates passed. Loading QA covers bulk cancellation with
buffered late responses, same-path layers, disabled states, cache reuse, selected URLs, Changes
reloads and Git choices through Files/commit navigation at 320 px and all four standard sizes.
Existing Git navigation/media/reading-position checks and the mobile feedback flow also passed; bulk
toggles preserve the saved draft. The
[Changes phone](../qa/screenshots/changes-bulk-toolbar/mobile.png) and
[Git phone](../qa/screenshots/git-bulk-controls/mobile.png) sets include tablet portrait, tablet
landscape and desktop captures; all eight were inspected with no page-wide overflow and visible 44
px bulk targets. Both maintained review origins serve the current build. Real-device behavior
remains unverified. The maintainer reviewed and approved this final slice; work stops here.
