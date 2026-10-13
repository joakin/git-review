# Syntax highlighting

Source text uses stable lexical roles; frontend [design tokens](../apps/web/src/design-tokens.css)
choose colors and font treatment. Responses contain source text and roles, with no HTML, CSS or
theme values. Changing [themes](theme-settings-slice-proposal.md) needs no new diff request.
TextMate scopes describe lexical categories, not compiler-resolved symbols; unknown scopes stay
plain.

The server uses Shiki's full bundle, reusing a highlighter and loading grammars on demand. Filename,
extension and known aliases provide automatic detection. The language picker offers Auto detect,
Plain text and bundled grammars, resolving ambiguous cases such as C headers and unknown extensions.
Overrides are saved per project/path; only an installed grammar ID or plain text is accepted.
[syntax.ts](../apps/agent/src/syntax.ts) owns detection and role mapping.

Expanded Changes text cards use the compact variant of the language picker in their
[card header](diff-slice.md). Its closed display shows the detected language's readable name while
automatic mode remains selected; the native menu still offers an explicit Auto detect choice.
Loading uses Auto, and unknown or unavailable automatic highlighting uses Plain text. Manual choices
show their grammar name. The closed control has a fixed compact width, with long names truncated
visually and available in its tooltip and native menu, so neighboring actions stay aligned across
language choices. A keyboard focus indicator and accessible description identify automatic mode
without a second visible language label. Collapsed cards do not load diffs to detect a language, and
ready non-text cards have no picker. Files and historical Git use the standard language row.

## Source fidelity and fallback

Diffs tokenize bounded complete Old/New snapshots separately so multiline comments and strings
retain grammar context across distant hunks. Removed rows use Old tokens; added and context rows use
New tokens. Only needed sides are read. Rename/deletion sources and separate Git layers follow the
[diff comparison rules](diff-slice.md#sources-and-freshness); historical cards use immutable blobs.

Token text must reconstruct each displayed line exactly, including spaces, tabs, Unicode and CRLF.
If a side cannot be safely read, decoded or aligned, the valid plain diff remains usable. Plain-text
selection and unknown language detection require no syntax source read; empty diffs require none
either. Non-text states are handled before decoration. Files uses the same source-reconstruction
validation while retaining its display normalization.

[Changes context expansion](diff-slice.md#revealing-unchanged-context) independently needs both
comparison sources for gap validation, including Plain text. Those reads share lazy per-operation
snapshots with syntax decoration. Revealed chunks use complete-source grammar context; changing the
language replays the same ranges and preserves plain text if redecorating fails.

[diff-syntax.ts](../apps/agent/src/diff-syntax.ts) owns full-side decoration and fallback.
[shared/api.ts](../packages/shared/src/api.ts) owns wire types, allowed roles and per-line/aggregate
validation limits. Aggregate overflow is rejected before parsing another diff token batch. Syntax
validation preserves separate hunk, side, newline and [word-span](diff-fidelity-slice-proposal.md)
checks. Highlighter and grammar reuse do not create a source-result cache.

## Verification

[Syntax tests](../apps/agent/src/diff-syntax.test.ts),
[Git-diff tests](../apps/agent/src/git-diff.test.ts) and
[response-parser tests](../packages/shared/src/api.test.ts) guard multiline context, unavailable or
mismatched sources, language validation, exact reconstruction and bounds. Browser checks cover
highlighting, picker persistence, wrapping and contained scrolling in Files and both diff sources.

The [phone](../qa/screenshots/syntax-c-diff/mobile.png),
[tablet portrait](../qa/screenshots/syntax-c-diff/tablet-portrait.png),
[tablet landscape](../qa/screenshots/syntax-c-diff/tablet-landscape.png) and
[desktop](../qa/screenshots/syntax-c-diff/desktop.png) milestone captures were inspected.
Real-device selection and touch remain unverified.
