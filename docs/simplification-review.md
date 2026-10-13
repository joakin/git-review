# Simplification and readability review

Status: complete and closed on 2026-10-07. Every main-queue finding is resolved; S08 was assessed
and retained. Git preserves the original research against `85c6d63`, implementation stages, and
dated review evidence.

## Scope and authorization

This pass simplified the existing app without removing supported behavior: documentation ownership,
shared validation/types, domain boundaries, repeated presentation, media/text/Git mechanics, and QA
support. The maintainer approved the documentation changes and initial code slices, then explicitly
authorized autonomous execution of the remaining queue on 2026-10-07: validate each stage, obtain an
independent review, address valid feedback, commit, and continue. Each stage followed that process.
This authorization applied to this queue; the normal [commit-approval rule](../AGENTS.md) remains.

## Outcomes

| ID  | Disposition and owner                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Corrected project/restart and file/project failure descriptions in the [behavior records](README.md#behavior-records).                                                                      |
| S02 | Removed obsolete migration/import promises and stale delivery states; retained [current-format validation and reset behavior](independent-tabs-and-pwa-proposal.md#local-data-and-backups). |
| S03 | Reduced the [initial plan](initial-implementation-plan.md) to decisions, closure, and the optional backlog.                                                                                 |
| S04 | Consolidated accepted Navigation, Feedback, Search, and font-loading follow-ups into their [domain owners](README.md#behavior-records).                                                     |
| S05 | Replaced copied source definitions with links and semantic rationale under [documentation conventions](engineering-conventions.md#documentation-and-verification).                          |
| S06 | Established the [documentation map](README.md) and one owner per contract.                                                                                                                  |
| S07 | Reduced the [QA guide](qa-workflow.md) to runnable checks, prerequisites, captures, and evidence limits.                                                                                    |
| S08 | Retained scoped obsolete-storage deletion for [current-save capacity](independent-tabs-and-pwa-proposal.md#local-data-and-backups); see rationale below.                                    |
| S09 | Shared [navigable folder-path validation](../apps/web/src/navigation-path.ts) across URLs and stored metadata.                                                                              |
| S10 | Shared [normalized Search query rules](../packages/shared/src/search-query.ts) across UI, navigation, server, and responses.                                                                |
| S11 | Required the [complete working-copy snapshot](diff-batching-and-bulk-controls-proposal.md) for individual and batch diff reads.                                                             |
| S12 | Shared [diff-request fields](../packages/shared/src/diff-request.ts), layer validation, and existing language-query parsing.                                                                |
| S13 | Shared the [media catalog and correlated descriptor types](../packages/shared/src/media-types.ts).                                                                                          |
| S14 | Shared [exact source decoding/classification](../apps/agent/src/source-text.ts), preserving reader-specific growth, display, and error policies.                                            |
| S15 | Separated [pure diff construction](../apps/agent/src/diff-content.ts) from source-read orchestration.                                                                                       |
| S16 | Shared [Git raw-record mechanics](../apps/agent/src/git-raw.ts), retaining history/statistics policy at their boundaries.                                                                   |
| S17 | Simplified [media inspection and side construction](media-preview-slice-proposal.md) while preserving source, header, buffering, and streaming distinctions.                                |
| S18 | Shared [heading presentation](../apps/web/src/ContentHeading.tsx) and selected FileViewer construction, preserving controls, branch placement, remounts, and cleanup.                       |
| S19 | Shared [diff feedback side and per-card counts](../apps/web/src/DiffBody.tsx), preserving per-side gutters, combined row counts, and exact Old reattachment.                                |
| S20 | Grouped identical [Files/diff CSS](../apps/web/src/styles.css), preserving source-specific layout and mobile overrides.                                                                     |
| S21 | Reused the existing [loading-state type](../apps/web/src/load-state.ts) without runtime changes.                                                                                            |
| S22 | Shared [named QA dimensions](../qa/browser-support.ts) while preserving configured omissions and effective browser options.                                                                 |
| S23 | Reused [Git fixture execution](../qa/test-support.ts), preserving content, overwrite refusal, cleanup, and specialized history/FFmpeg behavior.                                             |

S08 retirement depended on a cutover that could not be established for every browser origin. The
existing sweep also frees quota: a bounded Storage probe showed a current comment write failing
before cleanup and persisting afterward. Keep the small sweep without restoring old-format readers,
migrations, or imports. A replacement retry/lifecycle abstraction would add complexity. The
[local-data record](independent-tabs-and-pwa-proposal.md#local-data-and-backups) owns this decision.

## Verification and limits

Final formatting, all five native TypeScript configurations, static CSS/QA checks, the client build,
local documentation links, whitespace, and the full unit/integration suite passed. The suite passed
256 tests with 3,239 assertions across 48 files. Independent reviews and focused regressions covered
boundary failures, exact source text and anchors, snapshot races, media source/stream behavior,
route lifetimes, and feedback transactions.

Isolated Chrome checks covered Files/Search/navigation/loading, selections and feedback, Git/media,
wrapping/typography, live updates, history controls, and clean Git/plain-file roots. All 63
configured and effective QA-option cases were unchanged. Fresh fixture status, HEAD/index trees,
identities, working bytes/modes, overwrite refusal, and cleanup matched the pre-refactor evidence.

The four-size heading sets for [Files](../qa/screenshots/simplification-s18-files/mobile.png),
[Search](../qa/screenshots/simplification-s18-search/mobile.png),
[Changes](../qa/screenshots/simplification-s18-changes/mobile.png), and
[Git](../qa/screenshots/simplification-s18-git/mobile.png) were captured and inspected. Large-font
[Files wrapped](../qa/screenshots/simplification-s20-files-wrap/mobile.png),
[Files unwrapped](../qa/screenshots/simplification-s20-files-nowrap/mobile.png),
[diff wrapped](../qa/screenshots/simplification-s20-diff-wrap/mobile.png), and
[diff unwrapped](../qa/screenshots/simplification-s20-diff-nowrap/mobile.png) were also inspected at
phone, both tablet orientations, and desktop. Computed CSS properties matched across sixteen
code-pane states. Browser emulation does not establish physical-device gestures, playback,
clipboard, or microphone behavior; those were not newly verified. No new performance measurement or
exhaustive behavior-equivalence proof is claimed.

## Stop boundary

The S01–S23 queue is closed. Keep the app's supported read boundaries, distinct resource lifetimes,
recovery paths, and current-format validation. The unselected font catalog, theme application,
random-ID, storage-key codec, and small API-remnant candidates create no further work. The
[optional product roadmap](initial-implementation-plan.md#remaining-roadmap) remains optional; start
another maintenance or feature slice only when the maintainer requests it.

The [documentation map](README.md#what-belongs-where) owns the organizing strategy. Future accepted
changes update their existing domain owner; source owns exact types, schemas, catalogs, constants,
and assertions, and Git owns superseded investigation detail.
