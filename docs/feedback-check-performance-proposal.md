# Feedback check performance proposal

Status: approach approved on 2026-10-08; implementation is in progress. Each step receives an
independent review and is committed after findings are addressed, as requested by the maintainer.

The [feedback record](feedback-slice-proposal.md) owns current anchor, transaction, copy and
recovery behavior. This proposal changes the cost of source checking while retaining those contracts
and the current stored-comment format.

## Findings

Opening Feedback and copying each run
[the same source check](../src/client/feedback-transactions.ts). Diff checking first requests the
full review status, including statistics for unrelated changes. Each commented path/layer then
receives a sequential ordinary diff request with its own before/after project inventory reads.
Unmatched anchors receive another per-file context request and another pair of inventory reads.
Working-file comments receive sequential display-oriented file responses.

The initial [review status](../src/server/change-stats.ts) normally reads inventory twice. With five
commented diff path/layer pairs, no unmatched anchors, and no concurrent changes, one check
therefore reads project inventory twelve times; opening then copying reads it twenty-four times.
Each [inventory read](../src/server/git-status.ts) also fingerprints every changed working path.
Normal [diff preparation](../src/server/git-diff.ts) reads complete old/new sources to prepare
expandable context even when feedback's plain-text request bypasses syntax highlighting. Patch
parsing also calculates word details. None of those display results is needed in the feedback
response.

Two focused probes informed the proposed boundary:

- A replacement hunk gives its New row a saved `before: null` when the preceding displayed row is
  Old-only, even though the physical New source has a preceding line. The current hunk matcher
  accepts that anchor while an exact physical-source comparison rejects it. Saved hunk neighbors
  must retain their meaning; treating null as a wildcard would weaken checking.
- In a temporary repository, project-wide status reported a staged rename with its original path.
  Status limited to the destination path reported an addition and lost that origin. Including both
  paths restored the rename. Anchors do not store rename origins, so narrowing status directly would
  change existing Old-side source interpretation.

These were local source/Git probes, not measurements of phone or network latency. No production
implementation was changed during investigation.

## Smallest useful slice and user flow

Keep the current dialog and source-freshness policy. Opening Feedback performs a fresh check and
enables Copy when current comments are available. Check lines repeats that check. Copy performs a
fresh check, builds text locally, writes the clipboard, then archives the exact successful batch.
Empty drafts need no request; copied history needs only its existing clipboard write.

Replace the source-check internals with one dedicated server request. Do not introduce a preview
cache, background checking, new stored anchor versions, or changes to the clipboard transaction. The
purpose is to make each fresh check cheap rather than add cache invalidation to this repair.

## Data and API shape

Add a read-only `POST /api/project/feedback/check` using the existing canonical project-path query
and per-request project authorization.

The body contains a deduplicated array of anchors: source kind, project-relative path, line, exact
source text and saved neighbors; diff anchors additionally carry Git layer and Old/New side. Comment
bodies, subjects, IDs, timestamps and copy history stay in the browser. Validated selection subjects
remain tied to their full source line and require no additional source read.

Return either a checked result with one boolean per submitted anchor, in request order, or a stale
result when a relevant source changes during checking. Use the existing structured API errors for
unreadable or unavailable checks, including the affected path. Validate request fields, paths,
anchor counts, text bounds, response count and response values at their boundaries. The count cap
must accommodate the existing project draft capacity; body and total source-work budgets remain
explicit and failures preserve drafts.

The client maps those results onto its captured draft anchors/subjects and feeds the existing
`CheckedComments` merge. Request cancellation and generation ownership continue to reject late
results and preserve concurrent edits.

## Server work

1. Resolve and validate the project once. Group anchors by source and share operation-local reads. A
   file-only batch performs no Git operation.
2. For diff anchors, obtain one fresh project inventory without statistics. Preserve full project
   inventory semantics for rename discovery, layers, conflicts, submodules and absent changes. Reuse
   the current Git transport and porcelain parser. Factor inventory reading from working-path
   fingerprinting so feedback fingerprints only the mutable working paths its check actually uses,
   including file anchors in mixed batches. Keep this separate from the public Changes snapshot
   tokens; do not change their meaning.
3. Check ordinary tracked diff anchors against the canonical raw patch once per path/layer. Separate
   structural patch parsing from word-detail decoration and reuse that parser. Do not prepare
   syntax, expandable context, media payloads, or a client diff response. Match requested
   coordinates in one pass rather than scan all hunks again for each comment.
