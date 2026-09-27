# Syntax highlighting in diff cards

Status: proposed for maintainer feedback. The current diff cards display plain source text.

## User flow and smallest slice

Opening a supported source diff colors syntax inside the existing added, removed, and context rows. Line numbers, diff backgrounds, wrapping, horizontal scrolling, and collapse behavior stay as they are. The first slice covers TypeScript, TSX, JavaScript, JSX, JSON, CSS, HTML, and Markdown. Unknown extensions, unsupported encodings, and content beyond the existing text limits remain readable as plain text. Word-level change emphasis and moved-block detection follow separately.

Use Shiki on the Bun server as the only new runtime dependency. Keep one highlighter instance and load only the listed grammars and one app theme. The browser receives token text and a constrained color/style representation, then renders ordinary Preact spans. It never renders server-supplied HTML. The highlighter theme and mapping to the app's color tokens are configured in one place so the palette stays easy to adjust.

## Data and API

Extend the existing text diff response with a `tokens` array on each displayed line. A token has exact source text and a validated syntax style; joining token text must reproduce that line's `text` exactly. Plain text lines use one unstyled token. The client validates this invariant at the HTTP boundary and falls back to the raw line if highlighting cannot be produced. The `GET /api/projects/:id/diff` route and stale-revision contract stay the same.

Tokenize the old and new file snapshots separately, then map old-side tokens to removed rows and new-side tokens to added and context rows by line number. This preserves multiline grammar state across distant hunks. Fetch only the snapshots needed for a selected card: `HEAD`/index for staged, index/working tree for unstaged, and working tree for untracked. Reuse the current root containment, no-shell Git calls, size limits, and stale checks. Never follow a working-tree path outside the approved root. If either snapshot cannot be read safely or exceeds the bound, return the valid plain diff instead of guessing at syntax.

## Edge cases and checks

- Renames and deletions need the correct old path and side; two layers of one path may have different tokenization and content.
- CRLF, tabs, empty lines, and missing final newlines must keep exact source text and line anchors.
- A multiline comment or string can begin before a visible hunk; full-side tokenization must preserve that context.
- Invalid UTF-8, unknown extensions, symlinks, submodules, binary files, and large snapshots keep the current explicit fallback states.
- The server validates token reconstruction before sending; the browser validates again before rendering. Token count and total bytes remain bounded.
- Browser QA should compare a known TypeScript diff, a multiline comment across hunks, plain-text fallback, and all four responsive viewports. Real-device touch remains a separate check.

Shiki provides `codeToTokens` for custom rendering and recommends a long-lived highlighter with explicit language loading. Its grammar-state support is available for later optimization, but full-side tokenization gives the first slice reliable context. [Usage](https://shiki.style/guide/install), [grammar state](https://shiki.style/guide/grammar-state), [performance](https://shiki.style/guide/best-performance).

## Feedback checkpoint

Please confirm this order: syntax colors with exact line alignment first, followed by word-level changes and moved blocks. The bounded full-side read is the main implementation choice to review before coding.
