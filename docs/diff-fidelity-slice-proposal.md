# Diff fidelity: changed words across edit chunks

Word detail marks changed identifiers, punctuation and whitespace within corresponding Old/New rows,
including replacements across several lines and insertions or deletions inside an edit chunk.
Unpaired, ambiguous or oversized rows retain ordinary full-row colors without a warning badge. Line
numbers, comment sides, source text and copied code remain unchanged. Moved-code detection is
outside the current scope.

## Why ordinary patches own line identity

Git's word-diff porcelain is a second word-run format whose matches can cross source line
boundaries. Reconciling it with the ordinary patch would require reconstructing both source sides
and verifying whitespace and shifted boundaries against comment anchors.

The app instead derives bounded spans from already parsed ordinary patch rows. Git remains the owner
of file/line differences, while local word comparison adds detail without another command or a
second source-identity format.

## Pairing and span contract

Removed and added rows within each contiguous edit chunk are aligned in order, permitting unequal
row counts. Strong, mutually unique row matches anchor the alignment. A single Old/New replacement
between those anchors or a chunk edge can be compared directly, including a heavily rewritten row.
Larger weak or repeated-line gaps remain unpaired.

Consecutive corresponding rows compare identifiers, numbers, punctuation and whitespace together.
Shared line prefixes, such as indentation and comment leaders, stay outside this comparison; line
breaks act as spaces so reflowed words are not marked as additions or deletions. Matching
prioritizes source content over whitespace, and changed phrases include the spaces between changed
words. Insertions, deletions and ambiguous gaps separate comparison groups. Large groups fall back
to bounded per-row comparison. This does not infer that a shifted block moved, and Git still owns
every source row and comment anchor.

Spans are sorted, nonempty, nonoverlapping half-open UTF-16 offsets inside the original line and
cannot split surrogate pairs. Context and skipped/unpaired rows have explicit no-detail state.
[diff-words.ts](../apps/agent/src/diff-words.ts) owns the matching algorithm and per-chunk, per-line
and per-response work budgets; [shared/api.ts](../packages/shared/src/api.ts) defines and validates
the wire contract.

The browser splits syntax tokens at span boundaries while preserving exact concatenated text and
roles. [diff-detail.ts](../apps/web/src/diff-detail.ts) owns that decoration. CSS supplies the
stronger added/removed treatment without adding characters, gutters, row padding or minimum height.
Selection stays visible over marks, wrapping retains them and horizontal scrolling keeps gutters
visible. [Syntax](syntax-highlighting-slice.md) and [diff layout](diff-slice.md) retain their own
contracts.

## Verification

[Diff-constructor tests](../apps/agent/src/diff-content.test.ts) and
[decoration tests](../apps/web/src/diff-detail.test.ts) cover middle insertions/deletions, clear and
ambiguous pairs, rewritten comments, reflow in either direction, punctuation, whitespace, tabs,
repeated words, Unicode/surrogates and safe large-input fallback. Response validation rejects
out-of-order, out-of-bounds or excessive spans. Decorated rows must reconstruct their source
exactly.

Browser checks exercised wrapping, scrolling, selected-code Search and line-comment feedback on
decorated rows. The [wrapped](../qa/screenshots/word-detail-review/mobile.png) and
[scrolled](../qa/screenshots/word-detail-scroll/mobile.png) milestone sets were inspected at phone,
both tablet orientations and desktop sizes without page-wide overflow. Native device selection
handles and touch behavior remain unverified.

The 2026-10-16 reflow correction reproduces a rewritten comment whose final word wraps onto the next
source row. The [phone](../qa/screenshots/word-reflow-fix/mobile.png),
[tablet portrait](../qa/screenshots/word-reflow-fix/tablet-portrait.png),
[tablet landscape](../qa/screenshots/word-reflow-fix/tablet-landscape.png), and
[desktop](../qa/screenshots/word-reflow-fix/desktop.png) captures show the rewritten phrases marked
while the reflowed word remains unmarked. Browser checks at those sizes verified exact source text,
selection across decorations, Old/New selection-comment anchors, emulated touch actions, wrapping
and scrolling without page-wide overflow. Physical iOS/Android selection and touch remain
unverified. Further matching changes should be driven by concrete examples that can be paired
without misleading highlights.
