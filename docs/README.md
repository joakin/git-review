# Documentation map

The initial implementation stage is complete and closed as of 2026-09-30. The maintainer confirmed the app is usable and useful. The subsequent [maintenance pass](maintenance-plan.md) is underway: M01 corrects scoped staged media sources and is accepted and committed as `ba62d1d`. M02 restores transcription API error translation and is accepted and committed as `cbe97fb`. M03 owns feedback check/copy transactions and is accepted and committed as `59cadf3`. M04 separates routine QA output from milestone captures and is accepted and committed as `0e55b07`. M05a removes confirmed obsolete UI/CSS remnants and is accepted and approved for commit as of 2026-10-01. M05b, navigation CSS consolidation, is the next authorized step. Product additions remain in the [optional backlog](initial-implementation-plan.md#remaining-roadmap). Start here to find current behavior, design decisions, and QA evidence. [AGENTS.md](../AGENTS.md) defines the collaboration and engineering rules; the root [README](../README.md) explains running the app and private HTTPS installation.

## Start here

- [Initial Implementation Plan](initial-implementation-plan.md): product scope, [stage closure](initial-implementation-plan.md#stage-closure--2026-09-30), and the [optional backlog](initial-implementation-plan.md#remaining-roadmap).
- [Maintenance plan](maintenance-plan.md): review findings, ordered cleanup slices, module contracts, validation, and review status; M01–M04 are committed, M05a is accepted, and M05b is next authorized.
- [Engineering conventions](engineering-conventions.md): validation boundaries, URL ownership, loading, caching, scroll behavior, and design tokens.
- [QA workflow](qa-workflow.md): focused behavior checks, browser fixtures, four-size captures, and optional further device checks.

The `*-proposal.md` filenames preserve links from earlier reviews. Their status and current behavior describe the accepted implementation; implementation sequences and dated QA evidence record how it was developed. Keep new work in a focused proposal until agreed, then update that document into a behavior record. Use the initial plan for the optional product backlog and the maintenance plan for the bounded cleanup pass. Historical implementation checkpoints describe completed development.

## Latest reviewed delivery

The latest reviewed maintenance slice is [M04: QA output ownership](maintenance-plan.md#m04--separate-qa-output-from-milestone-captures), accepted and committed as `0e55b07` on 2026-10-01. M01 is committed as `ba62d1d`, M02 as `cbe97fb`, and M03 as `59cadf3`. [M05a: obsolete UI/CSS removal](maintenance-plan.md#m05--remove-obsolete-ui-and-consolidate-layout-css) is accepted and approved for commit; M05b, navigation CSS consolidation, is next authorized. The maintenance plan owns their status and verification records.

The final implementation-stage feature, [Git tab: branches and commit inspection](git-history-slice-proposal.md), is implemented, reviewed, and committed as `22de40e` on 2026-09-30: a branch selector, commit list, full messages, and historical diff cards. The record includes API/data boundaries and four-size QA evidence.

The same commit includes the approved [line-total and time refinement](git-history-slice-proposal.md#proposed-follow-up-line-totals-and-time). It closes the implementation stage; the optional backlog has no assigned next item or priority.

## Behavior records

| Area | Documents |
| --- | --- |
| Host folders and containment | [Foundation](foundation-slice.md), [Files browser](file-browser-slice-proposal.md) |
| Git review | [Change inventory](git-status-slice.md), [diff cards](diff-slice.md), [syntax highlighting](syntax-highlighting-slice.md), [word detail](diff-fidelity-slice-proposal.md) |
| Git inspection | [Branches, paginated history, full commits, immutable diffs, and media](git-history-slice-proposal.md) |
| Feedback | [Line comments, draft checks, copy, and history](feedback-slice-proposal.md), [phone line action and Old/New semantics](phone-portrait-gutter-slice-proposal.md) |
| Files and Search | [Working-tree Files](file-browser-slice-proposal.md), [ripgrep Search](search-slice-proposal.md), [selected-code Search](selected-code-search-slice-proposal.md) |
| Media | [Images, SVG, audio/video, raw links, and Git sides](media-preview-slice-proposal.md) |
| Voice | [Local Handy dictation, caret insertion, and Retry](local-voice-comment-slice-proposal.md) |
| Appearance | [Typography](code-typography-slice-proposal.md), [20 Google code fonts](google-code-fonts-followup.md), [app and code themes](theme-settings-slice-proposal.md) |
| Navigation | [URLs, History API, menu/list/content, and breakpoints](navigation-and-url-history-slice-proposal.md) |
| Updates and loading | [Live change detection](live-change-detection-slice-proposal.md), [loading delay, diff cache, and route focus](loading-and-transition-polish.md) |
| Local data and installation | [Independent tabs, PWA, backups, and HTTPS](independent-tabs-and-pwa-proposal.md) |

## Where state belongs

| Lifetime | State | Code |
| --- | --- | --- |
| URL | Project, section, directory, selected file/diff, submitted Search query, file line, Git branch, and commit | [navigation.ts](../src/client/navigation.ts) |
| Per-tab session storage | Active project used when opening `/` without an explicit route | [storage.ts](../src/client/storage.ts) |
| Browser-local storage | Recent projects, drafts, copy history, wrapping, open-card preferences, language overrides, typography, and appearance | [storage.ts](../src/client/storage.ts), [comments.ts](../src/client/comments.ts), [backup.ts](../src/client/backup.ts) |
| Tab memory | Open project handle, loaded data, bounded diff and Git caches, historical collapsed cards, route scroll positions, transient UI, and pending audio | [App.tsx](../src/client/App.tsx), [diff-cache.ts](../src/client/diff-cache.ts), [git-browser.ts](../src/client/git-browser.ts), [CommitViewer.tsx](../src/client/CommitViewer.tsx), [VoiceComment.tsx](../src/client/VoiceComment.tsx) |
| Service worker | Offline fallback page only; API responses and raw media are not cached | [sw.ts](../src/client/sw.ts) |

## Current scope and limits

- Files reads the working tree. Comments anchor to working-copy Git diff lines; general file comments are not implemented. Git opens historical commit comparisons with line information and media; historical comments, file-specific history, and a full old-tree browser remain optional later work.
- Draft checking requires the same side, line, source text, and neighboring context. Outdated drafts need explicit reattachment; automatic relocation is not implemented.
- Recent projects exist; recent-file history is optional future work. Diff payloads are cached only within the current tab and disappear on reload.
- Local data belongs to one browser origin. It does not sync between devices, and simultaneous draft edits in two tabs on the same project have no conflict handling. The PWA record describes backup transfer.
- Maintainer review has covered phone, tablet, and desktop navigation, phone dictation, selected-code Search, and phone installation. Dedicated iOS, interruption, and larger-project performance checks remain optional and unverified. Dated browser captures are evidence for the recorded milestone, not a claim of real-device testing.
