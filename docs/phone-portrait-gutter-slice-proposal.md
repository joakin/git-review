# Phone diff line action without gutters

Status: implemented, pending maintainer review and real-device gesture check.

## Job and user flow

The phone diff currently reserves about 104 px for the change sign and two line-number columns before code begins. At narrow widths, hide all three columns in both wrap modes. Keep row backgrounds for added and removed lines. Wider screens retain the visible gutter and direct old/new comment buttons, while row click reveals the same line action at every viewport size.

1. A short tap on a code row opens a floating line action near that row. It shows the change sign for added or removed lines, the available old and new line numbers, a separator, and **Comment**. A context row shows both numbers without a change sign. The entire action is one button; tapping anywhere on it opens the comment editor.
2. The action uses the existing comment anchor: added lines use New, removed lines use Old, and context lines default to New. An existing old-side draft being reattached to a context line keeps its Old side. The editor and exported feedback continue to show the exact side and line number.
3. A long press, text drag, or double tap that selects code keeps the native selection behavior and the existing Search action. A noncollapsed selection dismisses the line action. A short tap must not clear an existing text selection or launch a comment through a selection gesture.
4. The line action closes on an outside tap, wrap toggle, file collapse, view change, comment editor opening, Escape, or when its row leaves the viewport. It follows its row during scrolling, including the browser's final scroll adjustment after a tap. It opens above or below the row as space permits and avoids the sticky file heading and floating Feedback button. The selected-text Search action continues to track its selection separately.

This gives code the full width previously reserved for the gutter. The code still starts at one consistent position across rows. Added/removed backgrounds and word highlights stay aligned during horizontal scrolling.

### What Old and New mean

Old and New are relative to each diff card, not fixed synonyms for historical and on-disk content:

| Card | Old | New |
| --- | --- | --- |
| Staged | `HEAD` | Git index |
| Unstaged | Git index | Working tree (on disk) |
| Untracked | Empty file | Working tree (on disk) |

The existing copied feedback groups comments by `[staged]`, `[unstaged]`, or `[untracked]`, then writes `old line N` or `new line N`, the source text, and the comment. It does not spell out `HEAD`, index, or working tree. A file with both staged and unstaged changes can appear in two separate groups. The maintainer chose New for unchanged context lines in every layer, including Staged, where New means the index. The unchanged text is identical on both sides of that card, though its line number can differ.

## Client data and implementation shape

- No server route, diff response, comment-store version, or feedback-export format changes. `DiffLine.kind`, `oldLine`, and `newLine` provide the tooltip labels; `anchorForLine` still creates the comment anchor.
- Keep one transient client state for the currently tapped diff row and its position. Do not persist it. The button has one accessible name that includes change kind, available line numbers, and Comment.
- At narrow widths, remove the sign and number columns from layout. Preserve a focusable, visibly outlined keyboard path to the line action without giving the gutter any width. On wider layouts, retain the current direct old/new line controls and also reveal the action when code is clicked.
- Coordinate the line action with `CodeSelectionSearch`: only a completed short tap with no selected text opens it. Do not cancel the browser's pointer-down behavior on code. Selection and scrolling take precedence. Avoid overlapping the Search and line actions.
- Use client design tokens for the action's colors and spacing. Clamp its position to the visual viewport so it remains reachable with browser chrome and the on-screen keyboard present.

## Edge cases and QA

- The single Comment action can choose only one side on a context row. The proposed default is **New**. This means a new Old-side comment on unchanged context code has no touch path in this slice; removed lines still use Old, and an old-side draft can still be reattached to context. Do not add a side picker later in the editor without discussing it.
- Show only available numbers on added and removed rows. Handle large line numbers and lines with multiple existing comments without clipping; existing comment counts remain available in the feedback list and can appear in the tapped line action.
- Check short tap, slow tap, long press, double tap, selection drag, vertical swipe, and horizontal code scroll on phone. Verify that Search appears for selected text and Comment for a plain line tap, never both. Verify the exact side and line number after saving and copying feedback.
- Check 320 px and 390 px phones, tablet portrait and landscape, and desktop; wrap on/off; short and long code lines; sticky file headings; no page-wide overflow. Capture the standard four QA screenshots. Browser emulation is an early check; verify selection gestures and tapping on real Android/iOS devices.

## Smallest useful slice and review decision

Implement the phone-only gutter removal and one tap-or-click-to-reveal line action across all sizes together. Keep desktop and tablet gutters and their direct number controls. Do not add a persistent display setting or change comment storage.

The maintainer accepted New for unchanged context lines in all layers, including the staged-card index side.
