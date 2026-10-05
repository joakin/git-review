# Selected code → Search or Comment

Status: implemented on 2026-10-04; accepted with explicit commit approval on 2026-10-05

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

The maintainer accepted the selection extension and joined-control correction on 2026-10-05 and
explicitly requested their commit. U03 is committed as `7632b4d`. The next maintenance slice is M10;
its work and review are recorded in the [maintenance plan](maintenance-plan.md).

## Implementation and review handoff — 2026-10-04

The approved slice is implemented. [Rendered code registration](../src/client/code-selection.tsx)
connects each line to its project, source anchor, and resource snapshot. The
[shared action](../src/client/CodeSelectionActions.tsx) derives exact offsets from the native Range,
then offers Search and Comment. Wrapped selections place the touch action below the visible selected
range. Both buttons have 44 px hit areas. The action follows scrolling and viewport movement, avoids
navigation/Feedback/reattachment controls, and clears on outside pointer input, source replacement,
navigation, Escape, or editor opening. Tooltip focus may retain the validated range.

[Comments](../src/client/comments.ts) store a line or selection subject in version 3 at the existing
storage key. Versions 1 and 2 migrate to line subjects; archived copied text stays exact. Backup
export uses version 5 and accepts earlier versions 1–4 with their original comment formats. Import
preserves fragment positions and text. Selection export includes the full source line plus a quoted
fragment and one-based, inclusive UTF-16 columns. Checks and copy snapshots include subject
identity; a reattachment during a pending check/write cannot validate or clear the newer fragment.

The editor and feedback preview highlight the fragment inside its full source quote and label the
subject as Selection. Existing line markers count both subjects. Selection reattachment requires a
fresh fragment from the same source kind and preserves the comment body and identity. Whole-line
reattachment keeps its existing flow. Historical Git views remain inspection-only; multi-row
selection remains outside this slice.

Verification:

- Strict TypeScript across the five projects, formatting/CSS gates, and the full test suite pass
  (156 tests, 1,729 assertions across 25 files).
  [Selection invariants](../src/client/selection-feedback.test.ts) cover repeated text, exact
  whitespace, surrogate boundaries, invalid records, legacy migration, exports, late check/copy
  identity and Undo. [File transaction tests](../src/client/file-feedback.test.ts) also hold a read
  or clipboard write while reattaching a fragment to another occurrence on the same source line.
- `qa:selected-feedback` passes at 320, 390, 820, 1180 and 1440 px. It checks native Range offsets
  across tokens, leading/trailing spaces, Unicode, long wrapped fragments, keyboard-focus collapse,
  save/reload, preview, granted Chrome Clipboard API, history/Undo, stale focused actions, selection
  reattachment, Search file identity, UI backup export/import, Old/New diff sources, and exclusion
  of the synthetic no-newline annotation. Existing selected Search/scrolling/cross-row rejection,
  all nine feedback transaction regressions, U03 file feedback including plain/unchanged Git
  folders, and PWA/backup checks also pass.
- `qa:capture` produced and all twelve images were inspected: combined action at
  [phone](../qa/screenshots/usability-selected-actions/mobile.png),
  [tablet portrait](../qa/screenshots/usability-selected-actions/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-selected-actions/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-selected-actions/desktop.png); editor at
  [phone](../qa/screenshots/usability-selected-editor/mobile.png),
  [tablet portrait](../qa/screenshots/usability-selected-editor/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-selected-editor/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-selected-editor/desktop.png); preview at
  [phone](../qa/screenshots/usability-selected-preview/mobile.png),
  [tablet portrait](../qa/screenshots/usability-selected-preview/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-selected-preview/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-selected-preview/desktop.png). All manifests report no
  page-wide horizontal overflow; the preview includes a clearly excluded outdated fragment.

The maintained app serves rebuilt assets. Both backends and the private HTTPS origin were checked
for availability and matching assets. QA used isolated fixture ports and only its own servers were
stopped. Browser checks use Chrome emulation; clipboard copy uses the real granted API on loopback,
while transaction race checks control promises. Native selection menus/handles, installed-PWA safe
areas, keyboard and microphone behavior have not been newly verified on physical Android/iOS
hardware. The implementation remains uncommitted for maintainer review.

## Joined control borders — 2026-10-05

The maintainer's review found rounded inner corners and doubled edges where the textarea meets its
voice footer and where Search meets Comment. The editor now gives the textarea/voice group one outer
border and one continuous focus outline, with a single straight divider above the voice footer. The
textarea label remains explicitly associated with its input; resizing and keyboard focus on the
microphone keep the group connected. The voice footer retains its original text weight.

Selection buttons round only the outer corners of the group, including hover backgrounds. Their
shared divider is straight and drawn once. A single available action receives all four outer
corners. Each button retains its keyboard focus indicator and touch target.

Strict TypeScript, formatting and CSS gates pass. `qa:selected-feedback` passes at 320 px and all
four standard viewports; `qa:voice` passes its caret, retry, cancellation, automatic-send and editor
dismissal flows with mocked recording/transcription. Temporary Chrome layout checks cover both light
and dark themes at 320, 390, 820, 1180 and 1440 px, including hover/focus, the textarea label,
Tab/Enter between selection buttons, resizing, single-action corners and no page-wide overflow.
Physical-device checks were not repeated for this visual correction.

All sixteen final `qa:capture` images were inspected, with no page-wide horizontal overflow:

| State                  | Phone                                                              | Tablet portrait                                                             | Tablet landscape                                                             | Desktop                                                             |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Light selection action | [View](../qa/screenshots/joined-controls-light-actions/mobile.png) | [View](../qa/screenshots/joined-controls-light-actions/tablet-portrait.png) | [View](../qa/screenshots/joined-controls-light-actions/tablet-landscape.png) | [View](../qa/screenshots/joined-controls-light-actions/desktop.png) |
| Dark selection action  | [View](../qa/screenshots/joined-controls-dark-actions/mobile.png)  | [View](../qa/screenshots/joined-controls-dark-actions/tablet-portrait.png)  | [View](../qa/screenshots/joined-controls-dark-actions/tablet-landscape.png)  | [View](../qa/screenshots/joined-controls-dark-actions/desktop.png)  |
| Light comment editor   | [View](../qa/screenshots/joined-controls-light-editor/mobile.png)  | [View](../qa/screenshots/joined-controls-light-editor/tablet-portrait.png)  | [View](../qa/screenshots/joined-controls-light-editor/tablet-landscape.png)  | [View](../qa/screenshots/joined-controls-light-editor/desktop.png)  |
| Dark comment editor    | [View](../qa/screenshots/joined-controls-dark-editor/mobile.png)   | [View](../qa/screenshots/joined-controls-dark-editor/tablet-portrait.png)   | [View](../qa/screenshots/joined-controls-dark-editor/tablet-landscape.png)   | [View](../qa/screenshots/joined-controls-dark-editor/desktop.png)   |

The maintained HTTP/HTTPS backends and private HTTPS origin serve assets matching the rebuilt
client. Only the isolated QA server started for this correction was stopped. The maintainer accepted
the correction and selection extension on 2026-10-05 and explicitly requested their commit and
continuation with the plan.
