# Simplification and readability review

Status: implementation in progress under the maintainer’s autonomous authorization of 2026-10-07.
Completed and retained dispositions are below; the remaining queue is explicit.

Reviewed: 2026-10-06, against `85c6d63`. The checkout was clean before this research. The previous
[maintenance pass](maintenance-plan.md) remains closed.

## Purpose and review boundary

Simplify the existing app without losing its behavior: remove repeated code and specifications,
improve domain organization and shared contracts, and retire unnecessary compatibility for this
unreleased, single-user app. Review findings individually; accept, narrow, defer, or reject each
before acting. The maintainer approved the documentation pass and its completed changes. On
2026-10-07, the maintainer authorized executing the remaining queue autonomously: validate each
finding, implement valid stages, obtain an independent review, address valid feedback, then commit
and continue. This explicit authorization supplies the commit approval required by
[AGENTS.md](../AGENTS.md) for this queue; it does not extend to optional product features.

The review covered client views and state owners, server reads and parsers, shared wire contracts,
persistence and backups, documentation, and QA support. Three focused investigations covered the
client, server/shared code, and documentation/QA; the parent cross-checked the evidence, callers,
tests, and overlapping recommendations. Code line references below describe the reviewed baseline;
application source is unchanged by the documentation pass. They are investigation evidence, not a
second specification of the code.

## Review queue

The remaining code and QA items await validity checks and independent implementation review. Risk
describes implementation risk, not defect severity. The proposed slices are deliberately smaller
than a wholesale rewrite. Completed documentation, accepted code changes, and the current review
slice are recorded below.

| ID  | Finding | Area | Risk |
| --- | ------- | ---- | ---- |

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

## Completed code items

### S21 — Reuse the existing loading-state type

Accepted on 2026-10-07. Git, project connection, working-copy status, and Files now use
[LoadState](../src/client/load-state.ts) directly. Search extends it with its meaningful idle
variant. Git history uses the existing shared page type instead of a synonymous alias, and the
sidebar imports the shared presentation type directly.

This changes only type declarations, annotations, and type-only imports in six client files. Each
resource retains its current identity, freshness, cancellation, caching, and rendering behavior. The
full native type-check gate and client build passed. All four generated assets were byte-for-byte
identical to a fresh build before the change. No new runtime tests or visual captures are needed for
an erased-type change; final static/formatting checks are recorded in the handoff.

### S09 — Align stored folder validation with navigable folder paths

Accepted on 2026-10-07. Navigation and saved folder metadata now share a
[navigation-path predicate](../src/client/navigation-path.ts). Invalid recents/tab values cannot
restore an unnavigable destination, while the empty approved-root path, valid Unicode, and literal
unusual filenames retain URL round-trips. Invalid tab writes preserve the last accepted selection;
backup parsing rejects malformed recents before import. No storage format or namespace changed.

The extraction stays within browser navigation metadata. Other path boundaries were assessed and
retain their distinct policies: host containment/platform checks, Git-control exclusions, exact file
anchor identity, and rename origins that can leave a selected subtree. A universal validator would
erase those differences or change accepted inputs.

The full type-check and static QA gates, client build, 208 unit/integration tests, and isolated
Chrome tab and PWA/backup checks passed. Regression coverage includes invalid-state startup, root
restoration, current-format imports, and Unicode/literal-name round-trips. Physical-device checks
and new screenshots were not performed.

### S10 — Give Search one query contract across its boundaries

Accepted on 2026-10-07. Navigation, form/selection submission, the server reader, and response
parsing now use one [Search query contract](../src/shared/search-query.ts). The shared bound also
drives the input control and validation messages. Direct links normalize whitespace before becoming
destinations; literal replacement characters remain searchable, while malformed URL decoding and
lone surrogates are rejected before they can change the query. Responses must carry normalized
queries.

Selections retain exact comment text and offsets alongside a validated optional Search query.
Selection actions reuse that value, and form/selection actions share one submission handler. Fixed,
case-sensitive matching, explicit submission, repeated-query refresh, source/range checks, and
selection cleanup remain intact. The [Search record](search-slice-proposal.md) owns this behavior;
source owns exact rules and limits.

