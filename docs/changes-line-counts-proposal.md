# Line counts in Changes

Current project access uses a canonical absolute `projectPath` query field on every project
resource, including batch and raw-media routes. No registration is required. See the
[stateless project contract](stateless-project-access-plan.md#project-contract-and-validation).
Dated implementation and compatibility checkpoints below remain historical evidence.

Status: implemented, reviewed and approved for commit by the maintainer on 2026-10-06.

The maintainer requested added/deleted line counts for uncommitted changes in both the contextual
list and the continuous file-card view, using the presentation already available in Git history.
After comparing the Git contract, the maintainer approved bundled metadata and statistics. This
record describes the delivered user flow, read contract, edge cases and verification.

## User flow and presentation

Opening Changes returns file metadata and counts together. Counts are visible before cards expand;
there is no separate statistics request. Refresh and Update accept fresh metadata/counts together.
Background checks offer Update and keep the displayed counts and code steady until the reader
requests it. A failed refresh retains the accepted snapshot.

Each contextual-list row and working-copy card heading shows localized green `+N` and red `−N` on
its secondary metadata row, aligned to the right of the change kind. Paths retain their own line;
rename origins can wrap. Counts stay visible in collapsed, expanded and sticky headings. Each pair
stays together and can wrap to its own row when needed. Existing navigation, expansion and touch
controls retain their behavior.

Each nonempty Staged, Unstaged and Untracked group shows matching totals in both views, immediately
before the file-count badge with spacing. Ordinary totals share the section-title row. Exceptional
binary, non-text and unavailable entry summaries remain below when present; partial text totals are
labeled **Known**. Conflicts retain their file count and explicit state.

The maintainer requested this presentation refinement on 2026-10-06. Each main-view section heading
stays below the app bar while reading its section, with the current expanded card heading directly
below it. Clicking or keyboard-activating the section heading returns to that section's start,
without toggling cards or loading data. Headings hand off at section boundaries and measure their
wrapped height so narrow layouts do not overlap cards. Working-copy cards omit the repeated layer
pill; historical cards retain their commit presentation. Data/API shape and counting rules are
unchanged. The smallest review slice is this heading/layout refinement plus responsive and sticky
interaction checks.

The maintainer's next visual refinement removes the section heading's rounding and shadow.
Working-copy file headings become square only while pinned beneath it, and regain their usual
rounding when scrolled back into the card. Native intersection tracking observes a zero-layout-cost
marker and adjusts its boundary when the section/file heading or viewport resizes. Collapsing or
unmounting a card disconnects the observers. This changes presentation only.

[LineCounts](../src/client/LineCounts.tsx) shares localized formatting, signs, typography and
accessible descriptions with [CommitMeta](../src/client/CommitMeta.tsx). Historical file headings
still have their existing presentation; historical counting and caching policy remain unchanged.
[ChangeStats](../src/client/ChangeStats.tsx) renders exceptional states and layer summaries, using
[shared summary validation](../src/shared/change-line-stats.ts).

An overall sum across staged and unstaged layers remains outside this slice. Each layer has a
precise comparison; adding both describes review activity rather than the net HEAD-to-working-tree
change.

## Counting rules and exceptional states

| Entry                               | Count meaning or display                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Staged text                         | HEAD → index, or empty old tree → index before the first commit          |
| Unstaged text                       | Index → working tree                                                     |
| Untracked text                      | Empty old side → working file; every source line is added                |
| Both staged and unstaged            | Separate counts for each entry and card                                  |
| Pure rename or permission change    | `+0 −0` when the card has no changed text                                |
| Deletion                            | Deleted source lines, with zero additions                                |
| Empty file                          | `+0 −0`                                                                  |
| Missing final newline               | Count the final source line once; the warning is not a source line       |
| Binary                              | `Binary`, with a separate binary-file count in summaries                 |
| Textual media such as SVG           | Text counts when Git classifies it as text, including preview cards      |
| Conflict, symlink or submodule      | A quiet `—` with an accessible reason                                    |
| Read/output/time limit or I/O error | `Stats unavailable`, preserving usable inventory and diffs               |
| Partial group                       | Known text totals plus explicit binary/non-text/unavailable entry counts |

Untracked counts share [working-text classification](../src/server/working-text.ts) with the diff
reader: bounded bytes, valid UTF-8, no NUL and correct final-newline handling. Counting scans source
text without constructing syntax tokens, word detail or diff rows. Reads use the checked no-follow
working-file boundary and do not follow symlink targets.

Tracked numeric statistics can remain available when a full patch exceeds the card's display limit.
Untracked reads use the existing 1 MiB/20,000-line per-file limits, sequential reads, an 8 MiB
aggregate allocation/read budget including EOF probes, and at most 1,000 files per collection.
Ordinary staged and unstaged batches each have an 8 MiB output limit and the shared ten-second
command timeout. Explicit rename reads run at most four together, with a cap of 32 per layer. A
ten-second collection window stops scheduling further rename or untracked work; an already-running
Git command retains its own timeout. Remaining entries report unavailable counts. A retry receives
fresh budgets.

## Data and API shape

The existing read-only status resource has two response modes:

```text
GET /api/project/status
GET /api/project/status?mode=check
```

The default response is the complete review inventory, with required statistics on every entry.
Project opening and explicit Refresh/Update use it. Background polling uses `mode=check`, returning
only Git/non-Git state and version tokens without calculating statistics. Unknown queries and
unknown/duplicate mode values are rejected at the HTTP boundary. Current project resolution and
per-request approved-root checks remain in place.

The same bundling is already used by [history and commit detail](../src/server/git-history.ts):
metadata and line totals arrive in one response, while expanded patches and source-line numbers load
separately. [Historical statistics](../src/server/git-stats.ts) keep their immutable cache.
[Numeric record parsing](../src/server/git-numstat.ts) is shared with working-copy statistics.

Validated types in [shared/api.ts](../src/shared/api.ts) include:

```ts
type ChangeLineStats =
  | { kind: "text"; added: number; deleted: number }
  | { kind: "binary" }
  | { kind: "not_applicable"; reason: "conflict" | "symlink" | "submodule" }
  | { kind: "unavailable"; reason: "limit" | "read_error" | "changed" };

type ProjectStatus =
  | { kind: "not_git" }
  | {
      kind: "git";
      revision: string;
      changeToken: string;
      entries: (ChangeEntry & { stats: ChangeLineStats })[];
    };

type ProjectChangeCheck =
  { kind: "not_git" } | { kind: "git"; revision: string; changeToken: string };
```

`ProjectInventory` retains lightweight internal entries. Diff and media version checks use
[readProjectStatus](../src/server/git-status.ts); they do not calculate statistics.
[readReviewStatus](../src/server/change-stats.ts) composes the inventory with statistics for public
review responses. The client does not provide rename origins, revisions or arbitrary paths to count.

The parser validates nonnegative safe integers, raw modes and hashes, paired numeric binary markers,
NUL-delimited paths, matching rename origins, unique layer/path identities, entry/state consistency
and safe group totals. Missing numeric data is explicitly unavailable. Invalid Git output remains an
error; command/read/limit failures can preserve inventory with unavailable counts.

Both `revision` and `changeToken` are checked before and after collection. A working-tree edit can
alter counts while preserving the porcelain revision. On either token changing, collection retries
once. If a second edit prevents a stable result, the latest inventory is returned with `changed`
unavailable statistics; intrinsically non-applicable entries retain their reasons. This uses the
existing ordinary-edit metadata signal, without promising an atomic filesystem snapshot.

[Working-copy review](../src/client/working-copy-review.ts) accepts metadata and statistics as one
snapshot, shared by both views and scoped to the project and refresh generation. It keeps that
snapshot across section navigation. Polling compares tokens and never replaces displayed review data
with its check response. There is no additional statistics loader, persistence or mutable server
cache. This feature uses the current project API.

## Server comparisons and renames

The server uses one staged and one unstaged raw/numeric batch for ordinary entries, skipping empty
layers. `--relative --no-renames` preserves separate status entries. Raw modes distinguish links and
submodules from text even when Git reports numeric link-target changes. Fixed argument arrays, no
external diffs/text conversion, bounded output and timeouts use the existing execution boundary.

Explicit rename/copy entries receive a targeted comparison with the same permitted old/new paths and
rename detection as their cards. [Working diff paths](../src/server/working-diff-paths.ts) shares
the approved-root decision between cards and counts. Fallback work is bounded.

Integration tests confirmed that scoped porcelain inventory presents moves into or out of a selected
folder as additions or deletions. Counts match those entries and cards: incoming lines are added,
outgoing lines are deleted. Explicit rename entries show `+0 −0` for unchanged text. The initial
investigation's manually supplied outside origin demonstrated a difference between relative and
two-path comparisons, but did not represent the entry produced by scoped status. The implementation
preserves the actual inventory's comparison.

## Verification — 2026-10-06

Server tests compare every text count in a mixed fixture to its actual card's added/removed rows.
Coverage includes independent layers, untracked/empty text, missing final newlines, deletion,
mode-only changes, binary/SVG, links, submodules, conflicts beside ordinary edits, unusual names,
selected-folder/approved-root boundaries, SHA-256/unborn repositories, unreadable tracked/untracked
files, aggregate limits, malformed output and stable retry/fallback. Shared response tests reject
invalid/contradictory states, duplicate identities, unsafe totals and check responses presented as
full inventories. API tests cover bundled statistics and lightweight/invalid query modes.

[Focused browser QA](../qa/check-change-stats.ts) checks one initial response, no patch reads for
collapsed counts, matching file/layer values in both views, partial/non-text states, explicit
Update, preserved expansion and steady counts before Update. It includes localized million-line
counts at 320 px. The UI refinement checks inline totals before file-count badges, absent layer
pills, stacked section/card headings, section handoff, visible sidebar selections, and pointer and
keyboard section jumps without route/data/expansion changes. It also verifies flat section styling,
square pinned file headings and restored rounding when they return to the card. Existing
live-change, loading/project ownership, diff interaction and Git browsing checks also pass against
an isolated fixture server.

`qa:capture` recorded the refined contextual lists, collapsed cards and sticky section/card stack at
all four standard sizes. The latest flat-heading refinement adds eight inspected captures; the
unchanged contextual-list captures remain current. All linked manifests report no horizontal page
overflow. The original count-delivery milestones remain preserved separately.

| View            | Phone                                                                   | Tablet portrait                                                                  | Tablet landscape                                                                  | Desktop                                                                  |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Collapsed cards | [Image](../qa/screenshots/changes-flat-section-headings/mobile.png)     | [Image](../qa/screenshots/changes-flat-section-headings/tablet-portrait.png)     | [Image](../qa/screenshots/changes-flat-section-headings/tablet-landscape.png)     | [Image](../qa/screenshots/changes-flat-section-headings/desktop.png)     |
| Contextual list | [Image](../qa/screenshots/changes-inline-totals-list/mobile.png)        | [Image](../qa/screenshots/changes-inline-totals-list/tablet-portrait.png)        | [Image](../qa/screenshots/changes-inline-totals-list/tablet-landscape.png)        | [Image](../qa/screenshots/changes-inline-totals-list/desktop.png)        |
| Sticky headings | [Image](../qa/screenshots/changes-flat-sticky-card-headings/mobile.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/tablet-portrait.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/tablet-landscape.png) | [Image](../qa/screenshots/changes-flat-sticky-card-headings/desktop.png) |

Strict type checking, the full test suite, formatting, the CSS token/QA gate and asset build pass.
The review services were rebuilt/restarted. Real iOS/Android touch behavior and performance on a
large production repository remain unverified; browser fixtures verify bounded work and layout. The
maintainer reviewed the delivered UI refinements and explicitly approved committing the work.
