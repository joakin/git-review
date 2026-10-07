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

[Line counts](changes-line-counts-proposal.md) own count and section-heading presentation;
[bulk controls](diff-batching-and-bulk-controls-proposal.md) own Expand all / Collapse all.
[Syntax](syntax-highlighting-slice.md), [word detail](diff-fidelity-slice-proposal.md),
[feedback](feedback-slice-proposal.md) and [media](media-preview-slice-proposal.md) each retain
their domain rules. [Loading](loading-and-transition-polish.md) owns cache-first rendering and
reading-position restoration. Open choices and wrapping survive reload; fetched diff payloads do
not.

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

[git-diff.ts](../src/server/git-diff.ts) owns source-correct patches and bounded one-sided content.
[Shared Git reads](git-read-boundaries.md) and [checked working files](working-file-boundaries.md)
own safe access. Hunk counts, prefixes and line numbers must agree; source text, CRLF and missing
final newlines remain exact. Empty and mode-only changes retain meaningful metadata. Binary files,
links, submodules, conflicts and oversized content have explicit states.

Cards and individual fallback use the complete current snapshot required by the
[batch contract](diff-batching-and-bulk-controls-proposal.md), including its before/after read
checks. Stale results offer **New edits · Update** without automatically replacing the review or
starting refresh loops. The [live-update record](live-change-detection-slice-proposal.md) owns
recovery.

[shared/api.ts](../src/shared/api.ts) defines the diff result and validates unknown responses,
including hunk/line consistency and decoration reconstruction. The shared renderer supports
working-copy review with comments and [historical inspection](git-history-slice-proposal.md) without
comments; request and cache identities remain with each source.

## Verification

[Git-diff tests](../src/server/git-diff.test.ts) and [API tests](../src/server/api.test.ts) cover
separate layers, renames, deletions, unusual names, exact anchors, binary/links, unborn
repositories, limits, malformed hunks and stale requests. [Diff browser QA](../qa/check-diff.ts)
exercises navigation, persistence, wrapping, sticky gutters and contained scrolling.

The [wrapped](../qa/screenshots/diff-marker-left-wrap/mobile.png),
[scrolled](../qa/screenshots/diff-marker-left-scroll/mobile.png) and
[collapsed-heading tap](../qa/screenshots/diff-header-tap-collapsed/mobile.png) milestone sets were
inspected at phone, both tablet orientations and desktop sizes. Real-device touch remains
unverified.
