# Diff batching and bulk card controls

Changes and Git share bounded loading for expanded cards. Expand all opens the displayed inventory:
every Changes layer, or only the selected commit's project scope. Collapse all closes those cards.
Both actions preserve the URL, selected file and drafts, and do not refresh data or repeat route
focus. Controls wrap on narrow screens and disable when they would change nothing.

Changes saves bounded open-card choices across reloads; opening all cards in memory can exceed that
persistence bound. Git keeps bounded per-commit choices in tab memory and starts cards expanded.
Individual toggles and accepted cache reuse remain available. Expansion requests uncached cards
below the viewport too; viewport-based loading is outside the current scope.

## Shared loading contract

The queue collects uncached expanded-card demand without an intentional delay and groups it by exact
project/source/version. Layer, path and language distinguish file requests. A small initial batch
publishes the first cards promptly, followed by larger batches to amortize request setup. One active
batch per client queue and bounded server concurrency limit work. Encoded request and response bytes
are bounded, including while the browser reads the response.

Each ready response must match its source and contain one identified result per requested file, in
request order. Ready values, independent file errors and explicit deferred results retain their
identities. A deferred result uses the individual read route with the same source/version checks; it
does not retry the same oversized batch indefinitely. Malformed requests or lost project/commit
access fail the whole request. Raw media keeps its separate routes and limits.

Collapse, navigation and cancellation release demand; canceled cards cannot accept late results. An
active request may still serve other expanded cards, but is aborted once none need it. Completion
releases jobs; the queue is not another result cache. Individual Retry and the shared bounded diff
cache retain their existing behavior.

[diff-batch-queue.ts](../src/client/diff-batch-queue.ts),
[server/diff-batch.ts](../src/server/diff-batch.ts) and
[shared/diff-batch.ts](../src/shared/diff-batch.ts) own scheduling, exact limits and correspondence.
The [card loader](../src/client/diff-loading.ts) owns result lifetime; source adapters keep their
identity and freshness policy.

## Source-specific checks

- Git reads validated detail for the complete commit ID and preserves parent availability, project
  scope and [immutable comparison rules](git-history-slice-proposal.md#comparison-rules).
- Changes individual and batch reads require the complete displayed snapshot and check both tokens
  before and after reading against lightweight inventory. Either token changing makes an individual
  read stale; in a batch, it or any stale file invalidates every payload. Client refresh generations
  reject late results and stale notices from another review. Recovery is the reader-controlled
  [Update flow](live-change-detection-slice-proposal.md), with no automatic refresh loop. The tokens
  are ordinary-edit signals, not an atomic filesystem snapshot.
- Every request uses the
  [stateless project contract](stateless-project-access-plan.md#project-contract-and-validation) and
  resolves files from the server inventory. Clients supply no rename origin or arbitrary Git
  expression. [Working-copy](../src/shared/change-diff-batch.ts) and
  [commit](../src/shared/commit-diff-batch.ts) contracts retain separate version and request shapes.

Feedback checks retain individual source reads using the latest complete snapshot, while drafts keep
their original anchors. A stale read preserves drafts for retry. The
[shared snapshot contract](../src/shared/change-snapshot.ts) owns token validation.

## Measurement evidence

Local API comparisons used fresh servers, a cold workload and two repeated workloads without
flushing OS caches. They compared three concurrent individual reads with the small-first-batch
policy and three server reads in flight. Timings are repeated-workload medians for detail plus every
file; separate cold traced workloads counted Git commands. File values matched individual reads.

| Fixture / scope      | Files | Total, individual → batch | First file, individual → batch | HTTP requests | Git commands |
| -------------------- | ----- | ------------------------- | ------------------------------ | ------------- | ------------ |
| Ordinary / root      | 12    | 278 → 231 ms              | 91 → 97 ms                     | 13 → 3        | 113 → 63     |
| Ordinary / subfolder | 6     | 153 → 151 ms              | 72 → 98 ms                     | 7 → 3         | 61 → 41      |
| Larger / root        | 220   | 5,370 → 3,679 ms          | 84 → 95 ms                     | 221 → 9       | 1,809 → 749  |
| Larger / subfolder   | 110   | 2,742 → 1,920 ms          | 91 → 96 ms                     | 111 → 6       | 909 → 384    |

For the large root fixture, fixed batches of eight took 4,205 ms; fixed batches of 32 took 3,622 ms
but delayed the first file to 576 ms. The small initial batch kept most throughput without that
delay. Encoded response bytes rose about 2%; small workloads can pay first-file overhead.

Desktop Chrome measured the same commit's first card at 0.82 → 0.81 s and all cards at 6.23 → 4.37
s, using 220 → 8 diff requests. A Changes fixture with 64 changed files and 96 staged/unstaged cards
measured first card at 0.60 → 0.59 s, all cards at 2.53 → 2.15 s and 96 → 4 requests. Each is the
median of two fresh contexts after warm-up, with the same server, styles and other client modules.
These local results do not establish phone or remote-network performance.

## Verification

[Server batch tests](../src/server/diff-batch.test.ts),
[Changes tests](../src/server/change-diff-batch.test.ts),
[commit tests](../src/server/commit-diff-batch.test.ts) and
[queue tests](../src/client/diff-batch-queue.test.ts) cover bounded work, correspondence, errors,
cancellation, stale invalidation/fallback, media, scope, shallow parents and root revalidation.

Browser QA covers cancellation with late responses, same-path layers, disabled controls, cache
reuse, URLs, expansion persistence, drafts and reading position at all four sizes plus 320 px. The
[Git loading](../qa/screenshots/git-diff-batching/mobile.png),
[Changes stale recovery](../qa/screenshots/changes-batch-stale/mobile.png),
[Changes bulk controls](../qa/screenshots/changes-bulk-toolbar/mobile.png) and
[Git bulk controls](../qa/screenshots/git-bulk-controls/mobile.png) milestone sets were inspected at
phone, both tablet orientations and desktop without page-wide overflow. The stale set uses a
controlled outdated snapshot against the real endpoint. Real-device touch and latency remain
unverified.
