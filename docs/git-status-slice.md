# Git change inventory

Changes presents the current staged, unstaged, untracked and conflicted files. A path with both
staged and unstaged edits has separate entries. Renames, deletions, mode changes and submodules keep
their file metadata even when a text patch is unavailable. Non-Git folders open Files; an unborn
repository can show untracked files and staged additions.

The contextual list groups entries by layer and opens the corresponding [diff card](diff-slice.md).
File counts and [line totals](changes-line-counts-proposal.md) arrive with the inventory. Navigation
and responsive list/content behavior belong to the
[navigation record](navigation-and-url-history-slice-proposal.md).

## Sidebar section disclosures

Staged, Unstaged and Untracked have independent disclosure headings in the contextual list,
including the phone's Changes list. The shared chevron points down when expanded and right when
collapsed. The entire heading is a touch and keyboard target; its label, file count and line totals
stay visible while collapsed. Collapsing hides file rows, explanatory notes and empty messages from
both view and keyboard navigation. Conflicts retains its explicit, always-expanded presentation.

All three sections start expanded. The current project's working-copy review owns their state in tab
memory, preserving it through Refresh/Update, newly accepted files, diff navigation and switching
project views. Opening another project or reloading resets it. Disclosures do not change the URL,
load patches, toggle diff cards or limit Review all changes. This state adds no browser-storage or
agent API contract.

## Inventory contract

[git-status.ts](../apps/agent/src/git-status.ts) parses Git porcelain v2 with NUL delimiters,
preserving spaces, tabs and newlines in filenames. It validates record structure, status codes,
modes, hashes and paths before returning typed entries.
[shared/api.ts](../packages/shared/src/api.ts) defines and validates the public status and
lightweight check responses.

For a project inside a repository subfolder, the inventory is scoped to that subtree and paths are
relative to the selected folder. Rename origins use the same relative basis and can contain `../`
when outside the subtree; the diff reader checks the approved-root boundary before using them.
Clients select an inventory entry by layer and path, never by a supplied rename origin.

Two versions have different purposes: `revision` represents porcelain output, including branch
information; `changeToken` adds working-path metadata so ordinary edits behind unchanged status
codes can be detected. The [live-update record](live-change-detection-slice-proposal.md) explains
that signal's limits and explicit Update behavior.

Opening Changes and Refresh/Update receive metadata and required statistics together. Background
checks use the lightweight status mode without entries or statistics work. Diff and raw-media
validation also use lightweight inventory reads. The
[line-count record](changes-line-counts-proposal.md) owns count states and snapshot consistency;
[stateless project access](stateless-project-access-plan.md#project-contract-and-validation) owns
project identity and per-request resolution. Git reads use the
[shared read boundaries](git-read-boundaries.md).

## Verification

[Inventory tests](../apps/agent/src/git-status.test.ts) cover layers, renames, deletion, unusual
names, subfolder scope, unborn/non-Git states and edits that change the metadata token without
changing the porcelain revision. [API tests](../apps/agent/src/api.test.ts) cover project resolution
and status modes.

The [inventory](../qa/screenshots/git-inventory-fixture/mobile.png) and
[drawer](../qa/screenshots/git-inventory-fixture-drawer/mobile.png) milestone sets were inspected at
phone, tablet portrait, tablet landscape and desktop sizes. Real-device touch remains unverified.

[Sidebar browser QA](../qa/check-sidebar-sections.ts) checks independent pointer, emulated touch and
keyboard toggles, retained totals, hidden rows and notes, focus, Refresh, view navigation, Review
all, reload, empty groups, new inventory entries and project reset. It covers the four standard
viewports plus a 320 px phone. The [QA workflow](qa-workflow.md#focused-checks) owns invocation and
fixture setup.

| Sidebar state          | Phone                                                            | Tablet portrait                                                           | Tablet landscape                                                           | Desktop                                                           |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| All sections expanded  | [Image](../qa/screenshots/sidebar-sections-expanded/mobile.png)  | [Image](../qa/screenshots/sidebar-sections-expanded/tablet-portrait.png)  | [Image](../qa/screenshots/sidebar-sections-expanded/tablet-landscape.png)  | [Image](../qa/screenshots/sidebar-sections-expanded/desktop.png)  |
| Only Unstaged expanded | [Image](../qa/screenshots/sidebar-sections-collapsed/mobile.png) | [Image](../qa/screenshots/sidebar-sections-collapsed/tablet-portrait.png) | [Image](../qa/screenshots/sidebar-sections-collapsed/tablet-landscape.png) | [Image](../qa/screenshots/sidebar-sections-collapsed/desktop.png) |

These 2026-10-16 captures were inspected at all four sizes without page-wide horizontal overflow.
Physical iOS/Android touch remains unverified.
