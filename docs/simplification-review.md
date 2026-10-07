# Simplification and readability review

Status: S01–S07 accepted; documentation pass complete. S08–S23 remain findings for individual review
and small implementation steps.

Reviewed: 2026-10-06, against `85c6d63`. The checkout was clean before this research. The previous
[maintenance pass](maintenance-plan.md) remains closed.

## Purpose and review boundary

Simplify the existing app without losing its behavior: remove repeated code and specifications,
improve domain organization and shared contracts, and retire unnecessary compatibility for this
unreleased, single-user app. Review findings individually; accept, narrow, defer, or reject each
before acting. The maintainer approved the documentation pass and its completed changes. Further
changes follow the separate review and commit-approval rule in [AGENTS.md](../AGENTS.md).

The review covered client views and state owners, server reads and parsers, shared wire contracts,
persistence and backups, documentation, and QA support. Three focused investigations covered the
client, server/shared code, and documentation/QA; the parent cross-checked the evidence, callers,
tests, and overlapping recommendations. Code line references below describe the reviewed baseline;
application source is unchanged by the documentation pass. They are investigation evidence, not a
second specification of the code.

## Review queue

The remaining code and QA items are unreviewed. Risk describes implementation risk, not defect
severity. The proposed slices are deliberately smaller than a wholesale rewrite. Documentation
dispositions follow the queue.

| ID  | Finding                                                        | Area              | Risk       |
| --- | -------------------------------------------------------------- | ----------------- | ---------- |
| S08 | Retire the obsolete-storage deletion path after its cutover    | Compatibility     | Low        |
| S09 | Align stored folder validation with navigable folder paths     | Shared boundaries | Medium     |
| S10 | Give Search one query contract across its boundaries           | Shared boundaries | Medium     |
| S11 | Require one complete working-copy snapshot for every diff read | Shared/API        | Medium     |
| S12 | Share diff-request fields and existing language query parsing  | Shared/API        | Low        |
| S13 | Share supported media metadata between server and parser       | Shared/API        | Low        |
| S14 | Share text classification while retaining source-read policies | Server            | Medium     |
| S15 | Separate pure diff parsing from working-copy orchestration     | Server            | Low        |
| S16 | Share the Git raw-record parser                                | Server            | Medium     |
| S17 | Simplify media inspection and result mapping                   | Server            | Medium     |
| S18 | Share repeated headings and selected working-file wiring       | Client            | Medium     |
| S19 | Resolve diff-row feedback side in one place                    | Client            | Low–medium |
| S20 | Group identical Files/diff code-pane CSS                       | Client/styles     | Low–medium |
| S21 | Reuse the existing loading-state type                          | Client/types      | Low        |
| S22 | Share QA dimensions without changing emulation options         | QA                | Medium     |
| S23 | Reuse existing Git fixture helpers in older QA callers         | QA                | Low–medium |

## Completed documentation items

The maintainer authorized this documentation-only slice on 2026-10-06 and accepted it on 2026-10-07.
Original investigation details are superseded by the current records below.

