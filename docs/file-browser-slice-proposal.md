# Working-tree Files

Files reads the selected folder's current working tree, including folders without Git. Historical
commit comparisons belong to the [Git view](git-history-slice-proposal.md); a full old-tree browser
and recent-file history remain in the
[optional backlog](initial-implementation-plan.md#remaining-roadmap).

## Current user flow

Choose **Files** in the contextual list, browse immediate child folders with breadcrumbs, and select
a file. The [navigation record](navigation-and-url-history-slice-proposal.md) owns responsive
list/content behavior, direct links, and Back/Forward. The URL preserves the directory, selected
file, and optional line; the file's location bar remains visible while reading.

Text files show numbered source lines with syntax highlighting and a language override. Wrap keeps
code within the viewport; turning it off scrolls only the code pane, with line numbers still
visible. Empty files have an explicit empty state. Refresh keeps loaded same-file content visible
until the replacement arrives, while changing files never displays another file's content as the new
one.

Tap a text row and its Comment action, or activate its line-number button with the keyboard.
[Feedback](feedback-slice-proposal.md) owns working-tree anchors, draft markers, checking, and
export; [selected-fragment record](feedback-slice-proposal.md#selected-fragments) owns exact
fragment comments. Files and [Search](search-slice-proposal.md) share file-anchor identity.
Supported media uses [native previews and raw links](media-preview-slice-proposal.md). Binary,
symbolic-link, special-file, oversized, and unreadable inputs have explicit outcomes.

## Boundaries and rationale

The [file reader](../src/server/project-files.ts) owns directory ordering, entry/text limits, file
classification, CRLF display normalization, and syntax fallback. It includes hidden files and omits
Git control directories. Invalid UTF-8 and NUL-containing data are not rendered as source text.
[Shared response types and parsers](../src/shared/api.ts) define the wire format.

[Checked working-file access](working-file-boundaries.md) confines reads to the selected project and
approved root, rejects link traversal, and rechecks file and parent identity around bounded reads.
[Project resolution](stateless-project-access-plan.md#project-contract-and-validation) is
independent of file access. Project loss, canonical-path change, and access denial report
`project_not_found`, `project_changed`, or `forbidden`; they retain feedback for recovery. Only
file-level `file_not_found` means an absent file that may make its anchors outdated. Other read and
transport failures require Retry, so an offline host is never treated as deleted source.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies Files, navigation, and feedback checks.
[Git-worktree Files](../qa/screenshots/files-working-tree-first/mobile.png),
[non-Git Files](../qa/screenshots/files-nongit-first/mobile.png), and
[horizontal code scrolling](../qa/screenshots/files-horizontal-scroll-first/mobile.png) are
inspected historical milestones with tablet portrait, tablet landscape, desktop images, and
manifests in their folders. Their browser emulation does not establish physical-device gestures,
keyboard layout, or installed Android/iOS behavior.
