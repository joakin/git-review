# Git change inventory

Changes presents the current staged, unstaged, untracked and conflicted files. A path with both
staged and unstaged edits has separate entries. Renames, deletions, mode changes and submodules keep
their file metadata even when a text patch is unavailable. Non-Git folders open Files; an unborn
repository can show untracked files and staged additions.

The contextual list groups entries by layer and opens the corresponding [diff card](diff-slice.md).
File counts and [line totals](changes-line-counts-proposal.md) arrive with the inventory. Navigation
and responsive list/content behavior belong to the
[navigation record](navigation-and-url-history-slice-proposal.md).

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