The full type-check and static QA gates, client build, and 214 unit/integration tests passed.
Isolated Chrome Search and selected-Search checks passed; selected-feedback checks covered narrow
phones, both tablet orientations, and desktop, including exact fragments, long/blank ranges, stale
actions, reattachment, and clipboard/history/Undo. The selected-Search fixture now centers its range
before asserting below-selection placement and still checks docking separately. New screenshots and
physical-device checks were not performed.

### S11 — Require one complete working-copy snapshot for every diff read

Completed after independent review by the client reviewer, with no actionable findings. Individual
reads, feedback checks, and deferred batch fallback now require the shared complete snapshot;
validation and both before/after token checks protect edits behind unchanged porcelain status. Raw
media and immutable history retain their separate source/version contracts. All five type-check
configurations, static QA, the build, 91 focused tests, and isolated feedback/transaction browser
checks passed. Regression coverage gates real Git reads and verifies stale recovery without losing
drafts. See the [batching contract](diff-batching-and-bulk-controls-proposal.md).

### S12 — Share diff-request fields and existing language query parsing

The shared [diff-request fields](../src/shared/diff-request.ts) now own the common path/language
contract; Changes adds its layer and commit requests use it directly. One ChangeLayer predicate
serves status, batches, HTTP, and navigation. Files and individual Changes reuse the existing HTTP
language helper. Wrapper allowlists, duplicate rejection, identities, limits, Git paths, and
server-side language support remain with their boundaries.

Independent client review and the final checks are recorded at commit. The author checks passed all
five TypeScript configurations and 53 focused tests, including exact bounds, unusual paths, null
versus missing language, all layer variants, and HTTP default/plain/highlighted behavior. Static QA
and the client build also passed. No visible behavior or layout changed.

### S13 — Share supported media metadata between server and response parser

The browser-safe [media catalog](../src/shared/media-types.ts) now supplies correlated descriptor
types, supported extension discovery, MIME validation, and preview budgets. Server sniffing,
source/version validation, security headers, read flows, and streaming remain in their existing
owners. The [media record](media-preview-slice-proposal.md) links the catalog and signature owners.

All five TypeScript configurations, static QA, the build, and 60 focused tests passed. Boundary
coverage preserves every alias, kind/MIME pair, inclusive budget, and raw URL identity check.
Independent client review found no actionable issues. Isolated Chrome checks passed for image
rendering, raw SVG isolation, staged/Files audio and video loading and seeking, and raw ranges.
Physical-device playback remains unverified.

### S14 — Share text classification while retaining source-read policies

The neutral [source-text owner](../src/server/source-text.ts) supplies exact byte-bounded decoding
and line-limited classification to Files, working diffs/statistics, patches, and historical sources.
Syntax decoding retains complete source snapshots without a line limit. Files alone normalizes CRLF
for display; the Files and working-content readers retain their distinct growth, reservation, and
error policies. The [Files record](file-browser-slice-proposal.md) links the new owner; the diff
record also corrects a stale optional-snapshot description left from S11.

All five TypeScript configurations and 51 focused tests passed. New coverage includes exact UTF-8
byte/line bounds, line endings, source fidelity, syntax beyond the display line limit, and
deterministic real-filesystem growth checks with isolated descriptor gating. Independent review and
the static gate are recorded at commit. No visible layout changed.

### S15 — Separate pure diff parsing from working-copy orchestration

The pure [diff-content owner](../src/server/diff-content.ts) now supplies patch and one-sided
constructors to working-copy and historical readers. It depends only on diff types, exact source
text, and word detail; it no longer brings working-copy access into historical inspection. The
constructor bodies and result variants are unchanged. Pure tests moved beside the owner; working
integration tests remain with their orchestration.

All five TypeScript configurations, static QA, and 35 focused tests across eight files passed,
including root/parent history, SHA-256, subtree renames, media, batching, syntax, and exact anchors.
Independent server review found no actionable issues and confirmed the constructor and test bodies
were unchanged. The [diff record](diff-slice.md) links the new owners.