4. For unmatched diff anchors, read only the required Old/New source sides and compare the exact
   saved line and neighbors, as the existing context fallback does. Share each side read within the
   operation. A canonical patch match requires no additional complete-source read. An oversized
   patch must still permit the existing bounded source fallback.
5. Read untracked and working-file sources once per distinct working path. Reuse checked file
   access, byte classification and source limits; compare anchors without building display rows or
   syntax tokens. Share raw bytes when Files and diff fallback use the same working path, but retain
   Files' CRLF normalization and diffs' exact text semantics. Preserve media/unsupported-source
   classification without generating preview payloads.
6. After checking, obtain one final project inventory for the diff batch and recheck the versions of
   the working sources actually read. Reject relevant mutation rather than return a mixed check.
   Preserve the current Git-version signal and checked-file boundaries; these do not provide an
   atomic snapshot of an externally editable repository.
7. Return only match results. Bound simultaneous source reads, total bytes and subprocess work, and
   stop scheduling work after cancellation. Keep concurrency small; reduced work is the primary
   improvement.

Two full project inventory reads remain necessary in this slice to preserve existing rename/source
behavior without designing another Git discovery mechanism. Additional working-path fingerprinting
and complete-source reads are confined to feedback sources. Unrelated changed-file content is never
read to calculate statistics or prepare displays.

## Expected work reduction

For one normal check with five commented tracked diff path/layer pairs, no source fallback and no
concurrent change:

| Work                              | Current                         | Proposed                   |
| --------------------------------- | ------------------------------- | -------------------------- |
| Browser API requests              | Six                             | One                        |
| Project inventory reads           | Twelve                          | Two                        |
| Change line-count work            | All changed files               | None                       |
| Extra working-path fingerprinting | All changed paths on every scan | Feedback source paths only |
| Canonical patch reads             | Five                            | Five                       |
| Additional complete-source reads  | Old/New context preparation     | Only for unmatched anchors |
| Word/syntax/context display data  | Ordinary diff response          | None                       |
| Server response                   | Status and full diff payloads   | One boolean per anchor     |

File-only batches use one request, no inventory reads and one bounded read per unique path. Opening
and copying each retain a fresh check, so the normal five-file example falls from twenty-four to
four inventory reads across the two actions. These are work counts, not a predicted time saving.

## Reviewable implementation steps

1. Add the shared anchor-check API contract and server checker. Factor only the inventory, raw-hunk
   parsing and text-comparison pieces needed by this checker. Leave Changes, normal diff rendering
   and stored drafts on their existing public contracts. Verify server behavior and work counts.
2. Route `FeedbackTransactions.checkSnapshot` through the new endpoint. Preserve merge, cancel,
   clipboard ownership, history and Undo. Update browser checks that currently intercept the old
   individual requests, rebuild the client and run the feedback flows against an isolated fixture
   server.
3. Compare representative batches before/after, update the feedback owner and documentation map, and
   commit after the independent review findings are addressed.

## Verification and acceptance

Test hunk-relative neighbors and boundaries, exact source fallback, revealed-context anchors,
selections, blank/final lines, CRLF differences, duplicate anchors, staged/unstaged sources,
Old/New, renames, deletion, conflicts, unborn/non-Git projects and patch/source limits. Cover file
absence versus read/permission/project failures, containment and symlink handling, and mutation
during a read or batch. Preserve the transaction coverage for newer bodies, reattachment,
added/deleted drafts, navigation cancellation, failed clipboard writes, exact archival and Undo.

Guard the intended work bounds: one normal browser request, two inventory reads independent of
commented-file count, no statistics/display preparation, no Git for file-only feedback, and no
duplicate reads of a shared source. Use operation counts as durable performance assertions and
report timing measurements separately.

Measure opening-to-enabled and click-to-clipboard completion for file-only, several-diff-file, mixed
and revealed-context batches. Include a fixture with many unrelated changed/untracked files to
verify that their contents are not read. Record request/response sizes and server work as well as
elapsed time. Browser latency simulation can expose round-trip savings; it does not establish
physical-device clipboard or Tailscale timing.

Run formatting, the project-local typecheck gate, focused/server and transaction tests, and the
relevant browser feedback scenarios. Keep the maintainer's app available after rebuilding/restarting
the affected processes. The slice proposes no visible layout change; capture the four viewport sizes
if implementation changes visible status, error or dialog behavior. Physical iOS/Android clipboard
timings remain a separate device check unless actually measured.
