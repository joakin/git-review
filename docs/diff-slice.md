# Expandable diff cards

Changes is a continuous list of cards in Git layer order. Cards restore saved open choices and
otherwise start collapsed. Selecting a file in the contextual list changes its URL, expands the card
and focuses it once. Later toggles and Refresh do not repeat route focus. Expanded cards load on
demand and render an accepted cached result immediately.

Wrap switches between wrapped lines and one horizontal scroll surface for all hunks in a file. Short
rows stay compact; wrapped rows grow with content. Signs, line-number gutters and hunk labels remain
visible at the left edge while code scrolls, and the page stays within the viewport. Phone row
actions and comment sides belong to the
[line-action record](phone-portrait-gutter-slice-proposal.md).

Empty and whitespace-only source lines retain the height of a normal single-line row, including
vertical padding, in Changes, historical diffs and Files. The shared code style reserves that height
from the current typography without inserting placeholder characters into source text. Hidden phone
gutters therefore cannot collapse an empty diff row.

[Line counts](changes-line-counts-proposal.md) own count and section-heading presentation;
[bulk controls](diff-batching-and-bulk-controls-proposal.md) own Expand all / Collapse all.
[Syntax](syntax-highlighting-slice.md), [word detail](diff-fidelity-slice-proposal.md),
[feedback](feedback-slice-proposal.md) and [media](media-preview-slice-proposal.md) each retain
their domain rules. [Loading](loading-and-transition-polish.md) owns cache-first rendering and
reading-position restoration. Open choices and wrapping survive reload; fetched diff payloads do
not.

## Revealing unchanged context

Supported text cards in Changes show a separator for each omitted unchanged interval. The
bar-and-arrow buttons reveal up to twenty lines per click: **Up** takes code immediately above the
following block, and **Down** takes code immediately below the preceding block. Internal gaps offer
both directions; file-edge gaps offer the one useful direction. The count decreases as either end
expands. Exhausting an interval removes its separator and joins the code without duplicate rows.

