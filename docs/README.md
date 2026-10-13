# Documentation map

Start here for the current contract of the area you are changing. The app's initial implementation,
first maintenance pass, and [simplification pass](simplification-review.md) are closed. Optional
product work is in the [backlog](initial-implementation-plan.md#remaining-roadmap).

## What belongs where

| Record                                                                                                                                         | Responsibility                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Root README](../README.md)                                                                                                                    | Run, HTTPS installation, runtime prerequisites, and entrypoint commands.                  |
| [AGENTS.md](../AGENTS.md)                                                                                                                      | Collaboration, commit approval, and required delivery checks.                             |
| [Engineering conventions](engineering-conventions.md)                                                                                          | Principles that apply across domains, including documentation ownership.                  |
| Behavior records below                                                                                                                         | Current user behavior, stable contracts, non-obvious decisions, and selected evidence.    |
| [QA workflow](qa-workflow.md)                                                                                                                  | Runnable checks, fixture prerequisites, screenshot procedure, and evidence limits.        |
| [Initial plan](initial-implementation-plan.md), [maintenance closure](maintenance-plan.md), [simplification closure](simplification-review.md) | Scope, acceptance, stop boundaries, and optional backlog.                                 |
| Git                                                                                                                                            | Original proposals, implementation sequences, dated handoffs, and superseded definitions. |

The retained `*-proposal.md` filenames are link identities, not pending plans. Their current content
is authoritative where listed below; short follow-up records point to the domain that absorbed them.
New features can use a focused proposal until agreed, then fold the result into the owning behavior
record. Update the owner instead of adding correction banners or a second specification. Exact
types, route fields, supported-value lists, constants, and script assertions belong in code.

The [long diff performance investigation](long-diff-performance-investigation.md) records local
measurements and the reviewed render-isolation and CSS-containment implementations. Physical
iPad/Safari verification remains pending.

The [split host implementation plan](split-host-architecture-proposal.md) owns the agreed static
frontend/direct-agent architecture, URL plus canonical path ownership, and saved-feedback recovery.
It defines small review steps for feasibility, workspaces/artifacts, transport, state and backup
conversion, recovery, connection UI, and cloud release verification. Discovery is deferred and step
1 probe tooling and local simulation are prepared and verified; cloud/device feasibility remains
unverified. Current behavior remains with its owners below until each step lands. The retained
proposal path also holds the supporting architecture research.

The [context expansion closure](diff-context-expansion-proposal.md) links to the accepted Changes
behavior and its feedback, syntax and loading owners.

The [feedback check performance closure](feedback-check-performance-proposal.md) links the accepted
batch-check behavior, independent reviews, and measured work reduction.

The [application notifications record](application-notifications.md) owns shared bottom-centered
notices, modal layering and notification lifetimes.

The [multi-line feedback closure](multi-line-feedback-proposal.md) links the reviewed stages and
owning records. The Feedback behavior record owns consecutive multi-line comments in Files, Search
and working-copy diffs, including mixed Old/New selections.

## Behavior records

| Area                                  | Authoritative record                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application notifications             | [Shared notices, lifetimes and modal layering](application-notifications.md)                                                                                                                                             |
| Folder selection                      | [Picker and approved host root](foundation-slice.md)                                                                                                                                                                     |
| Project identity and restart behavior | [Stateless project contract](stateless-project-access-plan.md)                                                                                                                                                           |
| Changes                               | [Inventory](git-status-slice.md), [diff cards](diff-slice.md), [line counts](changes-line-counts-proposal.md), [live updates](live-change-detection-slice-proposal.md)                                                   |
| Diff rendering and loading            | [Syntax](syntax-highlighting-slice.md), [word detail](diff-fidelity-slice-proposal.md), [batching and bulk controls](diff-batching-and-bulk-controls-proposal.md), [loading and focus](loading-and-transition-polish.md) |
| Git inspection                        | [Branches, history, comparisons, and immutable lifetime](git-history-slice-proposal.md)                                                                                                                                  |
| Feedback                              | [Line/file/selection comments, reattachment, copy, history, and Undo](feedback-slice-proposal.md)                                                                                                                        |
| Files and Search                      | [Current working files](file-browser-slice-proposal.md), [literal and selected-code Search](search-slice-proposal.md)                                                                                                    |
| Media and voice                       | [Source-correct previews](media-preview-slice-proposal.md), [local dictation](local-voice-comment-slice-proposal.md)                                                                                                     |
| Appearance                            | [Typography and font loading](code-typography-slice-proposal.md), [app and code themes](theme-settings-slice-proposal.md)                                                                                                |
| Navigation                            | [URLs, responsive screens, and known Back/Forward history](navigation-and-url-history-slice-proposal.md)                                                                                                                 |
| Local data and installation           | [Independent tabs, browser storage, backups, and offline behavior](independent-tabs-and-pwa-proposal.md)                                                                                                                 |
| Read boundaries                       | [Git transport and source scope](git-read-boundaries.md), [checked working files and descriptors](working-file-boundaries.md)                                                                                            |
| Formatting                            | [Repository and staged-file workflow](formatting-workflow.md)                                                                                                                                                            |

## Where state belongs

This table describes lifetimes; the linked behavior records own the detailed policy.

| Lifetime                | State                                                                                                                                | Contract                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                     | Project relative to the current host root, section, directory, selected file/diff, submitted Search query, file line, Git ref/commit | [Navigation](navigation-and-url-history-slice-proposal.md)                                                                                                                            |
| Per-tab session storage | Bare-URL project restoration and the known navigation trail                                                                          | [Local data](independent-tabs-and-pwa-proposal.md), [history](navigation-and-url-history-slice-proposal.md)                                                                           |
| Browser-local storage   | Recents, drafts, exact copied history, and preferences                                                                               | [Local data](independent-tabs-and-pwa-proposal.md), [feedback](feedback-slice-proposal.md)                                                                                            |
| Tab memory              | Resolved project metadata, loaded snapshots, bounded caches, reading positions, transient UI, and pending audio                      | [Project access](stateless-project-access-plan.md), [loading](loading-and-transition-polish.md), [Git](git-history-slice-proposal.md), [voice](local-voice-comment-slice-proposal.md) |
| Server memory           | Configuration, optional bounded caches, and current subprocess/transcription work                                                    | [Project access](stateless-project-access-plan.md), [Git reads](git-read-boundaries.md)                                                                                               |
| Service worker          | Offline fallback page; live API responses and raw media remain uncached                                                              | [Installation](independent-tabs-and-pwa-proposal.md)                                                                                                                                  |

## Current scope and limits

The app reads host repositories without modifying them. Files, Search, and comments use the working
copy; Git inspects historical comparisons. Local review data belongs to a browser origin, has no
cross-device sync, and does not coordinate simultaneous draft edits in two tabs. The
[optional backlog](initial-implementation-plan.md#remaining-roadmap) owns further product ideas.

Historical captures establish their recorded milestone, not the current UI or physical-device
behavior. Each behavior record retains relevant evidence and its limits; the
[QA workflow](qa-workflow.md#real-device-checks) explains further device checks.
