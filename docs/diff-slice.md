# Expandable diff cards

Current project access uses a canonical absolute `projectPath` query field on every project
resource, including batch and raw-media routes. No registration is required. See the
[stateless project contract](stateless-project-access-plan.md#project-contract-and-validation).
Dated implementation and compatibility checkpoints below remain historical evidence.

Status: implemented and committed. [Syntax highlighting](syntax-highlighting-slice.md),
[line comments](feedback-slice-proposal.md), [word detail](diff-fidelity-slice-proposal.md), and
[media previews](media-preview-slice-proposal.md) extend this slice.
[Line counts](changes-line-counts-proposal.md) now enrich working-copy headings and layer groups;
the maintainer accepted that delivery and its UI refinements on 2026-10-06.

## User flow

The Changes page is a continuous list of file cards in Git layer order. Cards restore their saved
open state, otherwise starting collapsed with path, change state and line counts. Counts arrive with
the inventory and remain visible in expanded/sticky headings without loading patches first.
Selecting a file from the contextual list navigates to its URL, expands it, and focuses it once.
Later card toggles and Refresh do not repeat that focus. Expanding a card fetches its diff unless
the matching validated result is already in the
[tab-memory cache](loading-and-transition-polish.md). A visible wrap control switches code between
wrapped lines and horizontal scrolling inside the code pane; the page itself stays within the
viewport. **Expand all** and **Collapse all** apply across the displayed layers without refreshing,
navigating or changing drafts. The
[bulk controls record](diff-batching-and-bulk-controls-proposal.md) owns their review evidence and
persistence bounds. Wrap preference and open cards survive reload; diff payloads do not.

This slice established source rows with diff colors and line numbers. Syntax tokens, line feedback,
bounded word detail, and media previews are now implemented. Moved-block detection remains optional.
A binary file without a supported preview, oversized file, or conflicted file gets an explicit card
state instead of a broken text view. Phone gutters are hidden; a row tap reveals its sign, line
numbers, and Comment action as described in the
[phone line-action record](phone-portrait-gutter-slice-proposal.md).

The rows take their height from the code line height plus 2px of padding above and below, with no
minimum row or gutter height. Wrapped rows grow with their content; short lines stay compact in both
wrap modes. The change sign sits to the left of the old/new line-number gutters. When wrapping is
off, one shared scroll surface spans every hunk in the file. Short rows and hunk backgrounds extend
to the width of the longest line; the change sign, line-number gutters, and hunk labels remain
visible at the left edge while code scrolls. In Changes, the section heading stays below the top bar
and the expanded file heading stays directly below it until its card ends. Section headings hand off
at layer boundaries; activating one returns to that section's start. Working-copy cards omit the
repeated layer pill. Historical file headings retain their existing position below the top bar. File
headings retain rounding inside their cards; Changes headings become square while pinned beneath the
flat section heading and regain rounding when scrolled back. Touch taps do not leave a hover
background on the heading.

## Data and API

`GET /api/project/diff?layer=<layer>&path=<selected-folder-relative-path>&revision=<status-revision>`
resolves the absolute project path and matches the requested layer/path to the current status
inventory. A stale revision returns a typed stale response. An optional `changeToken` query also
checks ordinary edits that leave the Git revision unchanged; the batched card fallback supplies it.
The server checks status again after reading the diff to catch changes during the request. The
client never supplies an old path or arbitrary Git revision.

Changes cards use `POST /api/project/diffs` with both snapshot tokens and a bounded list of
layer/path/language requests. The server resolves them from one status inventory, then checks both
tokens again after the batch; any stale file or changed token discards the whole batch. Independent
file failures retain their own errors. The client shares Git's bounded queue, response accounting
and fallback mechanism. The [batching record](diff-batching-and-bulk-controls-proposal.md) owns
limits, source identity and measurements.

The response is a discriminated union: `text` with hunks, `media`, `binary`, `too_large`,
`conflict`, or `stale`. Each text line has kind (`context`, `added`, or `removed`), old and new line
numbers represented as numbers or null, source text, syntax tokens, word-detail spans, and a
missing-final-newline flag. Card IDs combine layer and path so staged and unstaged versions of one
path remain distinct. The browser validates hunk counts, line numbers, and decorations before
rendering.

[DiffCardFrame](../src/client/DiffCardFrame.tsx) uses one review/inspect mode for heading metadata
and line interaction. Working-copy review supplies a status entry with statistics plus its comment
capabilities; historical inspection supplies a commit file. The review entry drives both the heading
and anchor identity. The frame passes that mode directly to [DiffBody](../src/client/DiffBody.tsx);
fetching and cache ownership stay in their separate callers.

For staged files, compare `HEAD` to index; for unstaged files, compare index to working tree; for
untracked files, treat the old side as empty. The
[shared Git read boundaries](git-read-boundaries.md) own execution, repository-relative source
translation and bounded object reads. Git uses fixed argument arrays, literal pathspecs,
`--no-ext-diff`, `--no-textconv`, `--no-color`, three context lines, and `--` before paths. The
parser validates hunk headers, row counts, and line prefixes. Untracked files are read only after
[shared containment and identity checks](working-file-boundaries.md), with `O_NOFOLLOW` and
`O_NONBLOCK` on the literal path. Input is bounded to 1 MiB for untracked files, 2 MiB for patches,
and 20,000 diff lines. A repository without a first commit produces staged additions against an
empty old tree.

The pure `parseGitPatch` and `diffFromContent` functions return a private text/binary/size-limit
union. Conflict and stale states belong to working-copy status/filesystem/version boundaries; media
belongs to its preview boundary. Syntax and word decoration accept and return text only.

## Edge cases

- A path can have one staged and one unstaged card with different content.
- Rename origins may be outside the selected subfolder. The server uses an old path in a Git diff
  only when it resolves inside the approved root; the client cannot supply it.
- Deleted files, missing final newlines, tabs, spaces, newlines in filenames, mode-only changes, and
  empty files need explicit representations.
- Binary files, symlinks, submodules, conflicts, and files beyond the text limit must not be decoded
  as ordinary UTF-8 code.
- If the repository changes between status and diff requests, return stale, retain open-card choices
  and announce **New edits · Update**. The reader explicitly applies Update or Refresh; stale cards
  do not start automatic refresh loops. Tab-memory scroll restoration and one-time URL target focus
  are documented in the [loading record](loading-and-transition-polish.md); arbitrary scroll
  positions are not persisted across reload.
- On phone, use one-column inline rows with touch-sized expand controls. Long code lines scroll
  inside the card when wrapping is off.

## Verification

Temporary Git fixture tests cover staged and unstaged versions of one path, renames, deletions,
unusual filenames, untracked text, binary files, symlinks, missing final newlines, an unborn
repository, malformed hunks, and stale API requests.
`bun qa/check-diff.ts --url <url> --folder inventory-fixture` checks mobile drawer navigation,
staged rows, wrap persistence, open-card persistence, compact short rows in both wrap modes, growing
wrapped rows, aligned horizontal scrolling, sticky gutters, and page overflow containment.
[Wrapped rows](../qa/screenshots/diff-marker-left-wrap/mobile.png),
[scrolled rows](../qa/screenshots/diff-marker-left-scroll/mobile.png), and
[a tapped collapsed heading](../qa/screenshots/diff-header-tap-collapsed/mobile.png) were captured
at phone, tablet portrait, tablet landscape, and desktop sizes. Real-device touch behavior remains
unverified.
