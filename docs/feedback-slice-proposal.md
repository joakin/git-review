# Line feedback and copy: first usable review loop

Status: implemented, reviewed, and committed. The original line-number interaction was approved on
2026-09-27; the later [phone line action](phone-portrait-gutter-slice-proposal.md) adds row
tap/click access at every size.

## Smallest useful slice

This slice established the review loop: select a diff line, write a comment, preview comments, and
copy a line-numbered summary into an editing session. Later slices add row actions, voice input, and
URL navigation.
[U03](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files), accepted
and committed as `7632b4d`, extends the anchor and export model to working-tree text lines in Files
and Search.

## User flow

1. Open a text file in Files or a Search result, or a changed file card. Tap or click a code row,
   then its floating Comment action. Files use Working tree lines and provide a keyboard-accessible
   line-number button. In diffs, added and unchanged lines use New; removed lines use Old. Phones
   hide diff gutters, while wider screens also offer direct old/new line-number buttons. Native text
   selection takes precedence and offers Search or Comment; double tap is not a comment shortcut.
2. A comment editor opens as a bottom sheet on a phone and a dialog on wider screens. It shows path,
   Git layer and side for a diff anchor, or Working tree for a file anchor, plus line number and a
   short source quote. Type a comment, save it, edit it, or delete it. Closing an edited sheet saves
   the draft. The line and file show a comment count or marker.
3. A sticky Feedback button shows the project draft count in every project view. It opens a preview
   grouped by source and file. Each item shows its source, line, source quote, and comment text;
   diff items also identify Old/New. The preview offers Copy feedback and a selectable text
   fallback.
4. After a confirmed clipboard write, save an immutable history entry and clear the copied drafts,
   with immediate Undo. If writing fails or the clipboard API is unavailable, leave drafts intact
   and reveal selectable text. History can be reopened and recopied.

## Data and boundaries

No comment-writing server API is needed. Drafts and bounded history live in versioned browser
`localStorage` under the canonical absolute project path; state is local to each browser/device.
Parse stored data as unknown at the boundary and discard invalid records. Keep the domain parser
with the comment model and reuse generic helpers from `src/shared/validation.ts`.

The [shared modal hook](../src/client/modal.ts) owns dialog presentation and dismissal, while the
[feedback owner](../src/client/review-feedback.ts) saves non-empty editor text on close. Closing
unmounts the editor so its voice owner can stop recording and discard pending audio. Installation
uses the same modal hook independently of feedback.

The feedback owner keeps the loaded project session in memory even when the picker hides it.
Navigation cancels pending ownership and saves the latest editor into its current store before the
destination changes; an accepted project open explicitly loads that project’s store. App owns URL
changes and polling policy, while dialogs consume feedback values and actions.

A project store owns drafts and copy history. Each draft has a generated ID, an anchor, body text,
creation/update times, and a current/outdated state. Its anchor carries the reviewable Git layer,
folder-relative path, old/new side, positive line number, exact source text, and neighboring-line
fingerprint. A discriminated `kind: "diff" | "file"` keeps these anchors distinct: file anchors
carry `source: "worktree"`, path, line, exact text and neighboring context, without a Git layer or
side. [ReviewLayer](../src/client/comments.ts) names only staged, unstaged, and untracked: storage
parsing already rejects conflicts, and the broader line-anchor factory rejects conflict status
entries before creating an anchor. Bound draft count, body length, path length, and history size.
Empty text is not a saved comment.

Opening Feedback checks each source before making copy available. Diff drafts fetch current status
and a plain-text diff per file/layer. File drafts reread each commented path once using the bounded
working-tree file API with plain text. File-only batches need no Git status. Missing/non-text files
are outdated; read or project errors retain drafts and disable export until a successful retry. A
draft is current only if its source, line number, exact source text, and stored neighboring context
still match; diff anchors also retain their side. Mark mismatches outdated and require reattachment
before including them in copied feedback; never silently export a comment under a new line. Unique
relocation by context is not implemented. This avoids relying on the status revision alone, which
can remain unchanged when a modified file's content changes.

Export plain text deterministically, grouped by source and path, with line number, quoted source,
and comment. Diff sections retain their layer and old/new side; file sections use `[worktree]` and
`line N`. Equal anchors sort by creation time and ID, keeping duplicate-comment ordering stable.
Only a resolved clipboard write counts as a successful copy for history. The export formatter is a
pure function so behavior tests can cover ordering, escaping, and stale exclusion.

The [feedback transaction owner](../src/client/feedback-transactions.ts) keeps checks and clipboard
operations in tab memory. Stored comments use version 4 at `git-review:comments:v2:` followed by the
URI-encoded canonical absolute project path. Backup export/import uses version 6 with absolute
project ownership. Old project data is discarded; obsolete comment and backup readers have been
removed without migration. New copied history text remains exact. The
[selection follow-up](selected-code-feedback-proposal.md) defines precise line/selection subjects. A
check merges validity only into still-existing drafts with matching full anchors and subjects,
preserving newer bodies, additions, deletions, reattachments, and history. The successful check
carries its checked ID/anchor/subject set into both the selectable preview and the automatic copy
snapshot. Drafts added or restored during a check need another check before entering that export.
Copy always checks again and snapshots the latest saved bodies belonging to the checked anchors.

While a clipboard write is pending, show **Copying feedback…** and disable further feedback/history
writes. Check/copy cancellation happens synchronously on navigation and before opening an existing
draft editor, protecting unsaved editor text. An issued browser clipboard write cannot be stopped
and may still reach the system clipboard; after cancellation, its late result does not archive or
clear drafts or change Undo, notices, or errors. Keep the clipboard lease until it actually settles,
including after returning to the same project. Closing Feedback alone permits an active copy to
finish.

