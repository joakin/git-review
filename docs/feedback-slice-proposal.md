# Line feedback and copy: first usable review loop

Status: implemented, reviewed, and committed. The original line-number interaction was approved on 2026-09-27; the later [phone line action](phone-portrait-gutter-slice-proposal.md) adds row tap/click access at every size.

## Smallest useful slice

This slice established the review loop: select a diff line, write a comment, preview comments, and copy a line-numbered summary into an editing session. Later slices add row actions, voice input, and URL navigation while keeping the same anchor and export model.

## User flow

1. Open a changed file card. Tap or click a code row, then its floating Comment action. Added and unchanged lines use New; removed lines use Old. Phones hide the gutters, while wider screens also offer direct old/new line-number buttons. Native text selection takes precedence and opens Search; double tap is not a comment shortcut.
2. A comment editor opens as a bottom sheet on a phone and a dialog on wider screens. It shows path, Git layer, side, line number, and a short source quote. Type a comment, save it, edit it, or delete it. Closing an edited sheet saves the draft. The line and file show a comment count or marker.
3. A sticky Feedback button shows the draft count. It opens a preview grouped by Git layer and file. Each item shows side, line, source quote, and comment text. The preview offers Copy feedback and a selectable text fallback.
4. After a confirmed clipboard write, save an immutable history entry and clear the copied drafts, with immediate Undo. If writing fails or the clipboard API is unavailable, leave drafts intact and reveal selectable text. History can be reopened and recopied.

## Data and boundaries

No comment-writing server API is needed. Drafts and bounded history live in versioned browser `localStorage` under the opened project ID; state is local to each browser/device. Parse stored data as unknown at the boundary and discard invalid records. Keep the domain parser with the comment model and reuse generic helpers from `src/shared/validation.ts`.

An active draft has a generated ID, project ID, Git layer, folder-relative path, old/new side, positive line number, exact source text, a short surrounding-line fingerprint, body text, and creation/update times. Use explicit variants for active and outdated anchors. Bound draft count, body length, path length, and history size. Empty text is not a saved comment.

Opening Feedback fetches current status and the diff for each commented file/layer before making copy available. A draft is current only if its side, line number, exact source text, and stored neighboring context still match. Mark mismatches outdated and require reattachment before including them in copied feedback; never silently export a comment under a new line. Unique relocation by context is not implemented. This avoids relying on the status revision alone, which can remain unchanged when a modified file's content changes.

Export plain text deterministically, grouped by layer and path, with old/new side, line number, quoted source, and comment. Only a resolved clipboard write counts as a successful copy for history. The export formatter is a pure function so behavior tests can cover ordering, escaping, and stale exclusion.

## Edge cases and verification

- Staged and unstaged versions of one path remain separate. Deleted lines anchor to old, added lines to new, and context lines permit either side.
- Reloads, switching folders, and closing the sheet retain drafts. Corrupt or oversized storage fails closed without breaking the diff page.
- Line text may contain tabs, CRLF, very long lines, or unusual characters in a filename; export remains legible and unambiguous.
- Clipboard denial, unavailable Clipboard API, and copy cancellation preserve drafts. History records only confirmed success, and Undo restores the cleared batch.
- Keyboard users can focus line buttons, open and close the editor, and copy feedback. The sheet respects phone safe areas and the on-screen keyboard.
- Test comment anchors, parser rejection, export text, success/failure history transitions, and key browser flows. Capture and inspect phone, both tablet orientations, and desktop screenshots. Verify actual gestures and clipboard behavior on iOS/Android before calling mobile copy complete.

## Phone access milestone

The first Tailscale URL used HTTP, so remote browsers could lack `navigator.clipboard.writeText()`. The selectable feedback text remains as a fallback. The app is now available through private HTTPS on port 8443; real-device clipboard verification is still needed. The direct HTTP URL remains available for local-data export. [Clipboard security](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Implemented behavior and review checkpoint

- Tap a code row and its Comment action, or an old/new line-number button on wider screens, to open the editor. Save, edit, or delete comments; a nonempty edit is saved when the sheet closes or navigation leaves it. Line actions, visible gutters, and the fixed Feedback button show draft presence. Drafts and copy history are stored per project in this browser.
- Opening Feedback checks the current Git status and diff for each commented file. The export text and Copy button appear only after that check succeeds. Changed or missing lines become outdated and are excluded. Tap **Reattach to line**, then tap a code row and its Comment action (or a visible line number on a wide screen) to move the comment; reopen Feedback to verify it.
- Copying successfully creates one history entry and clears only the copied drafts. **Undo last copy** restores that batch during the same page session. Clipboard failure preserves drafts and shows selectable text. Past history entries expand to show selectable text and offer Copy again.
- Browser QA covers a phone flow through save, immediate reload, preview, successful copy, history, Undo, Clipboard API absence, and outdated-line exclusion. The diff QA still checks wrap, scroll containment, and C syntax. Screenshot sets for [feedback](../qa/screenshots/feedback-first-slice/mobile.png) and [comment editing](../qa/screenshots/comment-editor-first-slice/mobile.png) include phone, tablet portrait, tablet landscape, and desktop; their manifests report no page-wide horizontal overflow.
- After Android feedback on the first build, draft and history IDs use `crypto.getRandomValues`, which remains available on the HTTP Tailscale origin where `crypto.randomUUID` is absent. Comment and feedback dialogs lock background scrolling and close from a backdrop tap. Expanded file headings stick just below the top bar while their card is in view, so a long diff keeps its filename visible. The browser QA simulates the missing UUID API and checks save, backdrop dismissal, and long-file scrolling; [sticky header captures](../qa/screenshots/sticky-file-header/mobile.png) show the four viewport sizes.

The current HTTPS URL uses port 8443. Dedicated iOS/Android keyboard, gesture, and clipboard checks remain for the device milestone. The current row action preserves native double-tap selection; adding another gesture would need a separate proposal.
