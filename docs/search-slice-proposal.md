# Working-tree Search

Search uses ripgrep for Git and non-Git folders and opens matches in the shared
[working-tree file viewer](file-browser-slice-proposal.md). It searches current host contents; the
browser does not download or index the codebase.

## Current user flow

Submit a case-sensitive literal query in **Search**. Submission and direct links trim surrounding
whitespace through the same query contract. Search runs on submission, with grouped paths, line
numbers, and excerpts, plus explicit empty, loading, error, and truncated states. Refresh repeats
the query. It does not expand identifiers or add whole-word matching.

The URL owns the submitted query and selected result. Opening a result retains Search as its parent
list and scrolls the current working-tree file to the matching line. Back/Forward restores the
destination; cached matching results can be reused in the tab, while reload or a missing result set
reruns the query. The file reader remains the authority when source changes: show current content
and a stale-result notice rather than inventing a comment anchor. Files and Search share feedback
identity; the query is not part of a file anchor.

## Selected-code Search

Native selection within one logical code line offers **Search** beside
[Comment](feedback-slice-proposal.md#selected-fragments) when the fragment meets query validation.
Selections may cross syntax spans or wrapped visual lines, but not source rows, line numbers, dialog
text, or unrelated page content. Search trims surrounding whitespace and submits only the literal
fragment. Selecting removed or historical code still searches the current working tree.

The action preserves native handles and Copy. It follows page, code-pane, and visual-viewport
movement and disappears when its source is replaced, its selection leaves view, or it is dismissed.
On touch screens it prefers below the selection, with a header-adjacent fallback when needed; mouse
placement prefers above. This placement came from Android review, where the native selection menu
occupied the space above the text. Choosing the action performs Search; selection alone does not.

[Code selection](../src/client/code-selection.tsx) validates the native Range against its registered
source, and [selection actions](../src/client/CodeSelectionActions.tsx) own placement and
activation. The feedback record owns exact comment offsets, source identity, and reattachment.

## Boundaries and rationale

[The shared query contract](../src/shared/search-query.ts) owns normalization and validation across
navigation, submissions, selection actions, server reads, and response parsing. Literal Unicode,
including a typed replacement character, remains searchable. Malformed URL encoding is rejected
before decoding can replace bytes with that character; lone surrogates are rejected before URL
serialization can change the query. Responses must contain the normalized query.

[The server Search reader](../src/server/search.ts) owns executable discovery, fixed ripgrep
arguments, result/output/file limits, and timeout. It honors project ignore rules, includes hidden
source files, excludes Git control directories, and does not follow symlinks. JSON Lines are
validated before becoming [Search response values](../src/shared/api.ts); non-UTF-8 paths or lines
that Files cannot represent are skipped. Leading-dash queries remain literal because they are passed
as arguments to the fixed query option, without a shell.

A no-match exit is an empty result; timeout, invalid output, and subprocess failure are errors.
Result/output limits produce a truncated result. Cancellation prevents a superseded project or query
from replacing the current results. Ripgrep is a host dependency; executable overrides and run setup
belong in the [root README](../README.md).

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies Search, selected-code Search, and feedback checks.
[Search results](../qa/screenshots/search-results-first/mobile.png),
[deep file jumps](../qa/screenshots/search-deep-jump-review/mobile.png), and
[selected-code action placement](../qa/screenshots/selected-code-search-touch-placement/mobile.png)
are inspected historical milestones with the other three viewport sizes and manifests in their
folders. The maintainer confirmed selected-code Search on their phone, including the Android menu
placement correction. Dedicated iOS selection-menu, gesture, and keyboard checks remain unverified;
Chrome emulation does not establish those outcomes.