The original Git hunks remain canonical. Revealed rows form a separate display projection with exact
Old/New coordinates, complete-source syntax highlighting and ordinary line/selection actions.
Existing anchors retain their original hunk neighbors;
[feedback](feedback-slice-proposal.md#anchor-identity-and-checking) owns source-neighbor checking
for newly revealed code.

Loading and read errors stay beside the affected separator while visible code remains usable. Retry
repeats the failed direction. A stale source offers the existing **New edits · Update** flow. The
buttons stay visible during horizontal code scrolling, retain keyboard focus, and provide phone-size
touch targets. Accepted insertions preserve a visible source row's position; when the last insertion
removes the focused separator, focus moves to a visible line action.

Expansion lives in bounded tab memory for the exact project, layer, path and snapshot. Collapse and
reopen preserve it; Update, Refresh and page reload reset it. Wrapping and theme changes preserve
it. Changing language redecorates the same ranges; a failed replay retains plain source text and
pauses further expansion until Retry succeeds. Canceled or superseded requests cannot update another
view.

Metadata derives from checked HEAD/index/working-tree sources and canonical hunks. Each expansion
revalidates the gap, source digest and both snapshot tokens around the read; requests supply no Git
expression or rename origin. The [shared context contract](../src/shared/diff-context.ts) owns wire
validation and budgets. Sources outside the bounded read capability show an explanation while
keeping the ordinary patch usable. Added/deleted/untracked one-sided content, non-text/unsupported
states, empty diffs and historical Git inspection have no expansion controls. Whole-file expansion,
re-collapsing gaps and historical expansion remain follow-ups.

## Sources and freshness

| Layer     | Old side | New side     |
| --------- | -------- | ------------ |
| Staged    | HEAD     | Index        |
| Unstaged  | Index    | Working tree |
| Untracked | Empty    | Working tree |

Before the first commit, staged additions compare against an empty old tree. Layer and path identify
a card, so two layers of one file cannot share content or anchors. Rename origins come from Git and
may leave the selected subfolder; only origins within the approved root can enter a working-copy
comparison.

[Working-copy orchestration](../src/server/git-diff.ts) selects and reads the comparison sources.
The pure [diff constructors](../src/server/diff-content.ts) build patches and bounded one-sided
content for working and historical reads. [Shared Git reads](git-read-boundaries.md) and
[checked working files](working-file-boundaries.md) own safe access. Hunk counts, prefixes and line
numbers must agree; source text, CRLF and missing final newlines remain exact. Empty and mode-only
changes retain meaningful metadata. Binary files, links, submodules, conflicts and oversized content
have explicit states.

Cards and individual fallback use the complete current snapshot required by the
[batch contract](diff-batching-and-bulk-controls-proposal.md), including its before/after read
checks. Stale results offer **New edits · Update** without automatically replacing the review or
starting refresh loops. The [live-update record](live-change-detection-slice-proposal.md) owns
recovery.

[shared/api.ts](../src/shared/api.ts) defines the diff result and validates unknown responses,
including hunk/line consistency and decoration reconstruction. The shared renderer supports
working-copy review with comments and [historical inspection](git-history-slice-proposal.md) without
comments; request and cache identities remain with each source.

The
[long-code performance record](long-diff-performance-investigation.md#agreed-implementation-approach)
owns code-render isolation, bounded browser rendering containment and measured-size lifetime for
Changes, historical diffs and Files.

## Verification

[Diff-constructor tests](../src/server/diff-content.test.ts),
[working-copy tests](../src/server/git-diff.test.ts), and [API tests](../src/server/api.test.ts)
cover separate layers, renames, deletions, unusual names, exact anchors, binary/links, unborn
repositories, limits, malformed hunks and stale requests. [Diff browser QA](../qa/check-diff.ts)
exercises navigation, persistence, wrapping, sticky gutters and contained scrolling.
[Blank-line browser QA](../qa/check-blank-lines.ts) checks empty and whitespace-only row heights,
exact source text, CRLF display and typography across the four viewport profiles and wrapping modes.

[Context tests](../src/server/diff-context.test.ts) cover exact gaps, side offsets, zero-count
coordinates, CRLF/final-newline handling, mixed expansion and exhaustion, limits, stale sources and
malformed input. [Client context tests](../src/client/diff-context.test.ts) cover display ownership,
source-side anchors and bounded checking. [Context browser QA](../qa/check-diff-context.ts)
exercises expansion, retry, language replay, cancellation, reading position/focus, reload feedback
and contained scrolling at the four standard sizes plus a narrow phone. The
[context milestone](../qa/screenshots/diff-context-controls/mobile.png) was captured and inspected
at all four standard sizes. Physical-device gestures remain unverified.

A local 581,780-byte, 4,000-line source with twenty changed hunks was measured with seven warm
samples per operation. Median initial reads were 13.7 ms without context metadata and 21.7 ms with
it in Plain text; TypeScript reads were 2.67 s and 2.66 s respectively. Twenty-line expansion,
including inventory and before/after freshness checks, took 39.3 ms in Plain text and 1.36 s with
TypeScript. Full-source highlighting dominates these local timings; they exclude network and browser
costs and do not establish physical-phone performance. Per-operation source reuse avoids duplicate
reads without a persistent source cache.

The [diff](../qa/screenshots/blank-lines-diff/mobile.png) and
[Files](../qa/screenshots/blank-lines-files/mobile.png) blank-line milestone sets were inspected at
phone, both tablet orientations and desktop sizes. Real-device rendering remains unverified.

The [wrapped](../qa/screenshots/diff-marker-left-wrap/mobile.png),
[scrolled](../qa/screenshots/diff-marker-left-scroll/mobile.png) and
[collapsed-heading tap](../qa/screenshots/diff-header-tap-collapsed/mobile.png) milestone sets were
inspected at phone, both tablet orientations and desktop sizes. Real-device touch remains
unverified.
