# Multi-line selected-code feedback

Status: approach accepted on 2026-10-10; implementation in progress. The maintainer explicitly
authorized autonomous implementation, independent review, QA and committing after each stage,
followed by a cleanup pass.

Created: 2026-10-10

The maintainer requested an investigation after confirming that selected-code feedback currently
supports one logical line. The [Feedback record](feedback-slice-proposal.md) owns current behavior;
this proposal owns the pending extension. Once accepted and implemented, fold its contract and
verification into Feedback and the [local-data record](independent-tabs-and-pwa-proposal.md).

## Recommended user flow and smallest useful slice

1. Select code spanning consecutive source lines in Files, a Search result's file view, or a
   working-copy diff. Preserve native selection, handles and Copy behavior.
2. Offer **Comment** in the existing selection toolbar. Multi-line Search remains unavailable under
   the current [literal-query contract](search-slice-proposal.md#selected-code-search).
3. Open the existing editor with the path, source, line range and exact selected fragment
   highlighted inside the complete source lines. Saving produces one comment; dictation, editing and
   closing retain their existing behavior.
4. Show the range in Feedback and copied text. Include the comment in each covered line's marker,
   while the project/card draft total still counts it once.
5. Check every covered line before export. A mismatch in any saved line or its saved context makes
   the entire comment outdated. Reattach through a fresh selection, preserving the body and ID.

The proposed first slice supports partially selected first/last lines, complete intervening lines,
blank intervening lines, wrapping and syntax-token boundaries. A diff range must belong to one path,
Git layer and Old/New side, with consecutive source numbers and every included row displayed. Mixed
Old/New selections retain both sides as separate source parts under one comment. Revealed context
can participate when these conditions hold; render-block and context-chunk wrappers are not source
boundaries.

For a diff selection, choose a side available for every selected row: added/context ranges use New,
removed/context ranges use Old, and context-only ranges default to New or retain Old during Old
reattachment. A selection containing both added and removed rows saves an Old range and a New range,
including selected context on both sides. Export quotes each source part before the shared comment
body, and both parts must pass checking. Cross-file/card/layer selections and selections spanning
hidden context also cannot. Explain an unsupported code range through the selection action's
existing placement, without repeating global notices on every native selection update.

Historical Git inspection, whole-file/project notes and automatic relocation remain outside this
slice. Keyboard users can select code and invoke the same action; separate gutter-based range
picking is further work.

## What the current code can reuse

| Area                                                                                                                          | Existing foundation                                                                                    | Required extension                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [Selection registration](../src/client/code-selection.tsx)                                                                    | Exact source text, rendered anchors and source-change invalidation                                     | Resolve all intersected source rows, endpoint offsets, a common source/side and the whole captured snapshot |
| [Selection actions](../src/client/CodeSelectionActions.tsx)                                                                   | Native-selection priority, focus retention and viewport placement                                      | Carry a range, compare complete range identity and place unsupported-range explanations                     |
| [Comment model](../src/client/comments.ts)                                                                                    | Line/fragment validation, deterministic export and transaction identity                                | A bounded range variant, range helpers and deep snapshots of its nested data                                |
| [Shared check boundary](../src/shared/feedback-check.ts) and [server checker](../src/server/feedback-check.ts)                | Deduplication, grouped source reads, canonical patch matching, bounded fallback and mutation detection | Parse range items, deduplicate their component line anchors and return an all-or-nothing result per item    |
| [Feedback transactions](../src/client/feedback-transactions.ts)                                                               | One source-check batch, cancellation, exact archival and Undo                                          | Include every component anchor in identity and retain one comment per checked range                         |
| [Dialogs](../src/client/ReviewDialogs.tsx), [Files](../src/client/FileViewer.tsx) and [diff rows](../src/client/DiffBody.tsx) | Shared editor, source quote, markers and reattachment                                                  | Range labels/highlights, covered-line counts and source-kind helpers                                        |
| [Local data](../src/client/backup.ts)                                                                                         | Validated stores, backups and exact copied history                                                     | A deliberate current-to-new format conversion and range validation                                          |

No comment-writing server endpoint is needed. Bodies and history remain in the browser; checking
continues to send only source anchors. Source reads remain confined and read-only.

## Proposed data and API shape

Represent a range explicitly rather than adding an optional end line to an ordinary anchor. The
recommended first implementation stores an ordered, bounded collection of the existing line anchors,
coupled to one selection subject. Each component must identify the same source, path, layer/side
where applicable, and the next consecutive source number. Existing line and single-line selection
targets remain distinct validated variants.

The selected fragment uses UTF-16 positions in the joined full source lines, with a logical newline
between source rows. Validate exact sliced text, endpoint placement and surrogate-pair boundaries.
Build that text from registered source rows, never from the entire DOM Range string: DOM traversal
can include line controls, diff signs, headings and the synthetic no-newline annotation. Preserve
Files' current CRLF normalization and diffs' exact source-text semantics.

This representation deliberately reuses each line's existing context semantics. Ordinary diff
anchors have neighbors from adjacent displayed patch rows; revealed-context anchors have actual
source-side neighbors. Do not reinterpret a patch-edge null as proof of a file boundary. The
existing canonical patch matcher and source fallback already handle these distinct anchors.

Extend the existing check request to accept a line anchor or a range anchor containing one source
part or an Old/New pair as one item. The server flattens and deduplicates component line anchors
within the same check operation, shares its current inventories and source reads, and returns one
boolean per original item. A range is current only when all its components match. Keep the existing
batch-level stale/error response and cancellation policy. Do not split a large range across separate
check requests with different freshness windows.

The current item limit is also used as the draft limit. Separate comment capacity from the bounded
number of internal line checks so a range does not silently consume several comment slots. Bound
lines and total saved text per range, total expanded check work per request, and request bytes.
Choose and test the concrete limits in source before enabling range creation; large selections need
an actionable limit message. Preserve the current source-read/time budgets and grouped-read
performance invariants.

A compact range anchor containing source identity, full lines and only boundary context would use
less storage. It would also need new checking rules because true outer neighbors are not always
available in an ordinary rendered hunk. Reusing line anchors keeps the first implementation closer
to the existing validated behavior. Its cost is duplicated neighbor text, which the range and byte
bounds must account for.

## Edge cases and presentation decisions

- Normalize native endpoint containers through source/token traversal, including backward selections
  and element boundaries. A selection ending at the start of the next row should end on the
  preceding source line so an untouched row gains no marker. This deliberately normalizes the
  trailing structural separator; selected spaces/tabs and interior blank lines remain exact.
- Reject whitespace-only selections, unavailable anchors and synthetic annotations. Every interior
  source row must be accounted for, even when it has no text node. Gutters and decorative headings
  never contribute quoted source text.
- Resolve both diff-side anchors for context rows. The current registry holds only the preferred
  side, so merely joining its current anchors would reject valid removed/context ranges.
- Scope registration to the pane's rendered snapshot, including context expansion. Validate every
  captured row again on invocation. Refresh, source replacement, collapse, navigation or removal of
  an interior row invalidates the action even if the endpoint text still matches.
- Treat single-line fragments and multi-line fragments as one selection family for reattachment:
  either may become the other through an explicit fresh selection from the same source kind.
  Whole-line comments still require the existing line flow; Old context reattachment retains Old.
- Label editor and Feedback with source and start/end lines. Export the line range, quoted source
  and exact selected text with unambiguous endpoint columns. Existing single-line output stays
  stable; archived copied text is never regenerated.
- Keep long source quotes scrollable within the dialog so a range cannot push the composer or
  closing controls beyond reach on a phone. Retain touch targets, native selection priority and
  viewport movement behavior.

## Existing drafts and backups

Recommend preserving all currently valid drafts, IDs, bodies, timestamps and history through a
scoped conversion of today's comment store and backup formats to the range-capable formats. Copied
history text remains byte-for-byte unchanged. Invalid records still fail validation; failed
persistence must preserve recoverable current data and report the failure.

The accepted
[local-data conversion policy](independent-tabs-and-pwa-proposal.md#local-data-and-backups) owns the
scoped exception, namespace protection and recovery. It does not revive formats retired during
stateless project access or promise cross-tab conflict resolution.

## Reviewable implementation steps

1. **Model, persistence and checking.** Add the range target/validators, current-format conversion,
   complete identity/snapshot handling, export and grouped checking. Validate durable invariants
   with seeded ranges before adding UI creation.
2. **Files and Search.** Capture ranges, integrate the editor and covered-line markers, and verify
   save/reload, source changes, reattachment, copy/history/Undo and narrow layouts.
3. **Working-copy diffs.** Resolve a common side, include revealed context and reject hidden gaps.
   Preserve both sides of mixed selections under one comment. Verify snapshot invalidation,
   performance and the shared interaction across all standard sizes.

Run formatting after each step, strict TypeScript and relevant unit/browser checks for code changes,
and the CSS/QA gate. Each visible step needs captured and inspected phone, tablet portrait, tablet
landscape and desktop states. Keep the rebuilt app available for review. Implementation approval and
approval to commit remain separate under [AGENTS.md](../AGENTS.md). For this feature, the maintainer
explicitly authorized commits after each independently reviewed and validated stage.

Tests should cover repeated text, endpoint whitespace/Unicode, blank lines, reverse selections,
render-block crossings, end-at-next-row-start normalization, diff-side combinations, expanded
context/gaps, middle-line mutation, forged mixed-source ranges, limits, malformed storage/imports,
late checks/copies after reattachment, exact history and Undo. Guard one grouped check and shared
source reads as range length grows. Physical iOS/Android selection handles, scrolling and native
menus still require device verification; Chrome emulation cannot establish those results.

## Investigation evidence and decisions for review

The investigation traced the selection registry, both source renderers, comment validators/export,
transaction identity, shared/server checking, dialogs/reattachment and backup validation. The prior
regression check passed the five selection-feedback unit tests and automated Chrome selection checks
at narrow phone, phone, both tablet orientations and desktop sizes. Those establish current
single-line behavior only; this investigation has no multi-line implementation or device evidence.

The maintainer approved the slice and delegated the mixed-side decision. The chosen behavior
preserves both selected Old/New source parts, rather than discarding removed code. Current local
data is preserved through the scoped conversion; line anchors remain the underlying checking units.

## Stage 1 completed — model, persistence and checking

Range subjects now preserve one source part or an Old/New pair, exact UTF-16 fragments, and the
existing line anchors. Checking flattens and deduplicates those anchors in one operation and returns
an all-or-nothing result for each comment. Export quotes both sides before one shared body; copied
history and Undo keep complete snapshots. Current drafts/backups convert to the new protected
namespace without replacing the recoverable predecessor on a persistence failure.

Independent review found no model, checking or persistence blockers. Its documentation clarification
was incorporated in the local-data owner. Visual QA found and fixed unreachable editor controls for
long source quotes; review additionally found zero-height quotes in short viewports, addressed with
a minimum scrollable quote height and outer dialog scrolling.

Validation: 288 unit/integration tests passed, all five TypeScript projects passed, formatting/CSS
gates passed, and existing selected-feedback and transaction browser checks passed. A seeded mixed
range passed real Chrome source checking, export, clipboard, archival, Undo and editing. The four
standard [editor captures](../qa/screenshots/multi-line-stage1-editor-final/manifest.json) were
captured and inspected. Physical-device behavior remains unverified. Native range creation follows
in the next stages.
