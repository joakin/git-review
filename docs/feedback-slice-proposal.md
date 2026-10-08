# Feedback: lines, selected fragments, copy, and history

## User flow

1. Open working-tree text in Files or a Search result, or a working-copy diff. Tap/click a source
   row, then **Comment**, or select a fragment and choose **Comment** beside Search. Keyboard users
   can use line controls or selection actions.
2. The editor shows path, source, line, and quoted code; diffs also identify Old/New. Selected
   fragments are highlighted inside the full source line. Write, dictate, save, edit, or delete the
   comment. Closing or navigating away saves nonempty text on this device. Empty text is not a new
   saved draft. The editor is a phone sheet and a wider-screen dialog.
3. **Feedback** shows the project's draft count and opens drafts/copy history from every project
   view, including lists and historical Git inspection. Line markers and counts include both line
   and selection comments belonging to that source.
4. Preview checks the current sources. Copy checks again, exports current comments, and on confirmed
   success archives the exact copied text/batch and clears only that batch. **Undo last copy** can
   restore it. Failed or unavailable clipboard access preserves drafts and offers selectable text;
   archived entries can be opened and copied again.

Feedback creation covers unchanged Git files and non-Git folders as well as changed files.
Historical Git is inspection-only. Empty, media, binary, symbolic-link, unsupported, and oversized
views have no anchorable source lines but retain access to existing project feedback. Whole-file or
project notes and multi-line selections remain
[optional backlog](initial-implementation-plan.md#remaining-roadmap).
[Voice](local-voice-comment-slice-proposal.md) owns recording, caret insertion, Retry, and audio
lifetime. Closing the editor stops recording and discards pending audio while preserving typed text.

## Line actions and diff sides

Check/copy/Undo failures and copy confirmations use the
[application notifications](application-notifications.md), including above an open feedback dialog.
Pending transactions retain their ownership when the dialog closes; late current failures can still
notify on the page. Outdated comment state and Reattach controls remain with each affected item.

A completed short stationary tap reveals a transient action near the row. Long press, dragging,
double-tap selection, and existing selected text keep native selection priority; pointer-down on
code is not canceled. The line action shows available numbers and existing comment counts. It
follows its row while scrolling, clamps to the visual viewport, avoids sticky headings and Feedback,
and closes on outside input, Escape, wrapping, source/view changes, collapse, or loss of row
visibility.

Phones up to 600 px hide diff signs and both gutter columns in either wrap mode, retaining
added/removed backgrounds and word highlights. A focusable keyboard path consumes no gutter width.
Wider screens retain direct Old/New line-number buttons and the same row action. Files retain their
working-tree line-number controls.

Old and New refer to the comparison in each card:

| Card      | Old                                              | New          |
| --------- | ------------------------------------------------ | ------------ |
| Staged    | `HEAD`, or an empty tree before the first commit | Git index    |
| Unstaged  | Git index                                        | Working tree |
| Untracked | Empty file                                       | Working tree |

Added rows use New; removed rows use Old. A row action or selection on unchanged context defaults to
New, including the index side in Staged. When reattaching an Old draft to context, keep Old.
Wider-screen gutters allow either available side; phone context offers no separate Old action for a
new comment. Context text may match on both sides while line numbers differ. Staged and unstaged
versions of one path remain distinct sources.

## Selected fragments

Comment supports one logical source line, including wrapped text and selections across syntax-token
spans. Whitespace-only, cross-line, UI-label, gutter, dialog, or synthetic no-newline-annotation
selections do not create a comment. A valid fragment longer than the Search query limit may offer
Comment alone; [selected-code Search](search-slice-proposal.md#selected-code-search) owns query
behavior.

Fragment offsets are zero-based, end-exclusive UTF-16 positions in the exact source line, matching
browser Range and JavaScript indexing. They must stay within bounds, preserve the exact sliced text,
and never split a surrogate pair. Derive them from the actual selected range, including repeated
text and leading/trailing whitespace; searching for the first occurrence of the string would attach
feedback to the wrong fragment. Export uses one-based inclusive UTF-16 columns.

Selection remains transient until Comment. Its action must still belong to the current project and
rendered source snapshot, including the Git layer/side, when invoked. Tooltip focus may retain the
captured range; source replacement, navigation, outside input, or Escape invalidates it. Scrolling,
wrapping, and viewport movement update placement. Touch placement prefers below the visible range or
the header-adjacent fallback; mouse placement prefers above. Opening the editor clears native
selection and the tooltip without an extra source lookup.

## Anchor identity and checking

Diff and working-tree file anchors remain distinct even at the same path/line. Both retain exact
source text and neighboring context; diff anchors additionally identify the reviewable Git layer and
side. Conflicts cannot create feedback anchors. A line subject and a selection subject are also
distinct, with fragment positions/text included in selection identity. The
[comment model and validators](../src/client/comments.ts) define formats and bounds. A line or
neighboring context beyond the saved-source bound cannot create an anchor. In working-tree Files,
the direct line control explains that limit.

Opening Feedback checks sources before making export available. Opening, Check lines, and Copy each
submit one deduplicated anchor batch to the [feedback checker](../src/server/feedback-check.ts).
Empty drafts need no request. Only anchors leave the browser; comment bodies, subjects, IDs and copy
history remain local. The server returns one match result per anchor, with no status statistics,
display rows, syntax, word details or expandable context. These mutable reads bypass browser
caching. The source, line number, exact source text, and neighboring context must still match,
including the side for a diff. An unrelated edit elsewhere need not invalidate an unchanged file
anchor. Git status revision alone is insufficient because content can change without changing it.

Diff batches share two fresh project inventories, preserving rename origins and review-layer
semantics. Additional working-path fingerprinting is confined to feedback sources. Canonical hunk
matches need only one raw patch per path/layer; unmatched anchors read only the necessary source
sides, shared within the batch. Working-file comments share one bounded read per distinct path, and
file-only batches perform no Git operations. Mixed Files/diff checks can share raw working bytes
while retaining Files' CRLF normalization and diffs' exact text semantics. A changed inventory or
relevant working-path version during the batch blocks export for Retry. This detects intervening
changes without claiming an atomic repository snapshot. The
[shared API boundary](../src/shared/feedback-check.ts) and checker define request, source-work and
concurrency limits; errors and cancellation preserve drafts.

Revealing [diff context](diff-slice.md#revealing-unchanged-context) does not rewrite ordinary hunk
anchors. Newly revealed rows use exact neighbors from the chosen source side, including neighbors
outside the displayed chunk. Fresh checking first tries canonical hunks, then checks unmatched diff
anchors directly against bounded comparison sources. This preserves line and selected-fragment
drafts after collapse, Refresh or reload, without persisting expansion or changing the saved anchor
format. Source checks do not require the ordinary patch to fit its display budget. Unavailable
bounded reads block export for Retry; missing/non-text sources and mismatched text or neighbors mark
drafts outdated.

A changed, missing, or non-text source makes the draft outdated and excludes it from export. The
checker distinguishes working-file absence from project access, permission, network, and other read
failures, which retain drafts and block export until a successful Retry. Never silently relocate a
comment to another matching line or occurrence.

Reattachment explicitly asks for a new line or fragment in the same project and source kind.
Working-tree reattachment refreshes and opens the file at the anchored line; diff reattachment opens
its card. A selection draft requires a fresh selection, while a line draft requires a line. An
incompatible source/subject choice preserves the draft and explains what is needed. Reattachment
retains draft identity and body; reopen Feedback to verify the new anchor before copying.

## Copy transactions and recovery

A check merges validity only into still-existing drafts whose full anchors and subjects match the
checked versions. It preserves newer bodies, additions, deletions, reattachments, and history. The
checked set constrains both selectable preview text and the automatic copy snapshot; drafts added or
restored during a check require another check. Copy snapshots the latest saved bodies of those
checked anchors.

Navigation and opening an existing draft editor cancel pending check/copy ownership synchronously.
An issued browser clipboard write cannot be stopped and may still reach the system clipboard, but
its late canceled result cannot archive or clear drafts or change Undo, notices, or errors. Keep
exclusive clipboard ownership until the write settles, including across a project switch and return.
Further clipboard writes are disabled while copying. Closing Feedback alone allows an active copy to
finish.

Confirmed, uncanceled success archives the exact exported text and comments. It removes only drafts
whose ID, anchor, subject, body, timestamps, and current state still match the copied version. Later
edits, reattachments, additions, deletions, and Undo/history changes survive. Manual selectable-text
copy does not imply a confirmed application clipboard write and does not clear drafts.

Export is deterministic, grouped by source then path. Diff groups identify their layer and Old/New
line; file groups use Working tree lines. It quotes source text and selected fragments without
regenerating archived exports. Equal anchors retain stable creation-time/ID ordering. Oversized
exports preserve drafts and offer selectable text instead of creating an invalid history record.
Undo restores only missing draft IDs, preserving newer drafts with the same ID. If restoration would
exceed capacity, retain history and Undo and explain how to free capacity before retrying. The
[transaction engine](../src/client/feedback-transactions.ts) and
[comment operations](../src/client/comments.ts) define the executable contracts and limits.

## Persistence and display

Drafts and bounded copy history are local to this browser origin and canonical project path. Stored
and imported data are validated; invalid data fails closed, and storage denial leaves the current
review usable in memory. Two tabs editing the same project's drafts have no conflict resolution. The
[local-data record](independent-tabs-and-pwa-proposal.md#local-data-and-backups) owns backups; the
deliberate retirement of earlier formats is part of
[stateless project access](stateless-project-access-plan.md). No comment-writing server API or
repository write is involved.

The textarea and voice footer form one bordered composer with a straight divider and continuous
focus outline; its label remains associated with the input. Joined Search/Comment buttons round only
outer corners and draw one divider. A single available action has all four outer corners. Each
button retains its focus indicator and touch target.

## Verification and evidence

Existing tests cover anchor/subject identity and bounds, repeated text and surrogate boundaries,
current-format rejection/round trips, deterministic exports, late check/copy merges, cancellation,
exact archival, and Undo. Browser checks cover Files/Search identity, non-Git feedback, keyboard
creation, reload, stale exclusion/reattachment, selection across tokens/wrapped text, unsupported
sources, clipboard denial, and pending transactions. The [QA workflow](qa-workflow.md) owns commands
and capture procedures.

The source-check performance repair was accepted and completed on 2026-10-08 in three independently
reviewed steps; the [closure](feedback-check-performance-proposal.md) records their outcomes. Server
tests guard two inventories for five canonical diff files, no additional complete-source reads for
canonical matches, no Git for file-only batches, selected working-path fingerprints, shared source
reads, fallback beyond patch limits, mutation rejection and cancellation. Client tests guard one
deduplicated request for both opening and copying, no request for empty drafts, validated responses
and the existing transaction guarantees.

Local before/after measurements compare the original app at `266ca37` with the implementation at
`cf5f58e`, using identical fixtures and installed headless Chrome at 390 × 844 with touch emulation.
Each action has one discarded warm-up and five recorded samples, with alternating before/after
order. Opening is timed from its click event until Copy becomes enabled. Copy is timed from its
click event until an immediate controlled clipboard promise resolves, excluding native clipboard
delay. Each preview and clipboard export is checked against the saved batch, followed by successful
archival and Undo. The [raw measurements](../qa/measurements/feedback-check-performance.json)
contain every sample, request/body size and the complete fixture and timing description.

These are median milliseconds over HTTP loopback without added latency. The request and response
columns describe one fresh check, and the counts hold for both actions in every sample:

| Batch                                      | Open before → after | Copy before → after | Requests before → after | Response bytes before → after |
| ------------------------------------------ | ------------------- | ------------------- | ----------------------- | ----------------------------- |
| Three working files                        | 24.0 → 19.8         | 15.3 → 10.5         | 3 → 1                   | 234,678 → 45                  |
| Five canonical diff files                  | 238.1 → 40.5        | 235.8 → 39.4        | 6 → 1                   | 12,487 → 55                   |
| Five diff and three file anchors           | 242.9 → 40.8        | 242.2 → 40.0        | 9 → 1                   | 247,165 → 70                  |
| Five revealed-context anchors              | 388.8 → 41.9        | 390.7 → 40.9        | 11 → 1                  | 12,662 → 55                   |
| Five diff files with 600 unrelated changes | 608.3 → 75.4        | 596.5 → 73.8        | 6 → 1                   | 101,667 → 55                  |

The files have 500 lines and about 23 KiB each. The last case adds 300 modified tracked files and
300 untracked files of about 2–3 KiB each; feedback excludes their explicit application source reads
and statistics preparation. The two shared Git inventories still discover those entries, and Git may
inspect tracked content internally. A separate run adds a fixed 75 ms delay before each source-check
request. For five canonical diff files, opening changes from 733.0 to 120.5 ms and controlled
copying from 734.2 to 122.2 ms. This illustrates round-trip savings without simulating bandwidth,
native clipboard, a physical phone or Tailscale.

The feedback, working-file, selected-fragment and pending-transaction browser checks passed against
isolated fixture servers. Working-file and selection flows covered 320, 390, 820, 1180 and 1440
pixel widths; clipboard checks used the granted Chrome Clipboard API, while transaction races
controlled promises. The repair changes source-check work without changing visible layout, so no new
screenshot milestone was captured. Physical iOS/Android clipboard and Tailscale timings remain
unverified.

The full suite passed 278 tests, and formatting, typecheck, CSS-token validation and the client
build passed. After rebuilding the working app, the mobile feedback flow passed again, including
native Chrome copy, history, Undo, fallback, outdated exclusion, reattachment and Delete. Both
existing HTTP and HTTPS backends served the new no-store check with their previous root and origin
configuration.

These inspected Chrome-emulation milestones cover all four sizes without page-wide overflow:

| State                   | Phone                                                               | Tablet portrait                                                              | Tablet landscape                                                              | Desktop                                                              |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| File line action        | [Image](../qa/screenshots/usability-u03-file-action/mobile.png)     | [Image](../qa/screenshots/usability-u03-file-action/tablet-portrait.png)     | [Image](../qa/screenshots/usability-u03-file-action/tablet-landscape.png)     | [Image](../qa/screenshots/usability-u03-file-action/desktop.png)     |
| Mixed feedback          | [Image](../qa/screenshots/usability-u03-mixed-feedback/mobile.png)  | [Image](../qa/screenshots/usability-u03-mixed-feedback/tablet-portrait.png)  | [Image](../qa/screenshots/usability-u03-mixed-feedback/tablet-landscape.png)  | [Image](../qa/screenshots/usability-u03-mixed-feedback/desktop.png)  |
| Light selection actions | [Image](../qa/screenshots/joined-controls-light-actions/mobile.png) | [Image](../qa/screenshots/joined-controls-light-actions/tablet-portrait.png) | [Image](../qa/screenshots/joined-controls-light-actions/tablet-landscape.png) | [Image](../qa/screenshots/joined-controls-light-actions/desktop.png) |
| Dark selection actions  | [Image](../qa/screenshots/joined-controls-dark-actions/mobile.png)  | [Image](../qa/screenshots/joined-controls-dark-actions/tablet-portrait.png)  | [Image](../qa/screenshots/joined-controls-dark-actions/tablet-landscape.png)  | [Image](../qa/screenshots/joined-controls-dark-actions/desktop.png)  |
| Light composer          | [Image](../qa/screenshots/joined-controls-light-editor/mobile.png)  | [Image](../qa/screenshots/joined-controls-light-editor/tablet-portrait.png)  | [Image](../qa/screenshots/joined-controls-light-editor/tablet-landscape.png)  | [Image](../qa/screenshots/joined-controls-light-editor/desktop.png)  |
| Dark composer           | [Image](../qa/screenshots/joined-controls-dark-editor/mobile.png)   | [Image](../qa/screenshots/joined-controls-dark-editor/tablet-portrait.png)   | [Image](../qa/screenshots/joined-controls-dark-editor/tablet-landscape.png)   | [Image](../qa/screenshots/joined-controls-dark-editor/desktop.png)   |
| Pending copy            | [Image](../qa/screenshots/maintenance-m03-copying/mobile.png)       | [Image](../qa/screenshots/maintenance-m03-copying/tablet-portrait.png)       | [Image](../qa/screenshots/maintenance-m03-copying/tablet-landscape.png)       | [Image](../qa/screenshots/maintenance-m03-copying/desktop.png)       |

Earlier evidence remains in the [first preview](../qa/screenshots/feedback-first-slice/),
[first editor](../qa/screenshots/comment-editor-first-slice/),
[sticky file heading](../qa/screenshots/sticky-file-header/),
[checked preview](../qa/screenshots/maintenance-m03-feedback/),
[file editor](../qa/screenshots/usability-u03-file-editor/), and
[initial selection preview](../qa/screenshots/usability-selected-preview/) folders; the initial
selection [actions](../qa/screenshots/usability-selected-actions/) and
[editor](../qa/screenshots/usability-selected-editor/) remain available alongside that preview.

The maintainer accepted the working-tree extension on 2026-10-04 and the selection/composer
refinements on 2026-10-05. Browser file/selection copy checks used the granted Chrome Clipboard API;
transaction races controlled promises and voice checks mocked recording/transcription. Dedicated
physical Android/iOS native selection, clipboard permissions, keyboard, safe areas, and interruption
checks were not newly verified by those milestones. HTTPS run/install guidance belongs in the
[root README](../README.md#install-on-a-phone).
