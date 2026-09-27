# Proposed next slice: expandable diff cards

Status: awaiting maintainer feedback before implementation.

## User flow

The Changes page becomes a continuous list of file cards in Git layer order. Cards start collapsed with path, change state, and any available line counts. Tapping a file in the desktop sidebar or phone drawer closes the drawer if needed, scrolls to its card, and expands it. Expanding a card fetches that file's diff. A visible wrap control switches code between wrapped lines and horizontal scrolling inside the code pane; the page itself stays within the viewport. Line numbers and added, removed, and context rows are distinct without relying on color alone.

This slice renders source text with diff colors and line numbers. Syntax tokens, word-level changes, moved-block detection, comments, and export follow in separate small steps. A binary, oversized, or conflicted file gets an explicit card state instead of a broken text view.

## Data and API

Add `GET /api/projects/:id/diff?layer=<layer>&path=<selected-folder-relative-path>&revision=<status-revision>`. The server revalidates the opened project and matches the requested layer/path to the current status inventory. A stale revision returns a typed stale response so the UI can refresh without attaching a diff to the wrong version. The client never supplies an old path or arbitrary Git revision.

The response is a discriminated union: `text` with file metadata and hunks, `binary`, `too_large`, `conflict`, or `stale`. Each text line has kind (`context`, `added`, or `removed`), old and new line numbers represented as numbers or null, and raw source text. Card IDs combine layer and path so staged and unstaged versions of one path remain distinct.

For staged files, compare `HEAD` to index; for unstaged files, compare index to working tree; for untracked files, treat the old side as empty. Use fixed Git arguments with `--no-ext-diff`, `--no-textconv`, `--no-color`, bounded context, and `--` before paths. Parse Git hunk headers and line prefixes into validated rows. Read an untracked file only after realpath containment, and bound both input and response sizes. A repository without a first commit uses an empty old tree.

## Edge cases

- A path can have one staged and one unstaged card with different content.
- Rename origins may be outside the selected subfolder; display that origin without allowing it as a client-supplied file path.
- Deleted files, missing final newlines, tabs, spaces, newlines in filenames, mode-only changes, and empty files need explicit representations.
- Binary files, symlinks, submodules, conflicts, and files beyond the text limit must not be decoded as ordinary UTF-8 code.
- If the repository changes between status and diff requests, return stale and keep the user's scroll and collapse state while refreshing.
- On phone, use one-column inline rows with touch-sized expand controls. Long code lines scroll inside the card when wrapping is off.

## Smallest reviewable result

Deliver lazy, collapsible text diff cards for staged, unstaged, and untracked files with a wrap toggle, line numbers, bounded errors, and mobile drawer navigation. Use temporary Git fixture tests for the diff parser and one real-browser flow that opens a card on a phone. Capture the four viewport sizes before asking for the next design decision about syntax highlighting and comment gestures.
