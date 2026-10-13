# App and code appearance

Settings offers independent application and code palettes, including before a project is selected.
The maintainer chose **Light / Dark / System** for the app and **Match app / Light / Dark** for
code. This permits dark controls with light source, or the reverse, without requesting new host
data.

## Current behavior

Changes apply immediately to the Settings preview and actual reading surfaces while preserving
navigation, drafts, card state, scroll, wrap, and [typography](code-typography-slice-proposal.md).
System follows device preference changes; explicit choices stay fixed. **Reset appearance** restores
Light + Match app independently of typography.

The preference is browser-local and follows updates from other tabs. Malformed or missing values
fall back to the default; unavailable storage does not disable the current in-memory choice.
[Local data and backups](independent-tabs-and-pwa-proposal.md#local-data-and-backups) owns format
support and transfer.

## Rendering rationale and source

[The preference parser and resolver](../apps/web/src/storage.ts) define the validated choices and
defaults. [Appearance preferences](../apps/web/src/appearance-preferences.ts) applies them for the
App lifetime. [The prepaint bootstrap](../apps/web/src/theme-bootstrap.ts) uses that same parser
before the main UI loads, preventing a saved dark preference from flashing light.

[Design tokens](../apps/web/src/design-tokens.css) own app and code palettes. Server syntax tokens
carry semantic roles rather than colors or CSS, so personal appearance needs no new Git or API
response. Code palettes cover syntax, diff backgrounds, word marks, selections, gutters, and quoted
source; native controls use the resolved app color scheme.

The browser theme-color metadata follows the chosen app palette. The manifest splash color remains
static because one manifest serves all personal choices.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies theme checks for independent palettes, System changes,
cross-tab updates, prepaint behavior, persistence, and narrow layouts.
[Dark app/dark code](../qa/screenshots/theme-dark-app-dark-code-review/mobile.png),
[dark app/light code](../qa/screenshots/theme-dark-app-light-code-review/mobile.png), and
[light app/dark code](../qa/screenshots/theme-light-app-dark-code-review/mobile.png) are inspected
historical four-size milestones. Physical-device contrast, native controls, and installed-app status
bar appearance still require device review.
