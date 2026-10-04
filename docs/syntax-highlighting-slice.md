# Syntax highlighting in diff cards

Status: initial delivery implemented and committed. The M07 validator cleanup is accepted and
committed as `4eac2ec`; its maintenance verification is recorded below.
[Theme selection](theme-settings-slice-proposal.md) and
[word-level changes](diff-fidelity-slice-proposal.md) are also complete; moved-block detection
remains optional.

## User flow

Opening a source diff colors syntax inside the existing added, removed, and context rows. The
frontend chooses all colors and font treatments from `design-tokens.css`; the response contains no
theme name, CSS, HTML, or color values. Settings switches the app and code themes through CSS
variables without refetching a diff. Line numbers, diff backgrounds, wrapping, horizontal scrolling,
and collapse behavior retain their existing meaning.

The server uses Shiki's **full bundle**, so any language grammar it ships can be used, including C
and C++. It loads the needed grammar on demand into a reused highlighter. Detection uses the
filename, extension, and Shiki's known IDs and aliases. Each expanded card has a language picker
with `Auto detect`, `Plain text`, and all bundled languages. This resolves ambiguous names such as
`.h` and unknown extensions. The override is saved for this project and path in browser storage; the
client never sends an arbitrary grammar definition.

## Data and API

The text diff response has
`syntax: { kind: "highlighted", language: string } | { kind: "plain", reason: ... }`. Each displayed
line has `tokens: { text: string, role: SyntaxRole }[]`. Roles are the bounded set `plain`,
`comment`, `keyword`, `string`, `number`, `type`, `function`, `variable`, `property`, `operator`,
`punctuation`, `tag`, and `attribute`. Joining token text must reproduce the line's `text` exactly.
The client validates the role and reconstruction at the HTTP boundary before rendering ordinary
Preact spans. Plain fallback uses one unstyled token. Shiki's TextMate scopes supply lexical
categories; these are not compiler-resolved semantic symbols.

Files and diff responses use the same private syntax validators in
[shared/api.ts](../src/shared/api.ts), consolidated by
[M07](maintenance-plan.md#m07--reuse-syntax-validators). Highlighted language strings retain their
1–80-character wire bound; plain syntax retains its three reasons. Token arrays allow at most 20,000
tokens per line and 100,000 across the response. Each domain parser owns the aggregate limit, and
diff rejects aggregate overflow before validating another batch. Exact reconstruction preserves
spaces, tabs, Unicode, and CRLF source; diff side, newline, word-span, and hunk checks remain
separate. The [public-parser tests](../src/shared/api.test.ts) guard these boundaries.

The server maps Shiki scope stacks to those stable roles in `src/server/syntax.ts`. This mapping
determines _what kind_ of text a token is, while CSS determines _how it looks_. The palettes are in
`design-tokens.css`. An unknown scope maps to `plain`. The frontend theme selector swaps token
variables without changing the API.

`GET /api/projects/:id/diff` keeps its stale-revision contract and accepts an optional validated
`language` override: a Shiki bundled language ID or `text`. `GET /api/languages` returns bundled IDs
and display names for the picker. The browser stores only its chosen ID. The server verifies it
against the installed bundle.

The server tokenizes bounded old and new file snapshots separately, then maps old-side tokens to
removed rows and new-side tokens to added and context rows by line number. This preserves multiline
grammar state across distant hunks. It reads only the sides needed for a selected card: `HEAD`/index
for staged, index/working tree for unstaged, and working tree for untracked. It uses the existing
root containment, no-shell Git calls, size limits, and stale checks. It never follows a working-tree
path outside the approved root. If a snapshot cannot be read safely, decoded, or aligned exactly, it
returns the valid plain diff. Token result caching can be added if profiling shows a need; the
server currently reuses the highlighter and loaded grammars.

[withDiffSyntax](../src/server/diff-syntax.ts) accepts and returns the canonical text-diff variant.
Callers handle non-text outcomes before decoration. This contract permits syntax fields to change
while keeping the result text; it does not promise to preserve a caller's narrower syntax state.
[M08c](maintenance-plan.md#m08c--parser-and-decorator-contracts) records the contract and
no-read/fallback tests.

## Edge cases and checks

- Renames and deletions need the correct old path and side; two layers of one path may have
  different tokenization and content.
- CRLF, tabs, empty lines, and missing final newlines must keep exact source text and line anchors.
- A multiline comment or string can begin before a visible hunk; full-side tokenization must
  preserve that context.
- Language IDs and aliases do not uniquely identify every extension. The language picker resolves
  unknown or ambiguous cases, including C headers.
- Invalid UTF-8, symlinks, submodules, binary files, and large snapshots keep the current explicit
  fallback states. Unknown syntax scopes stay plain.
- The server bounds snapshot size and token count and verifies token reconstruction; the browser
  validates the response again.
- Tests cover C and TypeScript diffs, a multiline comment whose opening is outside the hunk,
  plain-text fallback, malformed token rejection, and override validation. Browser QA checks mobile
  picker persistence and horizontal containment.
  [Phone](../qa/screenshots/syntax-c-diff/mobile.png),
  [tablet portrait](../qa/screenshots/syntax-c-diff/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/syntax-c-diff/tablet-landscape.png), and
  [desktop](../qa/screenshots/syntax-c-diff/desktop.png) screenshots were captured and inspected.
  Real-device touch remains unverified.

The main Shiki package contains all bundled grammar loaders as lazy imports; preloading every
grammar is discouraged. It exposes tokens and grammar scope explanations for custom rendering.
[Bundles](https://shiki.style/guide/bundles), [usage](https://shiki.style/guide/install),
[languages](https://shiki.style/languages),
[performance](https://shiki.style/guide/best-performance).

## Maintenance verification — 2026-10-01

[M07](maintenance-plan.md#m07-handoff--2026-10-01) shares the existing syntax validators between
Files and diff response parsing. Sixteen public-parser tests (89 assertions) pass on both the
committed pre-refactor validators and the refactor, including exact per-line/aggregate limits and
source reconstruction. Strict gates, the full 115-test suite, and build pass. Phone working-copy and
Files browser checks pass highlighting, override persistence, wrapping, and contained scrolling;
historical Git checks pass at all four standard sizes plus 320 px. The separate review found no
remaining concern. No new screenshots were generated, all 451 tracked screenshot artifacts remain
unchanged, and real-device behavior was not reverified. The maintainer accepted the change and
explicitly approved committing it on 2026-10-01; it is committed as `4eac2ec`.