### S16 — Share the Git raw-record parser

The [raw-record reader](../src/server/git-raw.ts) now validates common modes, complete object IDs,
status/score variants, paths, and record consumption. History and statistics retain their own
UTF-8/NUL wrappers, subtree/absence/conflict policy, origin matching, and aggregation. The pure
history inventory parser is directly testable. The [Git boundary record](git-read-boundaries.md)
links the shared mechanics without duplicating their format.

All five TypeScript configurations and 33 focused tests passed. New regression coverage separates
history's absence/format/conflict policy from statistics and exercises malformed records, literal
names, scored renames/copies, scope, and aggregation. The author also compared 28,224 baseline/new
acceptance and result combinations. Independent client review found no actionable issues; static QA
also passed.

### S17 — Simplify media inspection and result mapping

Working media inspection now returns correlated type, size, and version metadata. Files and
comparison callers share ready/unavailable construction and attach their own raw URLs. Neutral
source names replace image-only names. Image prefixes, buffering, and header checks remain distinct
from audio/video prefixes and streaming; Git audio/video retains its nonempty-blob policy without
header sniffing. The [media record](media-preview-slice-proposal.md) owns this source distinction.

All five TypeScript configurations, static QA, the build, and 61 focused tests passed. New
regressions cover exact budgets, empty/invalid content, prefix windows, Git versus working policies,
raw failures, and unsupported rename destinations. Independent client review found no actionable
issues. Isolated Chrome image/SVG, staged/Files playback and range checks, and Git source/navigation
checks at four sizes passed. Physical-device playback remains unverified.

### S18 — Share repeated headings and selected working-file wiring

A presentation-only [heading](../src/client/ContentHeading.tsx) now renders the common title/Back
shell and caller-supplied actions. Changes, Git, Files, and Search retain their own controls,
labels, disabled states, announcements, and empty/loading behavior. App constructs the selected
FileViewer once per render but keeps it in the existing branch positions, preserving section
remounts and selection/source cleanup for the same project/path key.

All five TypeScript configurations, static QA, the build, and relevant client tests passed.
Independent server review found no actionable issues. Files, Search, navigation, loading, selected
Search, and selected-feedback browser checks passed. The new phone/desktop regression exercises
normal UI navigation and direct history jumps between same-path Files/Search entries, checking fresh
reads and cleared selection. The existing deep-line Search check now waits for its geometry
requirement after asynchronous route focus.
[Files](../qa/screenshots/simplification-s18-files/mobile.png),
[Search](../qa/screenshots/simplification-s18-search/mobile.png),
[Changes](../qa/screenshots/simplification-s18-changes/mobile.png), and
[Git](../qa/screenshots/simplification-s18-git/mobile.png) captures were inspected at all four
sizes; no page overflow or clipped heading controls were found. Physical-device checks remain
unverified.

### S19 — Resolve diff-row feedback side and counts in one place

DiffBody shares the preferred side between selection registration and floating row actions. An
_ephemeral_ per-card count index keeps each gutter's side count separate from combined row counts,
including selection subjects and outdated drafts. Caller scope, exact anchors, historical
inspection, no-newline exclusion, and action timing remain intact.

All five TypeScript configurations, static QA, the build, and 51 focused tests passed. Independent
server review found no actionable issues. Selected-feedback browser checks passed at five sizes,
including new phone/desktop context cases with different Old/New numbers, side/combined counts,
default New actions, and Old-selection reattachment retaining identity, body, and exact offsets.
Existing floating Old-context feedback/export and four-size Git inspection checks passed. No layout
or physical-device behavior was changed or newly verified.

### S20 — Group identical Files/diff code-pane CSS

Six shared declaration sets now use existing Files/diff selectors. Source-specific padding, borders,
positioning, targets, backgrounds, signs, gutters, word detail, selection, and mobile overrides keep
their own rules. Comma grouping preserves specificity; the wrap selectors still outrank base rules.