| ID  | Result                                                                                                                                                                                                                                                                      | Owning records                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Corrected registration/restart prose and distinguished missing files from project/read failures.                                                                                                                                                                            | [Project access](stateless-project-access-plan.md), [Loading](loading-and-transition-polish.md), [Files](file-browser-slice-proposal.md), [Feedback](feedback-slice-proposal.md)        |
| S02 | Removed migration/import promises and stale delivery states. Current-format validation and the deliberate reset remain explicit; QA describes deletion and current-format coverage accurately.                                                                              | [Local data](independent-tabs-and-pwa-proposal.md#local-data-and-backups), [Formatting](formatting-workflow.md), [closed plans](initial-implementation-plan.md), [QA](qa-workflow.md)   |
| S03 | Reduced the initial plan to purpose, enduring choices, closure, and optional backlog; kept incoming closure/backlog anchors.                                                                                                                                                | [Initial plan](initial-implementation-plan.md)                                                                                                                                          |
| S04 | Consolidated Navigation and Feedback, including phone entry, visible history, file and exact-fragment comments. Older follow-up files are short links with useful incoming anchors preserved. Search and font-loading follow-ups were folded into their domain records too. | [Navigation](navigation-and-url-history-slice-proposal.md), [Feedback](feedback-slice-proposal.md), [Search](search-slice-proposal.md), [Typography](code-typography-slice-proposal.md) |
| S05 | Replaced copied schemas, catalogs, protection/cache budgets, route inventories, and private walkthroughs with source links and semantic rationale. Retained meaningful product tradeoffs and measured evidence.                                                             | [Behavior records](README.md#behavior-records), [read boundaries](git-read-boundaries.md)                                                                                               |
| S06 | Made the map a concise navigation/ownership guide with a lifetime table. Defined one owner per contract and removed repeated stateless correction preambles.                                                                                                                | [Documentation map](README.md), [conventions](engineering-conventions.md#documentation-and-verification), [AGENTS.md](../AGENTS.md)                                                     |
| S07 | Replaced QA execution history and duplicated feature assertions with a runnable catalog, fixture setup, capture procedure, and device limits. Evidence stays with its domain.                                                                                               | [QA workflow](qa-workflow.md)                                                                                                                                                           |

Existing filenames remain stable. The documentation slice changed no screenshot assets, application
source, or QA scripts, including the stale `legacy` variable name noted in S02; renaming it was
outside that slice. No code finding or optional feature was implemented by it.

## Compatibility and shared boundaries

### S08 — Retire the obsolete-storage deletion path after its cutover

**Evidence:** [storage.ts](../src/client/storage.ts), lines 128–152, enumerates historical key names
and scans localStorage whenever workspace data is read. Both project connection and backup export
call that reader. Old comment/backup readers and migrations are already gone; this is deletion-only
cutover machinery. [Storage tests](../src/client/storage.test.ts), lines 63–100, and
[tab QA](../qa/check-tabs.ts), lines 159–198, specifically protect that one-time historical reset.

**Proposed slice:** once the maintainer's relevant browser origins have loaded the cutover, remove
the obsolete-key sweep and its retirement-specific checks. Old keys would then be ignored rather
than deleted. Confirm that retirement condition during review; it has not been established by this
audit. Preserve current namespaces, strict current-format parsing, unrelated settings, and storage
denial behavior. Run storage/backup tests and tab QA. This does not justify removing format versions
or accepting old imports.

### S09 — Align stored folder validation with navigable folder paths

**Evidence:** [storage.ts](../src/client/storage.ts), lines 102–125, checks only type, length, and
NUL for saved root-relative recents/session paths. [Navigation](../src/client/navigation.ts), lines
38–42, rejects absolute paths and empty/dot/traversal segments. A read-only probe confirmed that
`../escape`, `/absolute`, `safe//child`, and `safe/` pass both storage readers but produce invalid
Changes routes. Host containment still prevents reads outside the approved root.

Relative-path checks also recur in [shared API parsing](../src/shared/api.ts), lines 169–181,
[Git paths](../src/shared/git.ts), lines 72–85, file anchors, and the working-file boundary.

**Proposed slice:** first share a canonical root-relative folder predicate between storage and
navigation, preserving `""` for the approved root. Then assess a shared syntactic base for the other
parsers with explicit domain policy. Preserve server filesystem checks, `.git` restrictions,
platform handling, literal unusual filenames, and permissive relative rename origins where Git
requires them. Cover malformed stored paths, root restoration, valid Unicode/names, and route
round-trips. Do not replace every path boundary with one unconditional validator.

### S10 — Give Search one query contract across its boundaries

**Evidence:** query rules repeat in [server Search](../src/server/search.ts), lines 47–53,
[response parsing](../src/shared/api.ts), lines 348–354, [navigation](../src/client/navigation.ts),
lines 51–52, and [App](../src/client/App.tsx), lines 506–540. The same limit recurs in
[SearchView](../src/client/SearchView.tsx), line 63, selected-code eligibility, and selection
actions. A read-only probe confirmed that `term�` is accepted by the server query validator but
rejected by the corresponding URL parser.

**Proposed slice:** agree one browser-safe query contract with normalization, length, and
single-line checks, and reuse its limit/predicates at each boundary. Decide how a literal
replacement character differs from malformed URL decoding; do not silently narrow valid literal
searches. Preserve fixed, case-sensitive search and the distinction between trimmed Search input and
exact comment fragments. The repeated submit/navigation commands can then be simplified if their
intentional cleanup differs explicitly. Test route/request round-trips, malformed encoding,
whitespace, Unicode, boundary lengths, and repeat-query refresh; run selected-code Search QA.

### S11 — Require one complete working-copy snapshot for every diff read

**Evidence:** [individual API reads](../src/server/api.ts), lines 312–355, accept an optional
`changeToken` and carry conditional freshness checks. [client/api.ts](../src/client/api.ts), lines
131–145, exposes that weaker signature. Batches require both tokens, and their deferred singleton
fallback already passes both. [Feedback checking](../src/client/feedback-transactions.ts), lines
88–109, fetches latest status but passes only its revision to individual diffs.

**Proposed slice:** share a required revision/change-token snapshot contract, pass it from feedback,
and remove the optional-token branches. Share the repeated token predicate in this slice. Keep the
individual route: oversized/deferred batch results still need it. Preserve before/after checks,
batch-wide invalidation, exact anchors, and retry on edits. Verify batch/status/feedback tests,
including an edit that changes content while porcelain status stays the same. This is an active
weaker contract, not dormant compatibility that can simply be deleted.

### S12 — Share diff-request fields and existing language query parsing

**Evidence:** [commit batch requests](../src/shared/commit-diff-batch.ts), lines 18–27, and
[change batch requests](../src/shared/change-diff-batch.ts), lines 43–59, repeat path and nullable
language parsing. Change-layer guards recur in shared status parsing, change requests, HTTP routes,
and navigation. [requestedLanguage](../src/server/api.ts), lines 107–112, already exists, while
Files and individual Changes repeat it at lines 274–279 and 323–328.

**Proposed slice:** share the named path/language field parser and change-layer guard; reuse the
HTTP language helper. Keep wrapper-specific allowed-field checks, identities, and server-side Shiki
support validation. Reject duplicate/unknown fields as today. Run shared batch parser and API tests
for unusual paths, null/plain/highlighted language choices, and invalid IDs. A general object-schema
framework would add complexity without a demonstrated need.

### S13 — Share supported media metadata between server and response parser

**Evidence:** [shared API parsing](../src/shared/api.ts), lines 259–284, repeats MIME sets and
image/audio/video byte budgets from [image-types.ts](../src/server/image-types.ts), lines 6–20, and
[audio-video-types.ts](../src/server/audio-video-types.ts), lines 4–22. Adding a format requires
coordinating those definitions. Current descriptor types allow arbitrary MIME strings internally.

**Proposed slice:** introduce browser-safe kind/MIME/extension/limit metadata and precise descriptor
types, deriving parser checks and extension discovery from it. Keep header sniffing, file/object
reads, versions, raw security headers, and streaming server-side. Preserve all supported aliases,
case-insensitive extensions, budgets, and raw URL validation. Verify parser acceptance/rejection,
media APIs, and stateless resources; check that client imports introduce no server dependencies.

## Server organization and mechanisms

### S14 — Share text classification while retaining source-read policies

**Evidence:** [Files](../src/server/project-files.ts), lines 33–34 and 250–282, repeats text
budgets, fatal UTF-8 decoding, NUL classification, final-newline handling, and line limits already
present in [working-text.ts](../src/server/working-text.ts), lines 5–33.
[git-diff.ts](../src/server/git-diff.ts), lines 201–207, contains another bounded decoder.

**Proposed slice:** share source-text budgets and decoding/classification in a neutrally named text
owner. Keep Files display conversion and each reader's errors/growth policy separate. Files
normalizes CRLF; diff anchors preserve exact CRLF. Syntax source decoding currently differs from
display line-count classification, so retain those entrypoint semantics. Do not blindly replace the
Files reader with `readWorkingContent`. Verify empty/final-newline/CRLF/invalid UTF-8/NUL inputs,
exact limits, growth, missing-file errors, and existing file/diff/statistics tests.

### S15 — Separate pure diff parsing from working-copy orchestration

**Evidence:** [git-diff.ts](../src/server/git-diff.ts), lines 25–190, owns pure patch/content
construction alongside working-copy source reads.
[Historical inspection](../src/server/git-history.ts), line 26, imports those constructors and
decoding from this working-copy module.

**Proposed slice:** move pure diff constructors into a focused diff parser/content module, with
decoding in S14's text owner. Keep working-copy source resolution in `git-diff.ts`. Preserve word
detail, hunk completeness, source text, no-newline markers, and result variants. Verify existing
working and root/parent historical diff tests. This is an organization improvement with no wire
format or runtime-policy change; its payoff is dependency clarity, not a smaller line count.

### S16 — Share the Git raw-record parser

**Evidence:** [historical inventory](../src/server/git-history.ts), lines 195–224, and
[change statistics](../src/server/change-stats.ts), lines 43–75, both parse NUL records, modes,
object IDs, status, rename scores, and one/two paths. The adjacent numeric format already has a
shared [numstat reader](../src/server/git-numstat.ts).

**Proposed slice:** a server-local raw-record reader returning validated fields and the next index.
Keep subtree clipping, absent-side interpretation, conflicts, aggregation, and raw/numstat origin
matching with callers. Historical inventory excludes `U`; statistics accepts it. Preserve zero IDs,
SHA-1/SHA-256, literal filenames, and renames crossing a selected subtree. Test malformed/incomplete
records, object formats, scores, and existing historical/scoped statistics cases. Review separately
because a shared parser can accidentally broaden domain input.

### S17 — Simplify media inspection and result mapping

**Evidence:** [project-files.ts](../src/server/project-files.ts), lines 84–166, repeats image and
audio/video inspection, then repeats conversion to Files results at lines 218–246. Its
`WorkingImage` type also represents audio/video. [media.ts](../src/server/media.ts), lines 104–207,
repeats ready/unavailable decoration and source/type branching; `ImageSource` likewise serves all
media.

**Proposed slices:** first use neutral media names/descriptors and share Files result mapping. Then
assess a common side-description flow built on S13's metadata. Keep image headers/buffering,
audio/video streaming, source versions, and descriptor transfer distinct. Preserve current Git
audio/video inspection policy, which differs from working-file header inspection. Verify media
Old/New sources, scoped renames/deletions, historical blobs, HEAD/ranges, stale versions, and
cleanup. Avoid a polymorphic media framework.

## Client presentation and types

### S18 — Share repeated headings and selected working-file wiring

**Evidence:** [GitHeading](../src/client/GitHeading.tsx), lines 24–39,
[Changes](../src/client/ChangesView.tsx), line 235, and Search/Files in
[App](../src/client/App.tsx), lines 955–1014, repeat heading/back/control presentation. App also
repeats keyed FileViewer setup at lines 978–988 and 1027–1037.

**Proposed slices:** share a presentation-only heading with caller-supplied controls; separately
render the selected working file once. Keep domain commands, Search's existing control visibility,
titles/empty states, route-derived targets, and project/path keys. Preserve remount, selection,
feedback, and loading behavior. Run Files/Search/navigation/loading QA and inspect four-size
captures. The evidence justifies these extractions; App's size alone does not justify a broad split.

### S19 — Resolve diff-row feedback side in one place

**Evidence:** [DiffBody](../src/client/DiffBody.tsx), lines 138 and 181, independently chooses Old
for removed rows or Old reattachment of context, otherwise New. Selection registration and floating
row actions must agree. Anchors/counts are rebuilt for gutters, selection, and row actions at lines
71–79, 133–143, and 185–198. [FileViewer](../src/client/FileViewer.tsx), line 185, already indexes
draft counts once.

**Proposed slice:** share the preferred-side rule first; consider a per-card count index afterward
if it clarifies the row code. Keep per-side gutter counts distinct from combined Old/New row counts.
Preserve Old context reattachment, exact anchors, historical inspection, and selection exclusion for
the no-newline annotation. Verify both action paths choose Old during Old reattachment, count
semantics, and existing feedback/selection QA. A persistent generic row model is unnecessary.

### S20 — Group identical Files/diff code-pane CSS

**Evidence:** [styles.css](../src/client/styles.css), lines 875–895 versus 1380–1420, repeats scroll
containment, content layout, row typography, and source colors. Wrap rules at lines 930–938 and
1555–1563 match; code declarations at 921–928 and 1498–1505 differ primarily in padding.

**Proposed slice:** group identical declarations using existing selectors. Keep source-specific
padding, borders, targets, signs, row backgrounds, and gutters in their owners. Preserve wrapping,
font choices, sticky gutters, native selection, and horizontal containment. Run CSS/token checks,
build, relevant Files/diff/selection checks, and inspect phone, both tablet orientations, and
desktop captures in both wrap modes and a large font. No new component or class protocol is needed.

### S21 — Reuse the existing loading-state type

**Evidence:** [LoadState](../src/client/load-state.ts), line 2, already defines the same union as
`GitLoad` in [git-browser.ts](../src/client/git-browser.ts), line 8, `HostRoot` in
[project-session.ts](../src/client/project-session.ts), line 15, `Status` in
[working-copy-review.ts](../src/client/working-copy-review.ts), line 8, and `FileState` in
[FileViewer](../src/client/FileViewer.tsx), line 17. [SearchState](../src/client/SearchView.tsx),
line 4, adds idle to that shape. `GitHistorySnapshot` is only a synonym for `GitHistoryPage`.

**Proposed slice:** use the existing union and express Search's idle extension explicitly. Remove
aliases that add no constraint; views can import the common presentation type directly. Preserve
each resource owner's freshness/cancellation/cache behavior. Type checking and formatting suffice
for an erased-type change; no new runtime tests are justified.

## QA support

### S22 — Share QA dimensions without changing emulation options

**Evidence:** standard sizes exist in [browser-support.ts](../qa/browser-support.ts), lines 23–33,
but recur in [capture](../qa/capture.ts), lines 36–41, [live changes](../qa/check-live-changes.ts),
lines 32–37, [Git](../qa/check-git.ts), lines 108–120,
[history controls](../qa/check-history-controls.ts), lines 50–63,
[project opening](../qa/project-opening-check.ts), lines 71–82,
[file feedback](../qa/check-file-feedback.ts), lines 80–85, and
[selected feedback](../qa/check-selected-feedback.ts), lines 101–115.

The browser options differ: shared tablets omit `isMobile`; capture/Git use mobile tablets, while
history controls uses a different landscape touch policy. Clipboard permissions, blocked service
workers, and pixel scale also belong to specific checks.

**Proposed slice:** share named dimensions and retain explicit scenario options. Preserve special
320px/breakpoint/keyboard cases locally. Compare effective configurations before/after and run
affected checks/captures. Blindly substituting shared profiles would change the evidence. A new
general QA runner is not needed.

### S23 — Reuse existing Git fixture helpers in older QA callers

**Evidence:** [test-support.ts](../src/test-support.ts), lines 6–23, already owns byte/text Git
execution with fixture identities; the new [count fixture](../qa/prepare-change-stats-fixture.ts)
uses it. Older wrappers remain in [inventory](../qa/prepare-inventory-fixture.ts), line 8,
[images](../qa/prepare-media-fixture.ts), line 8, [audio/video](../qa/prepare-media-av-fixture.ts),
line 6, and [live-change QA](../qa/check-live-changes.ts), line 28, with repeated commit identity
options.

**Proposed slice:** reuse the existing helper for ordinary owned fixtures, preserving overwrite
refusal, content, and cleanup. The [history fixture](../qa/prepare-git-fixture.ts), lines 9–22, has
deliberate authors/dates and should retain that specialization. Generate under fresh scratch roots
and verify observable status/source behavior plus affected feature checks. Do not introduce a
fixture manager or a general FFmpeg wrapper for this change.

## Smaller options and candidates to defer

These are validated repetitions with lower payoff. They are outside the main queue unless selected
during review; they can fit a related accepted slice without expanding it substantially.

- **Font catalog:** [code-fonts.ts](../src/client/code-fonts.ts), lines 1–102, repeats stylesheet
  URLs derivable from the 20 family names; [design-tokens.css](../src/client/design-tokens.css),
  lines 257–316, separately maps their IDs to family stacks. URL derivation is small. Consolidating
  CSS mapping needs a choice about runtime styles versus generated CSS and may cost more than it
  saves. Preserve persisted IDs, local System/Courier options, and CSS fallback tokens.
- **Theme application:** [bootstrap](../src/client/theme-bootstrap.ts), line 7, and
  [live preferences](../src/client/appearance-preferences.ts), lines 54–57, repeat root theme
  attributes/meta color. A focused DOM helper could share them; prepaint and layout-effect timing
  must remain distinct, with no Preact import into bootstrap.
- **Random IDs:** [comments](../src/client/comments.ts), lines 57–59, and
  [navigation](../src/client/use-navigation-history.ts), lines 16–19, repeat cryptographic 32-hex
  generation. A small client helper can remove it without coupling domains. Keep the format and
  `getRandomValues`; a UUID switch is a format change with no present benefit.
- **Storage key codecs:** [comments](../src/client/comments.ts), lines 228–242,
  [preferences](../src/client/storage.ts), lines 247–286, and [backup](../src/client/backup.ts),
  lines 177–209 and 239–255, repeat namespace/URI construction and reverse parsing. Named codecs
  could clarify ownership if persistence is edited. Preserve byte-for-byte keys, malformed-key
  rejection, Unicode/colon round-trips, and root-scoped export; no format migration is needed.
- **Small API remnants:** [readJsonBody](../src/server/api.ts), lines 39–41, has an unused default
  budget because both callers supply the batch budget. Files always sends/checks `source=worktree`
  at lines 268–273 despite having no alternate source. These can be assessed alongside a route
  cleanup; removing the source field is an API change, not a requirement of the parser refactor.

## Boundaries already doing useful work

Keep the shared cache, diff loader/frame, batch queue, generic validation helpers, Git execution,
checked working-file access, modal/language owners, and feedback transaction engine. They already
remove substantial repetition while keeping policy with each domain.

- Mutable working snapshots, immutable commits, pinned history, working Files, and feedback have
  different lifetimes. Repeated cancellation primitives do not justify one generic resource owner.
- Commit aggregate stats and per-change stats have different variants and meanings. Shared numeric
  guards and numstat reading already cover their common mechanism.
- Deferred batch singleton reads, selectable clipboard text, storage denial, media/raw fallbacks,
  microphone formats, SHA-256, root commits, shallow-parent recovery, and subtree renames remain
  supported functionality.
- Filesystem/descriptor identity rechecks and before/after freshness checks protect distinct phases
  of access. Removing them would lose invariants.
- Small preference/scroll/stats Maps differ from ResourceCache in read promotion and payload shape.
  Substitution would change policy for limited simplification gain.
- Browser emulation options and historical screenshots are evidence with specific meanings. Preserve
  those meanings when reorganizing QA.

## Reviewing the remaining findings

S21 is a small type consolidation; S09–S11 describe demonstrated contract differences. Select later
items by practical payoff. The queue is not approval to execute them all. Review S13 before S17, and
S14 before S15. S18 has two independently reviewable presentation extractions.

The [documentation map](README.md#what-belongs-where) now owns the organizing strategy. Further
accepted changes should update the existing domain record, keep disposition concise, and let Git
preserve superseded investigation detail.

## Evidence and limits

The original research baseline passed `bun run typecheck` and `bun test` (204 tests, 2,201
assertions, 40 files). Read-only probes reproduced S09's storage/navigation disagreement and S10's
Search/URL disagreement. Those checks preceded this documentation implementation; they are not newly
run gates.

This pass checked current contracts against source and compared retained decisions and evidence with
the earlier records. Delivery checks cover repository formatting, local file/heading links, script
arguments and fixture prerequisites, and whitespace. The documentation-only handoff records their
final result; it does not require app tests, builds or screenshots.

No application source, QA script, service, or asset changed, and no commit was created. No new
browser capture, real-device, microphone, clipboard, visual QA, performance measurement, or
exhaustive behavior-equivalence proof was performed. Historical evidence remains labeled with its
limits in the relevant record. The authorized pass ends here, with S08–S23 available for later
individual review.
