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
row counts. Multi-line correspondence must be strong and uniquely best for both rows; a single
Old/New pair can be compared directly. Weak or repeated-line matches remain unpaired. Accepted pairs
compare identifiers, numbers, punctuation and whitespace; line breaks remain alignment boundaries.
This does not infer that a shifted block moved.

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
ambiguous pairs, punctuation, whitespace, tabs, repeated words, Unicode/surrogates and safe
large-input fallback. Response validation rejects out-of-order, out-of-bounds or excessive spans.
Decorated rows must reconstruct their source exactly.

Browser checks exercised wrapping, scrolling, selected-code Search and line-comment feedback on
decorated rows. The [wrapped](../qa/screenshots/word-detail-review/mobile.png) and
[scrolled](../qa/screenshots/word-detail-scroll/mobile.png) milestone sets were inspected at phone,
both tablet orientations and desktop sizes without page-wide overflow. Native device selection
handles and touch behavior remain unverified. Further matching changes should be driven by concrete
examples that can be paired without misleading highlights.