All five TypeScript configurations, static CSS/format checks, and the build passed. Independent
client review found no actionable issues. Every computed CSS property matched the recorded baseline
across sixteen Files/diff states: four sizes, both wrap modes, and large local typography. Files,
diff, typography, and selected-feedback browser checks passed, including compact short rows and
contained scrolling. The
[Files wrapped](../qa/screenshots/simplification-s20-files-wrap/mobile.png),
[Files unwrapped](../qa/screenshots/simplification-s20-files-nowrap/mobile.png),
[diff wrapped](../qa/screenshots/simplification-s20-diff-wrap/mobile.png), and
[diff unwrapped](../qa/screenshots/simplification-s20-diff-nowrap/mobile.png) milestone sets were
inspected at all four sizes. Physical-device gestures remain unverified.

### S22 — Shared QA dimensions with scenario policies preserved

`qaDimensions` now supplies the standard phone, tablet, and desktop sizes to eight QA callers.
Emulation options, deliberate omissions, permissions, pixel scale, scenario order, and local 320px
cases remain with their callers. A before/after comparison matched all 63 configured/effective
cases.

Independent review found no extraction issues. A file-feedback check exposed a pre-existing setup
assumption after S11: feedback validated an edited file independently, but the staged diff still
used the accepted pre-edit Changes token. A controlled API reproduction confirmed the expected stale
response. The check now explicitly refreshes Changes and awaits a valid full status response before
opening the staged diff; wrong-source, reattachment-banner, and stored-anchor assertions remain.

All five type-check configurations, formatting, static QA, and whitespace checks passed. Chrome
checks passed for live changes, Git, history controls, loading/project opening, selected feedback,
and file feedback at their configured sizes, including plain-folder and clean-Git roots. Capture
produced the same four dimensions without horizontal overflow. No application behavior changed;
physical devices were not checked.

### S23 — Reused Git fixture execution in ordinary QA callers

The inventory, image, audio/video, and live-change QA callers now reuse `testGit`, with an explicit
owned working directory for every call. Redundant ordinary commit identities and local wrappers were
removed. Specialized history identities/dates, FFmpeg arguments and generation order, fixture
writes, nonrecursive overwrite refusal, and temporary-project cleanup remain unchanged.

Independent review found no actionable issues. Fresh scratch-root generation exactly matched the
pre-refactor status, HEAD/index trees, author/committer identities, and working-file bytes and
modes. A second run of each generator refused overwrite with EEXIST, leaving those observations
unchanged. Files, diff navigation/wrapping, image isolation, audio/video seeking and range reads,
and live-change Chrome checks passed against the new fixtures. The live check removed its owned
temporary project. Formatting, all five typechecks, static QA, and whitespace passed. No app source
or visible layout changed; physical devices were not checked.

## Reviewed item retained

### S08 — Retire the obsolete-storage deletion path after its cutover

Retirement is not valid under the unverified origin-cutover prerequisite. The independent QA review
confirmed that current readers and backups exclude obsolete namespaces, but the existing scoped
sweep also reclaims localStorage capacity for current saves. A bounded Storage probe showed a
current comment write failing before cleanup and persisting after it. Retiring cleanup on an origin
that still holds obsolete history can therefore turn persistent drafts into in-memory-only work.

Keep the small sweep without restoring old-format readers, migrations, or imports. A replacement
retry/lifecycle abstraction would add complexity. No application change is needed; continue the
remaining stages. The [local-data record](independent-tabs-and-pwa-proposal.md) owns the deliberate
reset and current-format behavior.

## Server organization and mechanisms

## Client presentation and types

## QA support

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

Execute the remaining queue under the maintainer's autonomous authorization above. Validate each
finding against the current source, preserve behavior, obtain an independent review after each
stage, address valid feedback, and commit before continuing. Record narrowed or rejected findings
with their rationale. S13 precedes S17, and S14 precedes S15. S18 has two independently reviewable
presentation extractions. The smaller optional candidates remain outside this queue.

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
limits in the relevant record. These limits describe the original documentation pass. Later
code-stage outcomes are recorded above; the remaining queue is now authorized for autonomous
execution.
