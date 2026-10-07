# Initial implementation scope

Status: initial implementation complete and closed on 2026-09-30.

## Goal

Provide a read-only, host-served review app usable on phones, tablets, and desktop. Choose an
approved host folder, review working-copy changes or browse/search current files, write anchored
feedback, and copy it into an editing session. Inspect branches and commits without checking them
out. Keep drafts and preferences local to the browser.

## Decisions and constraints

- Host filesystem and Git objects supply repository data; the app does not write repository files.
- Bun serves, builds, and tests the TypeScript application; Preact and plain CSS provide the UI.
  [Package configuration](../package.json) owns current dependencies and commands.
- Local Handy transcription avoids an external inference service and per-request API cost. Typed
  comments remain available without the optional voice tools.
- URLs identify navigable destinations. Review data is browser-local, with no account or sync
  service. The current [behavior records](README.md#behavior-records) own those contracts.

Original engine comparisons, schemas, rollout sequences, and delivery logs are preserved in Git. Run
instructions belong in the [root README](../README.md); engineering and verification rules belong in
[AGENTS.md](../AGENTS.md), [conventions](engineering-conventions.md), and
[QA workflow](qa-workflow.md).

## Stage closure — 2026-09-30

The maintainer confirmed that the app is usable and useful and closed this stage. The final initial
feature baseline was `22de40e`, including Git inspection with line totals. Its
[Git evidence](git-history-slice-proposal.md#verification--metadata-refinement-2026-09-30) records
the accepted comparison/UI result and device limits. The subsequent
[maintenance pass](maintenance-plan.md) is also closed. No original implementation or acceptance
slice remains outstanding.

## Remaining roadmap

All items are optional future work, with no assigned order or deadline. Agree the smallest useful
slice under the collaboration rules before implementing a new feature.

- **Additional device and performance checks:** iOS selection/microphone behavior, clipboard and
  keyboard layouts, recording interruptions, large changes, and refreshes with drafts. Phone
  selected-code Search and dictation were confirmed by the maintainer; further checks remain
  unverified unless recorded in their behavior owner.
- **Recent files:** a bounded per-project recent-file list, with its own flow and persistence
  design.
- **Broader Git inspection:** file-specific history, complete historical trees, and historical
  comments.
- **Additional previews:** PDF previews. HTML preview is not planned.
- **Diff detail:** moved-block indicators if they justify their complexity.
- **Phone navigation gesture:** a list/content swipe only after real-device testing establishes
  compatibility with browser Back, code scrolling, and native selection.
