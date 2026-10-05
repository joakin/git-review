# Selected code text → Search

Status: implemented and committed as part of `da9ba46`. The server-side working-tree Search was
already implemented; this adds the entry point from code. The maintainer confirmed the action works
on their phone. Additional iOS selection checks remain unverified
[optional future work](initial-implementation-plan.md#remaining-roadmap).

## User flow and smallest checkpoint

1. In a diff or Files view, hold a word and let the browser select it. A mouse or keyboard selection
   can use the same action. Do not replace native selection handles, Copy, or the gutter's comment
   buttons.
2. When a valid selection is inside **one code line**, show a compact **Search selected text**
   tooltip next to it, with a short preview. The
   [selection-feedback extension](selected-code-feedback-proposal.md), accepted on 2026-10-05, adds
   Comment alongside Search. On touch screens, place it below the selected text to avoid Android's
   native selection menu above the text; on mouse-driven screens, prefer above. Keep it outside the
   code pane's clipping and horizontal scroll container. Deselecting or pressing Escape dismisses
   it.
3. Tapping the action opens the existing Search tab, fills its query, submits one bounded literal
   search, and shows the results. The query stays editable. A result still opens the current
   working-tree file at the matching line.

The selected text uses the case-sensitive, fixed-string Search API. It does not silently expand to a
whole identifier or add whole-word matching. Submitted queries and selected result files now have
URLs through the [navigation model](navigation-and-url-history-slice-proposal.md), so browser Back
returns to earlier destinations.

## Data and implementation boundary

- No new server endpoint or query shape. Reuse `GET /api/projects/:id/search?query=...` and its
  current 1–128 character, single-line validation.
- Add one client-side selection reader shared by diff and file code. It inspects the browser
  `Selection`/`Range`, accepts a non-collapsed range whose start and end belong to the same
  `.diff-code` or `.file-code-line`, and retains the exact Range and registered source snapshot.
  Search submits only the trimmed selected string; Comment preserves exact fragment offsets and
  whitespace. Syntax-highlight spans within that code element may be crossed; selection across two
  code rows, a line number, page text, or a dialog is ignored.
- Treat selection as ephemeral UI state. Clear it on project change, code replacement, Search
  submission, and dismissal. Do not save it in browser storage or send the source line/path to
  Search.
- Anchor the tooltip to the selected `Range` geometry. Recompute its position on selection changes,
  page scroll, nested code-pane scroll, resize, visual-viewport movement, and code wrapping;
  coalesce updates with `requestAnimationFrame`. Clamp it within the visible viewport. On a touch
  screen, prefer below the selection; if there is no room below, show a compact action just under
  the sticky app header, away from the native menu. On a mouse-driven screen, prefer above and flip
  below when needed. Hide the action when the selected code is scrolled out of view.
  [MDN Range geometry](https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect),
  [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- Capture the validated text before the action is tapped because focus changes may collapse the
  native selection. Keep the tooltip outside the code's horizontal scroll container and avoid a
  global `touch-action: none` rule.

## Edge cases and QA

- Selection may start in one syntax token and end in another, include whitespace, or include
  punctuation. Trim surrounding whitespace; reject empty, multiline, or overlong text with no Search
  action. A selected word in a removed diff line is still a working-tree search query, not a
  historical-file search.
- Selection handles and the browser's own menu may overlap the tooltip. Check that long press still
  allows copying, dragging handles, vertical scrolling, and horizontal code scrolling. Do not search
  just because a long press occurred; the user chooses the action. Hide the tooltip if the browser
  removes the selection or if it cannot be placed without covering the selected text.
- Search keeps the latest loaded result in tab memory; the URL owns the submitted query and selected
  result file. Starting a selected-code search navigates to that query. Back/Forward restores
  earlier Search URLs, rerunning queries whose results are no longer loaded.
- Browser QA should exercise a word split across syntax spans, wrapped and unwrapped code, one
  invalid cross-line selection, a diff line, a full-file line, nested horizontal scrolling, page
  scrolling, viewport resize, and dismissal. Capture phone, both tablet orientations, and desktop.
  Real Android Chrome and iOS Safari checks are required for the native selection interaction.

## Maintainer feedback

The maintainer first preferred a tooltip above the selection instead of a fixed corner action.
Android review found that the native Copy/Paste/Select All menu occupies that space. Touch placement
now prefers below the selection, with a header-adjacent fallback when there is no room below. The
maintainer confirmed this works on their phone. iOS selection controls still need a device check;
keep native selection and the explicit Search tap.

## Implemented behavior and checks

- A selection within one diff or Files code line shows a contextual Search button below it on touch
  screens, or above it on mouse-driven screens when space allows. The action follows page,
  code-pane, and visual-viewport scrolling and hides when the selection leaves the visible pane.
  Cross-line selections do not show it. Selecting syntax text across token spans works.
- Tapping the button fills and submits the existing literal Search query. The current Search tab and
  result-to-file behavior are reused; no server route, storage record, or dependency was added.
- `bun run typecheck`, `bun run qa:check`, 24 behavior tests,
  `bun run qa:selected-search http://127.0.0.1:39900/`, and the existing `qa:search` check passed.
  The selected-code browser check covers a phone diff and full file, page scrolling, horizontal
  code-pane scrolling, an invalid cross-line range, Search submission, result loading, and page
  width.
- [Revised tooltip screenshots](../qa/screenshots/selected-code-search-touch-placement/mobile.png)
  were captured and inspected at phone, tablet portrait, tablet landscape, and desktop sizes; the
  capture manifest reports no page-wide overflow. Phone and tablet emulation place the action below
  the selection; desktop keeps it above. Browser QA checks the header-adjacent fallback when there
  is no room below. Emulation does not verify actual Android/iOS selection-menu placement or gesture
  conflicts. The private HTTPS app serves the updated build on port 8443.
