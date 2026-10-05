# Expandable diff cards

Status: implemented and committed. [Syntax highlighting](syntax-highlighting-slice.md),
[line comments](feedback-slice-proposal.md), [word detail](diff-fidelity-slice-proposal.md), and
[media previews](media-preview-slice-proposal.md) extend this slice.

## User flow

The Changes page is a continuous list of file cards in Git layer order. Cards restore their saved
open state, otherwise starting collapsed with path and change state. Selecting a file from the
contextual list navigates to its URL, expands it, and focuses it once. Later card toggles and
Refresh do not repeat that focus. Expanding a card fetches its diff unless the matching validated
result is already in the [tab-memory cache](loading-and-transition-polish.md). A visible wrap
control switches code between wrapped lines and horizontal scrolling inside the code pane; the page
itself stays within the viewport. Wrap preference and open cards survive reload; diff payloads do
not.

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
visible at the left edge while code scrolls. The expanded file heading stays below the top bar
during vertical scrolling until its card ends. File headings keep their rounded corners; touch taps
do not leave a hover background on the heading.

## Data and API

`GET /api/projects/:id/diff?layer=<layer>&path=<selected-folder-relative-path>&revision=<status-revision>`
revalidates the opened project and matches the requested layer/path to the current status inventory.
A stale revision returns a typed stale response so the UI can refresh without attaching a diff to
the wrong version. The server checks status again after reading the diff to catch changes during the
request. The client never supplies an old path or arbitrary Git revision.

The response is a discriminated union: `text` with hunks, `media`, `binary`, `too_large`,
`conflict`, or `stale`. Each text line has kind (`context`, `added`, or `removed`), old and new line
numbers represented as numbers or null, source text, syntax tokens, word-detail spans, and a
missing-final-newline flag. Card IDs combine layer and path so staged and unstaged versions of one
path remain distinct. The browser validates hunk counts, line numbers, and decorations before
rendering.

[DiffCardFrame](../src/client/DiffCardFrame.tsx) uses one review/inspect mode for heading metadata
and line interaction. Working-copy review supplies a single status entry plus its comment
capabilities; historical inspection supplies a commit file. The review entry drives both the heading
and anchor identity. The frame passes that mode directly to [DiffBody](../src/client/DiffBody.tsx);
fetching and cache ownership stay in their separate callers.
[M08b](maintenance-plan.md#m08b--diff-card-modes) records the contract and verification.

For staged files, compare `HEAD` to index; for unstaged files, compare index to working tree; for
untracked files, treat the old side as empty. The
[shared Git read boundaries](git-read-boundaries.md) own execution, repository-relative source
translation and bounded object reads. Git uses fixed argument arrays, literal pathspecs,
`--no-ext-diff`, `--no-textconv`, `--no-color`, three context lines, and `--` before paths. The
parser validates hunk headers, row counts, and line prefixes. Untracked files are read only after
realpath containment and with `O_NOFOLLOW`. Input is bounded to 1 MiB for untracked files, 2 MiB for
patches, and 20,000 diff lines. A repository without a first commit produces staged additions
against an empty old tree.

The pure `parseGitPatch` and `diffFromContent` functions return a private text/binary/size-limit
union. Conflict and stale states belong to working-copy status/filesystem/version boundaries; media
belongs to its preview boundary. Syntax and word decoration accept and return text only.
[M08c](maintenance-plan.md#m08c--parser-and-decorator-contracts) records the narrower internal
contracts, unchanged limits/fallbacks, and regression evidence.

## Edge cases

- A path can have one staged and one unstaged card with different content.
- Rename origins may be outside the selected subfolder. The server uses an old path in a Git diff
  only when it resolves inside the approved root; the client cannot supply it.
- Deleted files, missing final newlines, tabs, spaces, newlines in filenames, mode-only changes, and
  empty files need explicit representations.
- Binary files, symlinks, submodules, conflicts, and files beyond the text limit must not be decoded
  as ordinary UTF-8 code.
- If the repository changes between status and diff requests, return stale and keep the open-card
  state while refreshing. Tab-memory scroll restoration and one-time URL target focus are documented
  in the [loading record](loading-and-transition-polish.md); arbitrary scroll positions are not
  persisted across reload.
- On phone, use one-column inline rows with touch-sized expand controls. Long code lines scroll
  inside the card when wrapping is off.

## Verification

Temporary Git fixture tests cover staged and unstaged versions of one path, renames, deletions,
unusual filenames, untracked text, binary files, symlinks, missing final newlines, an unborn
repository, malformed hunks, and stale API requests.
`bun run qa:diff --url <url> --folder inventory-fixture` checks mobile drawer navigation, staged
rows, wrap persistence, open-card persistence, compact short rows in both wrap modes, growing
wrapped rows, aligned horizontal scrolling, sticky gutters, and page overflow containment.
[Wrapped rows](../qa/screenshots/diff-marker-left-wrap/mobile.png),
[scrolled rows](../qa/screenshots/diff-marker-left-scroll/mobile.png), and
[a tapped collapsed heading](../qa/screenshots/diff-header-tap-collapsed/mobile.png) were captured
at phone, tablet portrait, tablet landscape, and desktop sizes. Real-device touch behavior remains
unverified.
