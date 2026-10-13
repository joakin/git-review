# Live change detection

Changes detects ordinary edits without replacing code under the reader. While Changes and its
browser tab are visible, serialized periodic checks compare the accepted snapshot with lightweight
status. Checks pause in another view, a hidden tab, Settings or an open comment sheet. Returning
checks immediately. Files and Search retain manual refresh.

## Reader-controlled updates

A detected edit shows a persistent **New edits are available** notification with **Update** through
the [application notification system](application-notifications.md). Dismissal leaves the accepted
snapshot in place; Refresh remains available in the heading. Stale card batches use the same notice
and never start automatic refresh loops.

Update or Refresh accepts fresh inventory/counts and reloads expanded diffs. Open choices, drafts
and the current file/approximate reading position survive. If the card disappeared, restoration uses
the nearest surviving card or Changes heading. Restoration waits for expanded bodies and belongs
only to the original Changes destination.

A successful refresh clears the notice; further edits can be found by the next check. A failed
refresh keeps the ready review and pending notice with a brief error. Its new refresh generation
still renews expanded diff requests. Poll failures retain code/drafts and retry periodically,
showing a persistent check-error notification after repeated failures. Project switches discard the
old baseline and notice; superseded results cannot alter the current review.

Comments remain anchored to their original source and are rechecked before export. Applying an
update does not silently relocate or export outdated feedback.

## Ordinary-edit signal

Git porcelain can stay unchanged when an already modified or untracked file is edited again. The
separate change token combines that output with working-path metadata: type/mode, identity, size and
modification/change times. Stage/index changes already affect porcelain. Unique paths are inspected
once with bounded concurrency, within the selected real project, without following a final symlink
or escaping parent. Disappearing paths have a distinct marker; other access failures remain errors.
[git-status.ts](../apps/agent/src/git-status.ts) owns the signal and its bounds.

Metadata avoids hashing every changed file on each check and avoids dependence on filesystem watcher
events. It is an ordinary-edit signal, not proof of byte equality or an atomic snapshot. Touching a
file can produce an extra notice; a rewrite preserving all observed metadata can be missed until
manual Refresh. Applying Refresh still reloads expanded cards if the porcelain revision is
unchanged.

[Working-copy review](../apps/web/src/working-copy-review.ts) owns accepted snapshots, polling
lifetime and restoration; App supplies navigation/dialog pause policy. No polling state is
persisted. [Inventory](git-status-slice.md) owns the full/check response distinction,
[line counts](changes-line-counts-proposal.md) owns stable collection, and
[batching](diff-batching-and-bulk-controls-proposal.md#source-specific-checks) owns before/after
version checks for cards.

## Verification

[Status tests](../apps/agent/src/git-status.test.ts) cover tracked/untracked edits behind unchanged
porcelain output. [Live-change browser QA](../qa/check-live-changes.ts) checks steady code before
Update, drafts/expansion/reading position, pause/resume, serialized checks, error recovery, project
switching and containment at all four sizes plus 320 px. Its diagnostic output uses a fresh ignored
run directory; milestone capture policy belongs to the [QA workflow](qa-workflow.md#focused-checks).
Real phone placement/reachability and native touch remain unverified.
