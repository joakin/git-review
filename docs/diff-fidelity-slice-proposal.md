# Diff fidelity: changed words across edit chunks

Status: implemented, reviewed by the maintainer, and committed. Word-level detail is live in the text-diff code; moved-block detection remains optional later work.

## Job and user flow

1. Open any staged or unstaged text change card. The existing old/new rows, line numbers, syntax colors, wrapping, and comment buttons remain. Where old and new lines correspond, a stronger inline treatment shows the changed words and punctuation. This also works when a contiguous edit replaces **several lines**, or inserts a line among edited lines.
2. Unpaired added or removed lines keep their ordinary full-row diff color. If the correspondence is ambiguous, the app leaves those rows alone rather than highlighting a misleading set of words.
3. Code selection for Search, line comments, file collapse, and wrapping work as before. Inline marks do not add gutter width, row padding, or page-wide overflow on a phone. Theme colors remain entirely in frontend CSS.

The implemented checkpoint is **word-level detail across bounded multi-line edit chunks**. Moved-block detection is optional later work, after the word view is useful and reviewed.

## Git's built-in option and the recommendation

Git does offer `--word-diff=porcelain`, a format intended for scripts. It emits common/added/removed **word runs** and represents source newlines as separate `~` records. Git says it computes those changes within the ordinary line-diff hunks. This is a real built-in option; the previous proposal understated it. [Git diff documentation](https://git-scm.com/docs/git-diff)

The difficulty is mapping that second output back to the exact source rows already used by this app. A local fixture with a changed first line, an inserted middle line, and a changed last line showed Git matching a shared semicolon across line boundaries in its porcelain stream. The ordinary patch still had the expected old/new line rows. The porcelain stream therefore cannot simply be parsed as one record per source line and attached to our `DiffLine` objects. A reconciliation parser could do it, but it would need to reconstruct and verify both source sides and handle line-boundary shifts and whitespace behavior. Git also documents that unmatched text around a custom word regex is ignored for matching, which requires care if we tune tokenization for code. [Git word-diff options](https://git-scm.com/docs/git-diff)

**Recommendation:** keep Git's ordinary patch as the source of line identity, then calculate bounded word spans in TypeScript from its already parsed old/new rows. This is a small local comparison step, not a replacement for Git's file or line diff. It avoids another Git call and a second output format that must be reconciled with comment anchors. No new dependency is needed. We can compare representative output against Git's porcelain mode during development, but the user's visible source text and line numbers still come from the ordinary patch.

## Data and API shape

Keep the existing diff endpoint and text response. Add a required discriminated detail to each `DiffLine`:

```ts
type TextSpan = { start: number; end: number };
type DiffDetail =
  | { kind: "none" }
  | { kind: "word_change"; spans: TextSpan[] };
```

Offsets are half-open UTF-16 positions in `DiffLine.text`, matching JavaScript string slicing. Spans are sorted, nonempty, nonoverlapping, within the line, and do not split surrogate pairs. `none` is explicit for context, unpaired additions/deletions, and rows whose analysis is skipped. The client validates bounds and a per-line span cap before rendering. The browser splits existing syntax tokens at those offsets while preserving the exact concatenated source text, syntax role, and native text selection. The server sends no style or theme values.

For each contiguous edit chunk in a hunk, collect its removed and added rows. Align old and new rows **in order** using their code tokens, allowing insertions and deletions. For a multi-line chunk, a pair needs at least half its non-whitespace token-character weight in common and must be the unique strongest match for both rows; a one-old/one-new chunk can be paired directly. Then compare tokens within every accepted line pair and mark the differing ranges on both sides. This two-level alignment allows several neighboring edited lines and unequal old/new line counts without claiming that a shifted block was moved. Tokenization includes identifiers, numbers, punctuation, and whitespace so a whitespace-only change can be marked; line breaks remain alignment boundaries.

Bound the row-alignment work per chunk and the token-comparison work per line. The implementation caps each side at 256 rows, each line at 4,096 UTF-16 units and 512 comparison units, and each chunk at 65,536 candidate row pairs. It also applies per-response row-pair and token-comparison budgets. A larger or ambiguous chunk safely keeps the ordinary diff; it never delays the whole card. Pure additions, including untracked files, have no old content to compare and keep their current row styling.

[withWordDetails](../src/server/diff-words.ts) accepts and returns the canonical text-diff variant. It updates detail fields on parsed rows, so its return contract allows those fields to change rather than preserving a narrower `none` refinement. [M08c](maintenance-plan.md#m08c--parser-and-decorator-contracts) records this contract; the matching algorithm and budgets are unchanged.

## Visual and interaction rules

- Changed spans use CSS design tokens for a stronger added/removed background and a subtle underline or edge that remains legible alongside syntax color. They add no row padding or minimum height. Selection highlight stays visible over the decoration.
- Markup inside `<code>` contains only the original source characters. Decorations are CSS on spans; they must not insert labels into selectable code or alter copied source text.
- The sign and line-number gutters stay sticky while the code cell scrolls horizontally. With wrapping on, words can wrap normally and retain their detail background. Narrow phone width is the primary visual check.
- If line alignment is skipped, there is no warning badge: the ordinary added/removed rows already convey the change and remain usable.

## Edge cases and acceptance checks

- Test a multi-line replacement with a middle insertion, a middle deletion, several nearby one-word edits, and an equal-sized run with repeated or weakly similar lines. Only strongly paired rows get spans; the rest retain full-row color. No line number or comment side changes.
- Test identifiers, punctuation, whitespace-only edits, tabs, repeated words, Unicode and surrogate pairs, and a very long line or chunk that safely falls back. Every decorated row must reconstruct its original text after syntax-token splitting.
- Reject API spans that are out of order, out of bounds, over the cap, or inside a surrogate pair. Preserve the existing patch size and line-count limits.
- Run type checking and focused behavior tests. Exercise comment anchoring and selected-code Search on decorated rows. Capture and inspect phone, tablet portrait, tablet landscape, and desktop with wrapping on and off, including a horizontally scrolled code pane. Confirm no page-wide overflow, no wider gutter, and clear selection contrast. Real phone checks remain useful for selection handles and touch comments.

## Later, optional moved-code work

If word detail performs well and moved-code cues still seem useful, we can separately propose exact multi-line move detection within one file and layer. It should not be a dependency of this slice. A weak or edited match should remain an ordinary add/delete. Git's `--color-moved` is a terminal color feature with several matching modes, including single-line and greedy block modes; we can revisit whether any of them help with semantic pairing at that time. [Git moved-line options](https://git-scm.com/docs/git-diff)

## Review evidence and decision

`bun run typecheck`, `bun test` (33 tests), and `bun run qa:check` pass. Browser checks passed for mobile diff wrapping, horizontal scrolling, selected-code Search across a decorated line, and line comments with feedback copy. The [wrapped review screenshots](../qa/screenshots/word-detail-review/mobile.png) and [horizontally scrolled screenshots](../qa/screenshots/word-detail-scroll/mobile.png) each include phone, tablet portrait, tablet landscape, and desktop captures; all four views were inspected and showed no page-wide overflow. The private HTTPS backend on port 8443 was restarted and returned five decorated rows for the multi-line fixture. Browser emulation does not verify real-device selection handles or touch behavior.

The maintainer reviewed the rendering and code, confirmed the word detail looks good, and approved the commit. Further matching changes should be driven by concrete examples that can be paired without misleading highlights. Moved-code indicators stay deferred.
