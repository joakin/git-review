# Syntax highlighting in diff cards

Status: revised after maintainer feedback. The current diff cards display plain source text.

## User flow and smallest slice

Opening a source diff colors syntax inside the existing added, removed, and context rows. The frontend chooses all colors and font treatments from `design-tokens.css`; the response contains no theme name, CSS, HTML, or color values. A future theme selector can switch CSS variables without refetching a diff. Line numbers, diff backgrounds, wrapping, horizontal scrolling, and collapse behavior stay as they are. Word-level change emphasis and moved-block detection follow separately.

Use Shiki's **full server bundle**, so any language grammar it ships can be used, including C and C++. Load the detected grammar on demand into a reused highlighter rather than loading every grammar at server startup. Detect a language from the filename, extension, and Shiki's known IDs and aliases. Ambiguous names such as `.h`, extensionless files, and unknown extensions need a per-card language picker with `Plain text` as an option. The picker can list all bundled languages; save overrides for this project and path in browser storage. The client never sends an arbitrary grammar definition.

## Data and API

Extend the text diff response with `syntax: { kind: "highlighted", language: string } | { kind: "plain", reason: ... }`. Each displayed line gets `tokens: { text: string, role: SyntaxRole }[]`. Roles are a bounded set such as `plain`, `comment`, `keyword`, `string`, `number`, `type`, `function`, `variable`, `property`, `operator`, `punctuation`, `tag`, and `attribute`. Joining token text must reproduce the line's `text` exactly. The client validates the role and reconstruction at the HTTP boundary before rendering ordinary Preact spans. Plain fallback uses one unstyled token. Shiki's TextMate scopes supply lexical categories; these are not compiler-resolved semantic symbols.

The server maps Shiki scope stacks to those stable roles. This mapping determines *what kind* of text a token is, while CSS determines *how it looks*. Keep the mapping in one server module and the palette in `design-tokens.css`. An unknown scope maps to `plain`. A later theme selector changes a data attribute on the client and swaps token variables; no API or cache invalidation is needed for a color change.

Keep `GET /api/projects/:id/diff` and its stale-revision contract. Add an optional validated `language` parameter only for a per-file override. Its value must be a Shiki bundled language ID or `text`. A small `GET /api/languages` endpoint returns bundled IDs and display names for the picker. The browser stores only its chosen ID. The server always verifies it against the installed bundle.

Tokenize bounded old and new file snapshots separately, then map old-side tokens to removed rows and new-side tokens to added and context rows by line number. This preserves multiline grammar state across distant hunks. Fetch only the snapshots needed for a selected card: `HEAD`/index for staged, index/working tree for unstaged, and working tree for untracked. Reuse the current root containment, no-shell Git calls, size limits, and stale checks. Never follow a working-tree path outside the approved root. If a snapshot cannot be read safely, decoded, or aligned exactly, return the valid plain diff instead of guessed highlighting. Cache tokens by content hash and language, independent of the browser theme.

## Edge cases and checks

- Renames and deletions need the correct old path and side; two layers of one path may have different tokenization and content.
- CRLF, tabs, empty lines, and missing final newlines must keep exact source text and line anchors.
- A multiline comment or string can begin before a visible hunk; full-side tokenization must preserve that context.
- Language IDs and aliases do not uniquely identify every extension. The language picker resolves unknown or ambiguous cases, including C headers.
- Invalid UTF-8, symlinks, submodules, binary files, and large snapshots keep the current explicit fallback states. Unknown syntax scopes stay plain.
- The server bounds snapshot size and token count and verifies token reconstruction; the browser validates the response again.
- Browser QA should compare TypeScript and C diffs, a multiline comment across hunks, plain-text fallback, override persistence, and all four responsive viewports. Real-device touch remains a separate check.

The main Shiki package contains all bundled grammar loaders as lazy imports; preloading every grammar is discouraged. It exposes tokens and grammar scope explanations for custom rendering. [Bundles](https://shiki.style/guide/bundles), [usage](https://shiki.style/guide/install), [languages](https://shiki.style/languages), [performance](https://shiki.style/guide/best-performance).

## Feedback checkpoint

The response now carries syntax roles, while the frontend owns all styling. All bundled languages are available on demand, with a picker for ambiguous files. Once this shape is agreed, the smallest implementation slice is syntax coloring plus the language picker; a theme selector can follow without changing the API.
