# Line counts in Changes

Changes receives file metadata and counts together, before patches or syntax load. Refresh and
Update accept both as one snapshot. Background checks keep displayed counts and code steady until
the reader requests an update; a failed refresh retains the accepted snapshot.

## Presentation

Each contextual-list row and card heading shows localized added/deleted counts beside its change
kind. Card headings group the status and counts on the left beneath the path, separated by a spaced
middle dot; the language and Open controls occupy the right. Paths have their own line, rename
origins can wrap and each count pair stays together. Counts remain visible in collapsed, expanded
and sticky headings. Layer totals appear before file-count badges in Staged, Unstaged and Untracked
groups. Partial text totals are labeled Known, with separate binary, non-text and unavailable
summaries; Conflicts retains its explicit state and file count.

Section headings remain below the app bar, with the expanded card heading beneath them. They hand
off at layer boundaries and accommodate wrapping without overlapping content. Activating a section
heading returns to its start without loading data or toggling cards. Working-copy cards omit the
repeated layer pill. Section headings are flat; file headings become square while pinned beneath
them and regain rounding inside the card. Historical headings keep their commit presentation.

There is no overall staged-plus-unstaged sum: those layers describe separate review activity, not
the net HEAD-to-working-tree change. [ChangeStats](../src/client/ChangeStats.tsx) and
[shared summaries](../src/shared/change-line-stats.ts) own exceptional states and layer totals.

## Counting rules and exceptional states

Counts follow the [card comparisons](diff-slice.md#sources-and-freshness): HEAD-to-index for staged,
index-to-worktree for unstaged and every source line added for untracked text. Unborn staged content
uses an empty Old side. Two layers of one path have separate counts.

Pure renames, permission changes and empty files show zero lines. Deletions have no additions. A
missing final newline does not add another source line. Git classifies tracked content, so textual
media such as SVG can have counts even when its card previews an image. Binary entries show Binary;
conflicts, links and submodules show a quiet dash with an accessible reason. Limits, read errors and
unstable content show Stats unavailable. Group totals include known text and explicitly label
entries that cannot contribute.

Untracked counting shares [text classification](../src/server/source-text.ts) with its diff: bounded
bytes, valid UTF-8, no NUL and correct final-newline handling. It scans without constructing diff
rows or decorations and uses [checked no-follow access](working-file-boundaries.md). Tracked numeric
counts can remain available when a full patch exceeds display limits.

Ordinary staged/unstaged comparisons preserve separate inventory entries. Raw modes keep links and
submodules out of text counts. Explicit renames/copies use their card's permitted paths and rename
comparison. Moves into/out of a selected subfolder count as the scoped addition/deletion actually
reported by status; unchanged explicit renames contribute zero lines. The approved-root decision
stays shared between patches and counts.

## Snapshot and failure policy

The public status response requires statistics on each entry; lightweight checks return only Git
state and version tokens. [shared/api.ts](../src/shared/api.ts) owns these types and validation.
[change-stats.ts](../src/server/change-stats.ts) owns collection, work limits and retry;
[numeric parsing](../src/server/git-numstat.ts) is shared with immutable historical counts.

Validation checks safe nonnegative totals, modes/hashes, binary markers, matching numeric paths and
rename origins, unique layer/path identities and consistency between entries and statistics.
Malformed output remains an error. Command/read/limit failures can retain the inventory with
explicit unavailable counts; missing numeric data is never a fabricated zero.

Both revision and change token are checked before and after collection. A changed token retries once
with fresh work budgets. If another edit prevents a stable result, the latest inventory returns
unavailable changed statistics while intrinsically non-applicable entries retain their reasons. This
uses the [ordinary-edit signal](live-change-detection-slice-proposal.md), not an atomic snapshot.

There is no mutable statistics server cache or separate statistics loader/persistence. The accepted
review owner keeps counts and metadata together across section navigation, scoped to the project and
refresh generation. Historical counting/caching remains in the
[Git record](git-history-slice-proposal.md#line-totals-and-metadata).

## Verification — 2026-10-06

[Server tests](../src/server/change-stats.test.ts) compare counts to actual card rows across layers,
renames/scope, unusual names, text/binary/media, excluded states, unborn/SHA-256 repositories, read
errors, aggregate limits, malformed output and stable retry/fallback.
[Response tests](../src/shared/change-line-stats.test.ts) reject contradictory states, duplicate
identities and unsafe totals.

[Browser QA](../qa/check-change-stats.ts) covers bundled loading without collapsed-card patch reads,
matching file/layer counts, explicit Update, stable expansion/counts, section handoff and keyboard
jumps. It also checks localized large values at 320 px and pinned/restored corner presentation.

| View            | Phone                                                                   | Tablet portrait                                                                  | Tablet landscape                                                                  | Desktop                                                                  |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Collapsed cards | [Image](../qa/screenshots/changes-flat-section-headings/mobile.png)     | [Image](../qa/screenshots/changes-flat-section-headings/tablet-portrait.png)     | [Image](../qa/screenshots/changes-flat-section-headings/tablet-landscape.png)     | [Image](../qa/screenshots/changes-flat-section-headings/desktop.png)     |
| Contextual list | [Image](../qa/screenshots/changes-inline-totals-list/mobile.png)        | [Image](../qa/screenshots/changes-inline-totals-list/tablet-portrait.png)        | [Image](../qa/screenshots/changes-inline-totals-list/tablet-landscape.png)        | [Image](../qa/screenshots/changes-inline-totals-list/desktop.png)        |
| Sticky headings | [Image](../qa/screenshots/changes-flat-sticky-card-headings/mobile.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/tablet-portrait.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/tablet-landscape.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/desktop.png) |

These milestone captures were inspected at all four sizes with no page-wide overflow. Real
iOS/Android touch and large production-repository performance remain unverified; fixtures establish
bounded work and layout.
