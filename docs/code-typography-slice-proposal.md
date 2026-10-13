# Code typography

Typography is available in Settings before or after selecting a project. It applies immediately to
diff and Files source, Search excerpts, feedback quotes, and the live preview; interface labels and
file names keep their own typography. It does not change navigation, drafts, wrapping, or card
state.

## Current behavior

Choose a font size from the supported range and a local or Google monospace family. **Reset
typography** restores the local default independently of
[appearance](theme-settings-slice-proposal.md). The
[storage parser and defaults](../apps/web/src/storage.ts) define accepted sizes and values;
[the font catalog](../apps/web/src/code-fonts.ts) defines the choices, labels, and stylesheet URLs.

Settings and code surfaces share the selected preference. The
[appearance preferences owner](../apps/web/src/appearance-preferences.ts) applies it across
navigation and follows changes from other tabs. Missing or malformed saved data falls back to the
default; storage failure leaves the current in-memory choice usable. Backup transfer and format
support belong in
[local data and backups](independent-tabs-and-pwa-proposal.md#local-data-and-backups).

## Font loading

System mono and Courier require no font request. Google families load their regular and bold
stylesheet with swap behavior, and every font stack ends in local monospace fallback. Offline or
failed font requests therefore retain readable code. Only those optional stylesheet and font-file
requests leave the host; repository content remains served locally.

Source code elements inherit the chosen family explicitly so the browser's default code font cannot
override it. Removing per-row separators keeps continuous code readable; hunk labels and
added/removed backgrounds retain their meaning. Largest-size code still wraps or scrolls inside its
pane instead of widening the page.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies typography checks for the actual source element, local
defaults without requests, downloaded fonts, blocked-request fallback, persistence, and narrow
layouts. [Typography in a diff](../qa/screenshots/code-typography-diff-review/mobile.png) is an
inspected historical four-size milestone. Font rendering and reading comfort can differ on physical
devices; browser emulation does not establish device-specific rendering.
