# Selected code → Search or Comment

Status: approved for implementation on 2026-10-04; implementation will remain uncommitted for review

Created: 2026-10-04

After reviewing the
[U03 file-feedback implementation](pwa-navigation-and-file-feedback-proposal.md#u03-handoff--2026-10-04),
the maintainer requested a Comment action beside Search in the selected-code tooltip, then approved
this single-line fragment proposal and committing U03. This is the next small usability extension.
Maintenance remains paused. Implementation and commit approval remain separate under
[the collaboration rules](../AGENTS.md).

## User flow and smallest useful slice

1. Select text inside one code line in Files, a Search result, or a working-copy diff. Keep the
   browser's native selection, handles and Copy menu.
2. Show **Search** and **Comment** together in the existing contextual action. Keep the short
   selection preview, keyboard access and touch-sized controls. Touch placement remains below the
   selection or in the existing header-adjacent fallback; mouse placement prefers above. Selection
   changes, scrolling, wrapping, resize and dismissal update both actions together.
3. Search retains its current literal-query behavior. Comment opens the shared editor, identifies
   the source/path/line, and highlights the exact selected fragment within the full source quote. A
   new comment has an empty body and the existing voice input.
4. Feedback preserves the selected fragment in the saved draft, preview, copied text and history.
   Its line marker/count includes line and selection comments. Checks use the same source-line and
   neighbor validation as U03; editing the source cannot silently move a comment to a different
   occurrence of the same text.
5. Reattaching a selection comment requests a fresh fragment in the same source kind. Existing line
   comments retain their line reattachment flow. Selecting Comment while a different source kind is
   being reattached retains the draft and explains the required source.

The first slice supports selections contained in one logical code line, including a wrapped line and
selections crossing syntax-token spans. Multiple-line ranges are a separate extension because they
need range anchors, boundary-context checks and a different export contract. Historical Git diffs
retain inspection-only behavior. Selecting whitespace alone or UI labels offers no new Comment
action. Search retains its 128-character limit; a valid longer fragment can still offer Comment
within the existing saved-source bound, without submitting an invalid Search query.

## Data and API shape

Retain the source anchor union introduced by U03. Represent a comment's subject explicitly so an
ordinary line comment and a selected fragment have precise internal states:

```ts
type CommentSubject =
  { kind: "line" } | { kind: "selection"; start: number; end: number; text: string };
```

The selection offsets are zero-based, end-exclusive UTF-16 positions in the anchor's validated
`sourceText`, matching browser Range and JavaScript string indexing. Validate the bounds, character
boundaries and exact sliced text before saving or importing. Derive offsets from the actual Range
across code tokens; never guess using the first occurrence of the selected string. Resolve the
anchor from the rendered source snapshot, including the correct Git layer and Old/New side, rather
than inferring it from the current route alone.

Keep the selection transient until the user chooses Comment. The captured action must still belong
to the current project, source and rendered content when invoked. Preserve the captured fragment
across the tooltip's own focus changes, and reject an action after code replacement or navigation.
Opening the editor clears native selection and dismisses the tooltip. No source lookup request is
needed to open the editor, and no repository-writing API is added; preview/copy retain U03's fresh
read checks.

Add the subject to drafts and archived comments. Increment the comment-store format and backup
format; migrate legacy comments to `{ kind: "line" }` while preserving IDs, bodies, timestamps,
source anchors and exact copied history text. Keep import of supported earlier backups, including
U03's mixed v4 model. New selection comments export their source line and a clearly quoted selected
fragment. Successful-copy identity includes the subject so a pending copy cannot clear a comment
whose selection was edited or reattached.

## Edge cases and review

- Files and Search reach the same fragment identity; diff and file anchors remain distinct. Diff
  context uses New, removed rows use Old, with the existing reattachment-side rule retained.
- Exact repeated-text offsets, syntax spans, leading/trailing spaces, punctuation, tabs, Unicode and
  wrapped lines. Do not anchor the diff's synthetic no-newline annotation, gutters or dialog text.
- Cross-line selections, empty/oversized fragments, unavailable sources and source replacement while
  the tooltip is held or keyboard-focused.
- Native selection priority, Copy handles, page and horizontal code-pane scrolling, 320 px width,
  visual-viewport movement, safe areas and overlap with navigation/Feedback.
- Source edits, checked preview/copy, reload, migration/backup transfer, delayed checks, pending
  clipboard writes, Undo and both reattachment flows.
- Run strict TypeScript, formatter/CSS gates, focused durable tests and browser checks. Capture and
  inspect the combined action and selection editor at phone, tablet portrait, tablet landscape and
  desktop sizes. Browser emulation does not replace maintainer Android/iOS selection-menu review.

Next step: commit the accepted U03 work, then implement this approved single-line fragment flow as
an uncommitted extension for review.
