# Syntax highlighting

Source text uses stable lexical roles; frontend [design tokens](../src/client/design-tokens.css)
choose colors and font treatment. Responses contain source text and roles, with no HTML, CSS or
theme values. Changing [themes](theme-settings-slice-proposal.md) needs no new diff request.
TextMate scopes describe lexical categories, not compiler-resolved symbols; unknown scopes stay
plain.

The server uses Shiki's full bundle, reusing a highlighter and loading grammars on demand. Filename,
extension and known aliases provide automatic detection. The language picker offers Auto detect,
Plain text and bundled grammars, resolving ambiguous cases such as C headers and unknown extensions.
Overrides are saved per project/path; only an installed grammar ID or plain text is accepted.
[syntax.ts](../src/server/syntax.ts) owns detection and role mapping.

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

[diff-syntax.ts](../src/server/diff-syntax.ts) owns full-side decoration and fallback.
[shared/api.ts](../src/shared/api.ts) owns wire types, allowed roles and per-line/aggregate
validation limits. Aggregate overflow is rejected before parsing another diff token batch. Syntax
validation preserves separate hunk, side, newline and [word-span](diff-fidelity-slice-proposal.md)
checks. Highlighter and grammar reuse do not create a source-result cache.

## Verification

[Syntax tests](../src/server/diff-syntax.test.ts), [Git-diff tests](../src/server/git-diff.test.ts)
and [response-parser tests](../src/shared/api.test.ts) guard multiline context, unavailable or
mismatched sources, language validation, exact reconstruction and bounds. Browser checks cover
highlighting, picker persistence, wrapping and contained scrolling in Files and both diff sources.

The [phone](../qa/screenshots/syntax-c-diff/mobile.png),
[tablet portrait](../qa/screenshots/syntax-c-diff/tablet-portrait.png),
[tablet landscape](../qa/screenshots/syntax-c-diff/tablet-landscape.png) and
[desktop](../qa/screenshots/syntax-c-diff/desktop.png) milestone captures were inspected.
Real-device selection and touch remain unverified.
