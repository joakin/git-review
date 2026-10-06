# Documentation map

The initial implementation stage is complete and closed as of 2026-09-30. The maintainer confirmed
the app is usable and useful. The subsequent [maintenance pass](maintenance-plan.md) is complete and
closed as of 2026-10-06; its plan records the outcome and stop boundary. Product additions remain in
the [optional backlog](initial-implementation-plan.md#remaining-roadmap). Start here to find current
behavior, design decisions, and QA evidence. [AGENTS.md](../AGENTS.md) defines the collaboration and
engineering rules; the root [README](../README.md) explains running the app and private HTTPS
installation.

## Start here

- [Initial Implementation Plan](initial-implementation-plan.md): product scope,
  [stage closure](initial-implementation-plan.md#stage-closure--2026-09-30), and the
  [optional backlog](initial-implementation-plan.md#remaining-roadmap).
- [Maintenance plan](maintenance-plan.md): completed pass, measurement results, and the stop
  boundary. Git preserves implementation and review history.
- [Diff batching and bulk card controls](diff-batching-and-bulk-controls-proposal.md): approved
  shared bounded loading for Changes and Git, followed by Expand all / Collapse all; Git batching
  accepted in both views; bulk controls are next.
- [Changes line counts](changes-line-counts-proposal.md): bundled file/layer statistics in the
  contextual list and collapsed/expanded headings; implemented and accepted on 2026-10-06.
- [Engineering conventions](engineering-conventions.md): reusable principles for module boundaries,
  types, state ownership, navigation, transactions, and documentation.
- [QA workflow](qa-workflow.md): focused behavior checks, browser fixtures, four-size captures, and
  optional further device checks.
- [Selected-code feedback proposal](selected-code-feedback-proposal.md): Comment action alongside
  Search, exact selected fragments and compatibility checks; accepted on 2026-10-05.
- [Formatting workflow](formatting-workflow.md): pinned formatter, repository-wide commands,
  staged-file hook, and verification record.

The `*-proposal.md` filenames preserve links from earlier reviews. Their status and current behavior
describe the accepted implementation; implementation sequences and dated QA evidence record how it
was developed. Keep new work in a focused proposal until agreed, then update that document into a
behavior record. Use the initial plan for the optional product backlog and the maintenance plan for
the bounded cleanup pass. Historical implementation checkpoints describe completed development.

## Behavior records

| Area                         | Documents                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host folders and containment | [Foundation](foundation-slice.md), [Files browser](file-browser-slice-proposal.md)                                                                                                                                         |
| Git review                   | [Change inventory](git-status-slice.md), [diff cards](diff-slice.md), [syntax highlighting](syntax-highlighting-slice.md), [word detail](diff-fidelity-slice-proposal.md)                                                  |
| Git inspection               | [Branches, paginated history, full commits, immutable diffs, and media](git-history-slice-proposal.md)                                                                                                                     |
| Feedback                     | [Line comments, draft checks, copy, and history](feedback-slice-proposal.md), [phone line action and Old/New semantics](phone-portrait-gutter-slice-proposal.md)                                                           |
| Files and Search             | [Working-tree Files](file-browser-slice-proposal.md), [ripgrep Search](search-slice-proposal.md), [selected-code Search](selected-code-search-slice-proposal.md), [selection comments](selected-code-feedback-proposal.md) |
| Media                        | [Images, SVG, audio/video, raw links, and Git sides](media-preview-slice-proposal.md)                                                                                                                                      |
| Voice                        | [Local Handy dictation, caret insertion, and Retry](local-voice-comment-slice-proposal.md)                                                                                                                                 |
| Appearance                   | [Typography](code-typography-slice-proposal.md), [20 Google code fonts](google-code-fonts-followup.md), [app and code themes](theme-settings-slice-proposal.md)                                                            |
| Navigation                   | [URLs, History API, menu/list/content, and breakpoints](navigation-and-url-history-slice-proposal.md)                                                                                                                      |
| Updates and loading          | [Live change detection](live-change-detection-slice-proposal.md), [loading delay, diff cache, and route focus](loading-and-transition-polish.md)                                                                           |
| Local data and installation  | [Independent tabs, PWA, backups, and HTTPS](independent-tabs-and-pwa-proposal.md)                                                                                                                                          |

## Where state belongs

| Lifetime                | State                                                                                                                                              | Code                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                     | Project, section, directory, selected file/diff, submitted Search query, file line, Git branch, and commit                                         | [navigation.ts](../src/client/navigation.ts)                                                                                                                                                                                                                                                                                                                                                                           |
| Per-tab session storage | Active project used when opening `/` without an explicit route                                                                                     | [storage.ts](../src/client/storage.ts)                                                                                                                                                                                                                                                                                                                                                                                 |
| Browser-local storage   | Recent projects, drafts, copy history, wrapping, open-card preferences, language overrides, typography, and appearance                             | [storage.ts](../src/client/storage.ts), [comments.ts](../src/client/comments.ts), [backup.ts](../src/client/backup.ts)                                                                                                                                                                                                                                                                                                 |
| Tab memory              | Open project handle, loaded data, bounded diff and Git caches, historical collapsed cards, route scroll positions, transient UI, and pending audio | [App.tsx](../src/client/App.tsx), [project-session.ts](../src/client/project-session.ts), [working-copy-review.ts](../src/client/working-copy-review.ts), [diff-cache.ts](../src/client/diff-cache.ts), [git-browser.ts](../src/client/git-browser.ts), [review-feedback.ts](../src/client/review-feedback.ts), [CommitViewer.tsx](../src/client/CommitViewer.tsx), [VoiceComment.tsx](../src/client/VoiceComment.tsx) |
| Server memory           | Bounded ready commit details and immutable line totals                                                                                             | [git-history.ts](../src/server/git-history.ts), [git-stats.ts](../src/server/git-stats.ts)                                                                                                                                                                                                                                                                                                                             |
| Service worker          | Offline fallback page only; API responses and raw media are not cached                                                                             | [sw.ts](../src/client/sw.ts)                                                                                                                                                                                                                                                                                                                                                                                           |

[Git read boundaries](git-read-boundaries.md) describe shared subprocess execution, repository
context and object access. Status, diff, history, statistics and media retain their parsers and
source/version policy. HTTP handlers continue to revalidate opened projects against the approved
root. [Checked working-file boundaries](working-file-boundaries.md) describe shared no-follow
opening, identity rechecks and descriptor lifetime for Files, diffs and media. Their callers retain
byte limits, decoding and content-version policy.

[ResourceCache](../src/shared/resource-cache.ts) owns the common memory-cache mechanism: LRU
promotion, replacement accounting, oversized-write rejection, removal, and eviction. The diff
adapter, Git browser and server commit reader own resource identities, freshness, and individual
budgets.

[The shared diff loader](../src/client/diff-loading.ts) owns keyed card state, request lifetime,
retry, and cache-first rendering. Working-copy and historical card adapters retain their resource
identities and response policies; Git and Changes use the bounded
[batch queue](../src/client/diff-batch-queue.ts) through [git-api.ts](../src/client/git-api.ts) and
[change-diff-api.ts](../src/client/change-diff-api.ts).
[LanguagePicker](../src/client/LanguagePicker.tsx) shares the control presentation, and
[language overrides](../src/client/language-override.ts) share validation and per-file persistence.

[The project/session owner](../src/client/project-session.ts) owns root connection, accepted project
handles, recents, and per-tab restoration. App supplies current URL identity and handles
opening/accepted events to initialize other domains. Storage remains the format and migration
boundary.

[Working-copy review](../src/client/working-copy-review.ts) owns the displayed Git snapshot,
including bundled [line counts](changes-line-counts-proposal.md), lightweight background update
checks, refresh, card preferences, and review-position restoration. App supplies current navigation
and modal pause policy, and retains one-time URL-selected card focus.

[Project picker](../src/client/ProjectPicker.tsx), [Files sidebar](../src/client/FilesSidebar.tsx),
and [Changes presentation](../src/client/ChangesView.tsx) render scoped values and consume explicit
commands. App owns the responsive shell and URL transitions; resource owners keep loading,
persistence, and review policy. These views add no wrapper or navigation state.

[Appearance preferences](../src/client/appearance-preferences.ts) owns live appearance and
typography for the App lifetime. Settings consumes values and change/reset commands; the storage
module remains the format boundary shared with backups and the prepaint theme bootstrap.

[The feedback owner](../src/client/review-feedback.ts) owns the loaded comment session and editor
behind scoped values and actions. App announces navigation and accepted project loads; the
transaction engine lives for the App lifetime, retaining any pending clipboard lease across project
switches. The comment module remains the persistence and anchor boundary.

[The shared modal hook](../src/client/modal.ts) owns browser presentation for mounted dialogs. Each
dialog's owner keeps its close action, saved data, and pending work; native dialog behavior supplies
focus handling.

## Current scope and limits

- Files reads the working tree. The
  [U03 follow-up](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files),
  accepted and committed as `7632b4d`, adds text-line feedback in Files and Search alongside
  working-copy Git diff comments. Whole-file/project notes remain outside this slice. Git opens
  historical commit comparisons with line information and media; historical comments, file-specific
  history, and a full old-tree browser remain optional later work.
- Draft checking requires the same side, line, source text, and neighboring context. Outdated drafts
  need explicit reattachment; automatic relocation is not implemented.
- Recent projects exist; recent-file history is optional future work. Diff payloads are cached only
  within the current tab and disappear on reload.
- Local data belongs to one browser origin. It does not sync between devices, and simultaneous draft
  edits in two tabs on the same project have no conflict handling. The PWA record describes backup
  transfer.
- Maintainer review has covered phone, tablet, and desktop navigation, phone dictation,
  selected-code Search, and phone installation. Dedicated iOS, interruption, and larger-project
  performance checks remain optional and unverified. Dated browser captures are evidence for the
  recorded milestone, not a claim of real-device testing.