On confirmed, uncanceled success, append the exact exported batch/text to the current history and
remove only drafts whose ID, full anchor, body, creation/update times, and current state still match
that exported version. Preserve later edits, reattachments, added drafts, deletions, and concurrent
Undo/history changes. History stays bounded to 20 entries and 250,000 characters per export; a
larger export retains drafts and offers selectable text without creating an invalid history record.
Undo restores only missing IDs, preserving newer drafts with the same ID. If restoration would
exceed 200 drafts, keep the history and Undo available and show an inline message to free capacity
before retrying.

## Edge cases and verification

- Staged and unstaged versions of one path remain separate. Deleted lines anchor to old, added lines
  to new, and context lines permit either side.
- Reloads, switching folders, and closing the sheet retain drafts. Corrupt or oversized storage
  fails closed without breaking the diff page.
- Line text may contain tabs, CRLF, very long lines, or unusual characters in a filename; export
  remains legible and unambiguous.
- Clipboard denial, unavailable Clipboard API, and copy cancellation preserve drafts. History
  records only confirmed success, and Undo restores the cleared batch.
- Keyboard users can focus line buttons, open and close the editor, and copy feedback. The sheet
  respects phone safe areas and the on-screen keyboard.
- Test comment anchors, parser rejection, export text, success/failure history transitions, and key
  browser flows. Capture and inspect phone, both tablet orientations, and desktop screenshots.
  Verify actual gestures and clipboard behavior on iOS/Android before calling mobile copy complete.

## Phone access milestone

The first Tailscale URL used HTTP, so remote browsers could lack `navigator.clipboard.writeText()`.
The selectable feedback text remains as a fallback. The app is now available through private HTTPS
on port 8443; real-device clipboard verification is still needed. The direct HTTP URL remains
available for local-data export.
[Clipboard security](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText),
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Implemented behavior and review checkpoint

- Tap a code row and its Comment action, or an old/new line-number button on wider screens, to open
  the editor. Save, edit, or delete comments; a nonempty edit is saved when the sheet closes or
  navigation leaves it. Line actions, visible gutters, and the fixed Feedback button show draft
  presence. Drafts and copy history are stored per project in this browser.
- Opening Feedback checks the current Git status and diff for each commented file. The export text
  and Copy button appear only after that check succeeds. Changed or missing lines become outdated
  and are excluded. Tap **Reattach to line**, then tap a code row and its Comment action (or a
  visible line number on a wide screen) to move the comment; reopen Feedback to verify it.
- Copying successfully creates one history entry and clears only the copied drafts. **Undo last
  copy** restores that batch during the same page session. Clipboard failure preserves drafts and
  shows selectable text. Past history entries expand to show selectable text and offer Copy again.
- Browser QA covers a phone flow through save, immediate reload, preview, successful copy, history,
  Undo, Clipboard API absence, and outdated-line exclusion. The diff QA still checks wrap, scroll
  containment, and C syntax. Screenshot sets for
  [feedback](../qa/screenshots/feedback-first-slice/mobile.png) and
  [comment editing](../qa/screenshots/comment-editor-first-slice/mobile.png) include phone, tablet
  portrait, tablet landscape, and desktop; their manifests report no page-wide horizontal overflow.
- After Android feedback on the first build, draft and history IDs use `crypto.getRandomValues`,
  which remains available on the HTTP Tailscale origin where `crypto.randomUUID` is absent. Comment
  and feedback dialogs lock background scrolling and close from a backdrop tap. Expanded file
  headings stick just below the top bar while their card is in view, so a long diff keeps its
  filename visible. The browser QA simulates the missing UUID API and checks save, backdrop
  dismissal, and long-file scrolling;
  [sticky header captures](../qa/screenshots/sticky-file-header/mobile.png) show the four viewport
  sizes.

The current HTTPS URL uses port 8443. Dedicated iOS/Android keyboard, gesture, and clipboard checks
remain for the device milestone. The current row action preserves native double-tap selection;
adding another gesture would need a separate proposal.

## Maintenance verification — 2026-10-01

M08a makes the existing layer restriction explicit in `CommentAnchor`: staged, unstaged, and
untracked. The status-entry factory retains its conflict guard, while the formatter removes
unreachable conflict ordering. Five new boundary tests and the extended export test verify factory
rejection, valid-layer ordering/round-trips, atomic invalid draft/history rejection, and backup
versions 1–3. Strict gates, the full 120-test suite, build, phone feedback QA, and all seven
transaction browser scenarios pass. The change is accepted and committed as `acf06ca` on 2026-10-01
after explicit approval. No new screenshots or actual device clipboard/gesture checks were
performed.

M03 is accepted and committed as `59cadf3`. It adds explicit check/copy ownership, current-store
merges, checked manual export, exact copied-batch archival, and recovery guards for Undo/history
limits. Twenty-five new regressions cover delayed requests/clipboard results and saved version-1
invariants. The full suite passes 88 tests with 1,155 assertions; strict type checking, CSS token
validation, and client build also pass.

The [focused browser check](../qa/check-feedback-transactions.ts) reproduces the original
overwritten-edit bug with the pre-fix client and passes all seven scenarios with the final client.
The ordinary phone feedback flow also passes. Captured and inspected
[checked preview](../qa/screenshots/maintenance-m03-feedback/mobile.png) and
[pending copy](../qa/screenshots/maintenance-m03-copying/mobile.png) at phone, tablet portrait,
tablet landscape, and desktop sizes show wrapping and available controls without page-wide overflow;
sibling images and manifests are in each folder. Pending-copy captures and race checks use
controlled clipboard promises in isolated QA. Actual iOS/Android clipboard permissions, native
gestures, and keyboard behavior were not reverified. QA services were stopped, and the running
review services serve the rebuilt client.
