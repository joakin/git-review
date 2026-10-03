# Maintenance plan after the prototype review

Status: in progress; M01–M08 and M09a–M09b committed; M09c feedback owner accepted for commit; M09d project/session owner authorized

Created: 2026-09-30

Updated: 2026-10-03

The maintainer requested this bounded maintenance pass after closing the initial implementation stage and gave the implementation go-ahead on 2026-10-01. Each handoff below records its decision, verification, review, and commit approval. Completed slices stay uncommitted for maintainer review.

This is the work record for the bounded maintenance pass. The [initial implementation plan](initial-implementation-plan.md#remaining-roadmap) remains the optional product backlog. Its closed stage stays closed. The [documentation map](README.md), [engineering conventions](engineering-conventions.md), [QA workflow](qa-workflow.md), and [collaboration rules](../AGENTS.md) remain authoritative for current behavior and delivery.

## Intended outcome

Make the stable prototype easier to understand, change, and review for humans and coding agents. Fix the behavior defects found in the review, remove confirmed obsolete code and artifacts, and give repeated mechanisms and state lifetimes clear owners with precise interfaces.

Success means that a caller can use a module without repeating its safety, freshness, or transaction rules. Smaller files are useful when they create that ownership. Extracting code into files that still exchange dozens of setters or require callers to coordinate hidden invariants does not meet this goal.

This pass adds no product features, repository writes, historical comments, storage synchronization, or new previews. Existing URLs, wire formats, storage keys, backup compatibility, and responsive behavior should remain compatible unless a focused fix explicitly requires a documented adjustment.

## Review evidence and baseline

The review covered client, server, shared contracts, documentation, scripts, tests, dependencies, static assets, and tracked versus ignored artifacts. It included three independent sub-agent reviews. No project files were changed during the review, and the running app was left available.

Checks run on 2026-09-30:

- `bun run typecheck`: passed all configured TypeScript projects.
- `bun run test`: 48 tests passed, zero failures, 406 assertions across 14 files.
- `bun run qa:check`: passed; all 140 CSS token references resolved.
- Temporary Git fixture: reproduced wrong staged Old media from a repository-root namesake when only a subfolder was approved. The fixture was removed.
- Direct API request: reproduced a rejected promise instead of a JSON 415 response for unsupported transcription content. No transcription engine was invoked.

The feedback transaction race is established by code inspection and needs a delayed-response regression test. No new browser captures, real-device checks, filesystem race reproduction, or performance benchmarks were performed. Existing milestone captures remain dated evidence, not verification of this maintenance work.

## Execution and review rules

1. Work on one reviewable change at a time. Before each slice, state its intended behavior, scope, and validation. Treat the substeps below as separate changes when they have independent risks.
2. The maintainer gave the implementation go-ahead on 2026-10-01. At each review handoff, record the result and any course correction here before moving to the next slice. Keep changes uncommitted until explicit approval to commit the reviewed work.
3. Preserve URL ownership, synchronous route references, saving an editor before navigation, and one-time URL target focus. Card toggles and refreshes must not repeat route focus.
4. Preserve distinct lifetimes: mutable working-copy resources, pinned branch-history snapshots, and immutable commit objects. Cached first-render diff content must exist before restoring scroll.
5. Keep input validation at boundaries, approved/project path containment, bounded reads, subprocess argument arrays, and read-only Git access.
6. Keep old workspace migration and backup versions 1–3. The review found active compatibility paths, not obsolete parsers ready for deletion.
7. Run the strict type-check and CSS token gates for every code change, plus behavior tests appropriate to the slice. Add tests for durable observable invariants and reproduced failures.
8. For visible UI changes, build and capture the relevant states with `bun run qa:capture`, then inspect phone, tablet portrait, tablet landscape, and desktop images. Include narrow-width, wrapping, touch, and overflow checks where relevant. Do not describe emulation as real-device verification.
9. Run browser QA on a separate port and fixture root. Rebuild client assets after frontend edits, restart the relevant service after backend edits, and stop only QA processes started for this work. Preserve the maintainer's app and stored review data.
10. Update the affected behavior record and this plan when a decision or review status changes. Documentation-only changes need link, command, and whitespace checks.

## Slice order and status

M01–M08 and M09a–M09b are accepted and committed. M09c is accepted for commit. M09d–M15 remain pending, with the project/session owner authorized next. The sequence below keeps independently risky changes in separate review steps; M15 starts with measurement before any optimization.

| ID | Slice | Main dependency | Completion evidence |
| --- | --- | --- | --- |
| M01 | Correct subfolder staged media sources | None | Scope/source regression fixtures and existing API/Git tests |
| M02 | Restore transcription API error translation | None | HTTP-boundary invalid-upload tests |
| M03 | Own feedback check/copy transactions | None | Delayed-response and clipboard race tests |
| M04 | Separate ordinary QA output from milestone captures | None | A QA run leaves tracked milestone images untouched |
| M05 | Remove obsolete UI/CSS; consolidate navigation rules | M04 before captures | Four-size inspection and focused navigation checks |
| M05c | Reset canceled project opening | Discovered during M05b QA | Held opening + Back restores a usable picker; late results cannot affect a newer open |
| M06 | Reuse the bounded cache implementation | None | LRU/byte-accounting invariants and loading checks |
| M07 | Reuse syntax response validators | None | Boundary rejection tests preserve aggregate budgets |
| M08 | Tighten domain and component contracts | M07 where parsers overlap | Strict types and existing behavior tests |
| M09 | Extract cohesive App state owners and views | M03 before feedback extraction | Focused checks for each domain and four-size captures |
| M10 | Share diff-loading mechanics and language controls | M06, M08 | Cache-first rendering, cancellation, stale and Git queue checks |
| M11 | Centralize Git execution and repository/object context | M01 | Existing Git/media tests and subprocess policy checks |
| M12 | Centralize checked working-file opening | None; coordinate with M11 | Containment, identity, limits, and exact-anchor regressions |
| M13 | Share QA/browser and low-level test support | M04 | Affected scripts/tests keep their observable coverage |
| M14 | Curate screenshot artifacts and clarify historical docs | M04 | Reference scan, manifests, and documentation link checks |
| M15 | Measure repeated historical commit work | M11 preferred | Recorded subprocess counts/latency and a scoped decision |

## M01 — Correct subfolder staged media sources

**Finding:** [media.ts](../src/server/media.ts) resolves an Old staged side with `HEAD:${source.path}`, although the path is project-relative and Git's object spec is repository-relative. [git-diff.ts](../src/server/git-diff.ts) already translates through `--show-prefix` for text sources. A selected `inside/` project can display repository-root `art.svg` instead of `inside/art.svg`, including when the root namesake is outside the approved folder. Without a namesake, the Old side appears missing. The affected resolver serves images and audio/video.

**Smallest slice:** correct path translation at this boundary and add regression fixtures. Leave the broader Git infrastructure extraction for M11.

**Expected flow and contract:** opening staged media and its raw Old link reads the old blob belonging to the selected project path. New reads the index as before. The API returns the existing media variants and versioned raw URLs.

**Edges and validation:** selected subfolder with an outside namesake; no namesake; rename and deletion; image and audio/video; unusual paths; root-level projects; source-correct HEAD/index/worktree sides. Prove both preview description and raw bytes refer to the scoped source. Retain current historical and SHA-256 coverage. Update the [media record](media-preview-slice-proposal.md) if its source-boundary description needs clarification.

**Implemented and accepted 2026-10-01; committed as `ba62d1d`:** resolve the HEAD object as `HEAD:./${source.path}` from the selected project's working directory. Git performs the project-relative translation, avoiding another prefix lookup or a broader infrastructure extraction. The existing index/worktree and immutable commit paths remain compatible. [Focused API regression tests](../src/server/media-api.test.ts) cover preview metadata, raw bytes, HEAD/range requests, and rejection of an outside namesake's object ID. All five tests failed before the fix and passed afterward. The [handoff below](#m01-handoff--2026-10-01) records full validation and captures.

## M02 — Restore transcription API error translation

**Finding:** [api.ts](../src/server/api.ts) returns the transcription promise without awaiting it inside the API's `try`. Asynchronous `AppError` rejection bypasses JSON error translation. Existing [transcription tests](../src/server/transcription.test.ts) exercise the adapter directly, where rejection is expected.

**Smallest slice:** await delegation inside the error-owning boundary and add API-level tests. Audit similar asynchronous returns in that boundary without broad route reorganization.

**Expected flow and contract:** unsupported recordings, missing or oversized uploads, and adapter failures return the documented HTTP status and JSON error shape, allowing the client to show the useful message. Success remains unchanged.

**Validation:** unsupported MIME type, missing/empty body, and bounded-upload failure through `createApiHandler`; existing adapter tests and strict gates. Use invalid requests or controlled adapters so regression tests require no microphone, FFmpeg, Handy, or downloaded model. Actual engine/device behavior remains separately unverified.

**Implemented and accepted 2026-10-01; committed as `cbe97fb`:** await transcription delegation inside the API's error-owning `try`, preserving useful `AppError` statuses/messages and the generic JSON 500 response for unexpected failures. The audit also found unawaited audio/video response builders on the raw Files and working-copy diff routes; both now await preparation at the same boundary, matching the existing commit-media route. This does not change errors after a media response has started streaming. [Transcription API regressions](../src/server/transcription-api.test.ts) cover ten invalid-upload and failure cases without engines. [Media API checks](../src/server/api.test.ts) also exercise Files GET, HEAD, valid range, and invalid range responses. The [handoff below](#m02-handoff--2026-10-01) records full validation and running-service checks.

## M03 — Own feedback check and copy transactions

**Finding:** [App.tsx](../src/client/App.tsx) checks a captured comment-store snapshot, then replaces the whole same-project store after requests finish. The controller is discarded, and [ReviewDialogs.tsx](../src/client/ReviewDialogs.tsx) permits edits, reattachment, and Undo during the check. Copy also commits against the earlier checked store after awaiting clipboard access; multiple clipboard operations can overlap.

**Expected flow:** a slow check can finish while the user edits or navigates without restoring deleted comments or losing newer bodies/history. A successful copy archives precisely the exported snapshot. Draft changes made after that snapshot remain available. Clipboard failure retains drafts.

**Internal shape:** explicit operation state for idle/checking/copying/error, an owned cancellation/generation token, and a draft snapshot identity that includes its anchor and body/version. Choose the smallest identity mechanism during implementation; avoid changing stored formats unless necessary.

**Merge rules:** checking updates validity only for still-existing drafts whose anchors match the checked snapshot; preserve current bodies, additions, deletions, and history. Copy appends the immutable exported snapshot to current history and removes only draft versions still matching the exported versions. Serialize clipboard transactions. Superseded operations must not change the active operation's state, including after leaving and returning to the same project.

**Validation:** hold status/diff and clipboard responses while editing, deleting, reattaching, undoing, adding drafts, navigating away/back, or starting another operation. Cover clipboard rejection and late results. Retain anchor matching, export formatting, history bounds, reload persistence, and ordinary `qa:feedback` coverage. Add four-size captures if dialog states or controls change. Update the [feedback record](feedback-slice-proposal.md). Fix behavior before the M09 extraction.

**Implemented and accepted 2026-10-01; committed as `59cadf3`:** [FeedbackTransactions](../src/client/feedback-transactions.ts) owns cancellable checks, operation generations, and a clipboard lease shared by draft/history writes. App commits through a synchronous current-store reference. [Comment-domain helpers](../src/client/comments.ts) merge only matching anchors, construct a checked export snapshot, and archive that exact batch into current history while clearing only unchanged copied versions. The ready state carries checked IDs/anchors so selectable text also excludes drafts added or restored after a check began. Navigation and existing-draft Edit cancel the active operation; an issued clipboard write retains its lease until it settles, and its canceled result preserves drafts/history. Closing Feedback alone permits a copy to finish. The [handoff below](#m03-handoff--2026-10-01) records validation and captures.

**Scope adjustment from regression review:** guard Undo against restoring more than 200 drafts, and guard automatic copy against the existing 250,000-character history-text limit. Both prevent valid working drafts from becoming a stored record rejected on reload. Undo keeps its history and retry available with an inline explanation; oversized feedback keeps selectable text and drafts. Storage version, IDs, anchor/export formats, and backup compatibility remain unchanged.

## M04 — Separate QA output from milestone captures

**Finding:** [qa/check-live-changes.ts](../qa/check-live-changes.ts) rewrites the tracked `navigation-live-update-review` PNGs and manifest on every run. [qa/capture.ts](../qa/capture.ts) otherwise protects existing milestone directories.

**Smallest slice:** send routine check output to an ignored per-run artifact directory. Keep curated milestone creation explicit, with a fresh label and preserved earlier captures.

**Validation:** run the affected check on an isolated fixture server and verify that its assertions still pass and no tracked milestone image changes. Update the [QA workflow](qa-workflow.md) to describe the actual output. Implement this before generating maintenance captures or pruning screenshots.

**Implemented and accepted 2026-10-01; committed as `0e55b07`:** each live-change check allocates a fresh directory under ignored `qa/.artifacts/live-changes-runs/` using `mkdtemp`, writes its four viewport screenshots and manifest there, and prints the directory path. Runs preserve earlier diagnostic output as well as tracked milestones. The explicit `qa:capture` command continues to require a fresh milestone label. The [handoff below](#m04-handoff--2026-10-01) records repeated-run and preservation checks.

## M05 — Remove obsolete UI and consolidate layout CSS

**Confirmed remnants, removed in M05a:** the unreachable folder-picker “Back to project” button in [App.tsx](../src/client/App.tsx) and its sole `.sidebar-switch-mode` rules; `.project-ready`, `.ready-icon`, `.changes-footnote` and their responsive overrides in [styles.css](../src/client/styles.css); the solely associated `--ready-action-indent` token; and the ineffective `.project-view-changes` margin modifier/rules.

**Substeps:** M05a removes the confirmed remnants first. M05b then consolidates the earlier two-column and appended current navigation CSS property by property. Earlier blocks still contain active declarations and welcome/error-screen styles; do not delete whole blocks from their age alone.

**Expected behavior:** the current layout, drawer breakpoints, sticky headers, welcome/invalid-link states, and controls retain their appearance and operation. The stylesheet presents one coherent definition of the current shell.

**Validation:** navigation and loading checks; inspected four-size captures of the affected picker, list/content and Settings states; 320 px overflow and the 899/900 px list boundary; wrapping/horizontal code-pane scrolling; CSS token gate. Record the actual removed declarations and evidence in the handoff.

**M05a implemented and accepted 2026-10-01; committed as `2d6879d`:** removed one unreachable JSX button, one inert wrapper class, sixteen obsolete CSS rules, two unused selectors from shared button rules, and one unused design token. The picker route always has `project === null`; Settings renders the picker only when it also has no project. The remaining removed panel/icon/footnote selectors have no producers. The current `.workspace .project-view` rule already wins over both removed margin declarations. No navigation or state owner changed. Sixteen final captures are byte-for-byte identical to their pre-cleanup counterparts. The [handoff below](#m05a-handoff--2026-10-01) records checks, screenshots, and one unresolved QA timeout.

**M05b implemented and accepted 2026-10-01; committed as `1d28fc5`:** [navigation.css](../src/client/navigation.css) owns header, menu, contextual list/tabs, reading-pane geometry, route visibility, breakpoints, drawers, and reduced motion. [styles.css](../src/client/styles.css) imports it and retains component, welcome/error, diff, media, Search, and feedback styles. Merged active base declarations replace overwritten two-column geometry, duplicate project margins, and repeated phone sticky-offset rules. The active 216 px menu and 300 px list widths now have purpose-built tokens; superseded 330/280 px sidebar tokens and the redundant `project-view-tabs` class are removed. The token gate scans every client stylesheet, and the navigation check scopes the semantic “Project views” navigation to the content pane. CSS has 16 fewer lines across the two files, while the component stylesheet drops from 533 to 415 lines. The [handoff below](#m05b-handoff--2026-10-01) records exact comparisons, responsive checks, and the newly identified cancellation defect.

## M05c — Reset canceled project opening

**Status:** implemented and accepted 2026-10-01, committed as `b20b514` after explicit approval. It was reviewed separately from the CSS consolidation before M06. It also establishes a cancellation invariant for the later M09d project/route owner extraction.

**Finding and reproduction:** [App.tsx](../src/client/App.tsx) sets `opening` when a project request starts. Browser Back can cancel it before completion; cleanup aborts the controller, both promise branches bail out for an aborted signal, and the next effect invocation returns for a null route project without clearing `opening`. The picker then remains disabled with “Opening…”, and `selectFolder` also refuses another open. The project-switch label used by `qa:navigation` can show the route's short name before the project request completes. A held `/api/projects/open` response followed by Back reproduces this on both committed `2d6879d` and M05b clients. This identifies the concrete path behind the previously unisolated M05a navigation timeout; successful reruns do not eliminate the defect.

**Smallest slice and contract:** reset the opening state when the route no longer needs an open operation. Both completion branches require the request to remain non-aborted and belong to the current synchronous route reference. A controlled response released during browser Back showed why both checks are necessary: route ownership changes before effect cleanup aborts the request. Without the route check, the abandoned project could still be saved during that interval. The folder picker should return to the same directory with an enabled “Open this folder” button after canceling an open. Starting another open should succeed; an abandoned response must not clear or replace its state. Keep existing URLs, storage, HTTP shapes, and repository access unchanged. Avoid an unconditional asynchronous `finally` that could let an older canceled request clear a newer operation's flag.

**Validation and result:** [project-opening-check.ts](../qa/project-opening-check.ts), called by `qa:loading`, deliberately holds opens across browser Back, checks the returned directory and enabled button, confirms retry at five widths, and releases abandoned success/error while another open is pending or completed. The controlled success released during `popstate` also preserves saved ownership before effect cleanup. An ordinary opening error still displays recovery and permits retry. The [handoff below](#m05c-handoff--2026-10-01) records baseline failures, strict gates, existing behavior checks, and four-size recovery captures. These checks wait for actual project data when asserting completed opening; the ordinary navigation check retains its rapid Back path.

## M06 — Reuse the bounded cache implementation

**Status:** implemented and accepted 2026-10-01, committed as `737a09b` after explicit approval.

**Finding:** [diff-cache.ts](../src/client/diff-cache.ts) repeats the LRU promotion, replacement accounting, oversized-value rejection, and eviction already in [resource-cache.ts](../src/client/resource-cache.ts).

**Smallest slice:** use `ResourceCache<DiffResult>` behind the existing diff API. Retain the 128-entry/~32 MiB budget, diff identity builder, and stale-result exclusion.

**Validation:** promotion/oldest eviction, replacement byte accounting, oversized values, and stale-result rejection. Run relevant loading and Git cache/navigation checks. Keep working-copy invalidation and immutable commit identities in their domain callers; cached first-render height must remain available before scroll restoration.

**Implemented:** the diff adapter delegates `readCachedDiff` and accepted `rememberDiff` writes to one module-scoped `ResourceCache<DiffResult>`. This removes the second implementation of storage/promotion/accounting/eviction while preserving the adapter exports, singleton lifetime, shared working-copy/commit capacity, and existing budgets. The adapter still builds working-copy identities and rejects stale values before any cache write; immutable commit identities remain in their caller. The generic cache and all callers are unchanged. Its byte charge is the serialized payload's UTF-16 size estimate, not a browser heap measurement. Oversized writes preserve an existing value and its eviction position.

**Unit evidence:** seven [generic cache tests](../src/client/resource-cache.test.ts) cover hit/miss ordering, replacement promotion, growing/shrinking accounting, repeated removal, exact UTF-16 size limits, multiple evictions, and oversized-write preservation. Four [diff adapter tests](../src/client/diff-cache.test.ts) cover all identity dimensions, stale exclusion/non-promotion, shared working-copy/commit count pressure, and the configured 32 MiB byte budget. These tests use the public API without inspecting the internal Map. The [handoff below](#m06-handoff--2026-10-01) records integration checks and review status.

## M07 — Reuse syntax validators

**Status:** implemented and accepted 2026-10-01, committed as `4eac2ec` after explicit approval.

**Finding:** [shared/api.ts](../src/shared/api.ts) has `parseSyntaxState` and `parseSyntaxTokens` for Files but repeats their logic in diff parsing, including syntax-role allowlists and exact token-text reconstruction.

**Smallest slice:** reuse these validators while preserving per-line and aggregate diff token limits. Keep source-text, span, line-number, and hunk consistency checks intact.

**Validation:** malformed roles, token/source mismatch, invalid syntax state, and aggregate budgets through the relevant response parsers. Preserve existing word-detail tests. A later file split may group syntax/media/diff/file contracts with their parsers if it improves discovery; it is not a requirement to complete this de-duplication.

**Implemented:** diff responses now reuse both existing private syntax helpers. They own syntax variants, bounded language strings, the 13 semantic roles, token shape/text checks, the 20,000-token per-line cap, and exact source reconstruction. Each domain response parser retains its aggregate budget; diff checks the 100,000-token total before parsing another token batch, preserving early overflow rejection. Source, line-side, newline, word-span, and hunk consistency checks are unchanged. No response shape, helper export, or language-catalog policy changed.

**Boundary evidence:** 16 [public-parser tests](../src/shared/api.test.ts) cover both Files and diff inputs, accepted states/roles, malformed syntax/tokens, empty/whitespace/Unicode/CRLF reconstruction, exact line and aggregate token limits, overflow before token parsing, and adjacent side/newline/span/hunk guards. The final tests pass against both committed pre-refactor validators and the shared implementation. The [client type-check config](../tsconfig.client.json) excludes all `src/**/*.test.ts` from browser roots so the new shared Bun tests stay in the dedicated test project; production shared code remains included and strict settings are unchanged. The [handoff below](#m07-handoff--2026-10-01) records the full checks and review status.

## M08 — Tighten domain and view contracts

Make these independently reviewable type changes without widening user-visible scope:

| Substep | Contract | Status |
| --- | --- | --- |
| M08a | [Comment anchors](../src/client/comments.ts) use precise reviewable layers; the broader factory retains its conflict guard | Accepted; committed as `acf06ca` |
| M08b | [DiffCardFrame](../src/client/DiffCardFrame.tsx) couples source and interaction in one discriminated mode so historical cards cannot be paired with comment actions | Accepted; committed as `5942af5` |
| M08c | [Git diff](../src/server/git-diff.ts) pure patch/content parsers return only text/binary/limit variants; syntax/word decorators require and return text, enabling removal of unreachable historical checks | Accepted; committed as `86cc362` |
| M08d | [GitSidebar](../src/client/GitSidebar.tsx) receives an explicit list-view model/commands interface instead of the whole inferred hook return type | Accepted; committed as `2a32695` |

**Validation:** strict type checking and current comment, diff, Git/API, and historical-inspection tests. Preserve runtime boundary guards. Reduce unnecessary exports when a symbol is internal, but keep intentional test seams and compatibility APIs; absence of external callers does not by itself prove the underlying code is dead.

### M08a — Reviewable comment layers

**Status:** implemented and accepted 2026-10-01, committed as `acf06ca` after explicit approval.

**Finding and contract:** storage parsing already rejects anchors outside staged, unstaged, and untracked layers, and the line-anchor factory already rejects conflict input. `CommentAnchor.layer` nevertheless used the broader API `ChangeLayer`, allowing impossible internal states and a conflict entry in feedback ordering. The explicit `ReviewLayer` union now names only the three supported layers, matching validated anchors throughout drafts, checked snapshots, history, and Undo. Future API layers require a deliberate comment-domain decision rather than automatically becoming reviewable.

**Implemented:** [comments.ts](../src/client/comments.ts) narrows the anchor field and removes unreachable conflict ordering. `anchorForLine` retains its broad `ChangeLayer` input and runtime conflict guard because it receives status entries before constructing a reviewable anchor. Storage/backup parsers, transaction mechanics, wire formats, comment store version 1, and backup versions 1–3 remain compatible. This substep changed no other M08 contract.

**Boundary evidence:** [comment tests](../src/client/comments.test.ts) cover Old/New anchors for all valid layers, conflict factory rejection, atomic stored draft/history rejection of conflict/unknown/null layers, valid version-one round-trips, and staged → unstaged → untracked export ordering. [Backup tests](../src/client/backup.test.ts) cover accepted/rejected draft/history anchors in versions 1–3. The new tests pass before and after the type change; existing transaction tests pass unchanged. The [handoff below](#m08a-handoff--2026-10-01) records complete verification and review status.

### M08b — Diff card modes

**Status:** implemented and accepted 2026-10-01, committed as `5942af5` after explicit approval.

**Finding and contract:** the frame accepted heading source and line interaction independently. Although current callers supplied matching values, the type contract also accepted a historical file paired with review actions, or two different working-copy entries for heading and anchor identity. A single private `DiffCardMode` now represents review or inspection. Review reuses the review variant of the body's `DiffInteraction`, with one entry and its comment callback, drafts, and reattachment side. Inspect carries a historical `CommitFileChange`.

**Implemented:** [DiffCardFrame](../src/client/DiffCardFrame.tsx) derives heading metadata from the mode and passes it directly to [DiffBody](../src/client/DiffBody.tsx). [DiffCard](../src/client/DiffCard.tsx) constructs review mode; the historical card in [CommitViewer](../src/client/CommitViewer.tsx) constructs inspect mode. This removes the second working-copy entry and independent source/interaction props without another public type, mapping helper, cast, or duplicated review-capability interface. Fetch/cache lifetimes, request identities, stale/cancellation guards, language choices, and markup are unchanged. The broader working-copy entry still represents conflict cards; the existing anchor factory guard remains.

**Contract evidence:** a temporary probe checked against the client JSX TypeScript configuration confirms that the baseline accepts both unsafe pairings, both valid new modes compile, and six contradictory/missing contracts are rejected: inspect file with review capabilities, review tag with a historical file, review without comment capabilities, inspect without its file, and the removed `source` and `interaction` props. The probe and baseline copy were removed. Existing observable browser checks cover working-copy anchors and historical inspection; no permanent test repeats the JSX prop implementation. The [handoff below](#m08b-handoff--2026-10-01) records complete checks and limitations.

### M08c — Parser and decorator contracts

**Status:** implemented 2026-10-01, accepted and committed as `86cc362` on 2026-10-02 after explicit approval.

**Finding and contract:** pure patch/content parsers returned the full `DiffResult`, although they produce only text, binary, or size-limit outcomes. Syntax and word decoration also returned the full union even though they only decorate text. This forced historical loading to check three times for impossible stale/conflict states. The private `ParsedDiff` now names the parser outcomes; both decorators accept and return the canonical text variant. Decoration can change syntax and word-detail fields, so it must not promise to preserve arbitrary narrower caller refinements.

**Implemented:** [git-diff.ts](../src/server/git-diff.ts) narrows `parseGitPatch` and `diffFromContent` without changing their algorithms or limits. [diff-syntax.ts](../src/server/diff-syntax.ts) and [diff-words.ts](../src/server/diff-words.ts) use private text aliases and remove their unnecessary non-text guards. The working-copy source loader already narrows to text. [git-history.ts](../src/server/git-history.ts) returns non-text parser outcomes before decoration and removes three unreachable stale/conflict checks. The unknown-response guard in [parseCommitDiff](../src/shared/git.ts) remains at the HTTP boundary. Missing-parent/content guards, Git errors, containment, plain fallbacks, and mutable working-copy states remain intact. No new export, generic overload, cast, wire shape, or dependency was needed.

**Evidence:** five new tests add 30 assertions: [syntax tests](../src/server/diff-syntax.test.ts) cover empty/plain-choice no-read paths and null/rejected/mismatched source fallback on either side while preserving decorated rows; [historical tests](../src/server/git-history.test.ts) cover root-content and parent-patch binary/limit outcomes; [shared Git tests](../src/shared/git.test.ts) retain unknown-response mutable-state rejection and accept current immutable variants. The focused 21-test suite passes against both committed `5942af5` producers/decorators and this refactor. A temporary compiler probe verifies narrow parser assignments and canonical text returns, rejects impossible parser states/non-text decorator inputs, and rejects false promises that decoration preserves refined syntax/detail fields. The comparison copy and probe were removed. The [handoff below](#m08c-handoff--2026-10-01) records complete verification and limits.

### M08d — Git sidebar contracts

**Status:** implemented and accepted 2026-10-02, committed as `2a32695` after explicit approval.

**Decision:** a view should declare the data and commands it consumes, so changes in its owner do not silently expand the view's dependencies. The sidebar's private list model and commands replace the whole inferred hook return type. It can now be supplied without commit-detail state or commit retry. The existing owner satisfies those contracts structurally; no state copies or projection layer are needed. Resource lifetime and navigation ownership stay in their existing owners.

The source change is limited to [GitSidebar](../src/client/GitSidebar.tsx) and its [App](../src/client/App.tsx) call site. The Git browser check now also covers Refresh failure/recovery; [handoff evidence](#m08d-handoff--2026-10-02) is below.

## M09 — Extract cohesive App owners and views

**Review baseline:** [App.tsx](../src/client/App.tsx) had 924 lines, 44 state/ref declarations, and 22 effects across unrelated resource lifetimes and the responsive shell when this maintenance pass was planned.

Each row below is a separate reviewable substep. Proposed names are illustrative; choose names matching the final responsibility.

| Substep | Owner and interface | Important invariants/checks |
| --- | --- | --- |
| M09a | [Appearance/preferences owner](../src/client/appearance-preferences.ts): typed preferences and change/reset actions; owns storage events, system theme, theme application, and font loading | Theme bootstrap, cross-tab updates, font fallback, Settings; `qa:themes`, `qa:typography`, relevant PWA checks |
| M09b | [Shared modal hook](../src/client/modal.ts) used directly by installation and feedback dialogs | Focus/cancel/close behavior and voice/editor lifetime; modal, feedback, voice, and PWA checks |
| M09c | [Feedback owner](../src/client/review-feedback.ts): store/editor/operation state and edit/check/copy/undo/reattach actions | M03 transaction rules, conservative anchors, persistence and navigation saving |
| M09d | Project/session controller: resolved project/opening/error state and project-opening actions | Root/project identity, recents, per-tab restoration, unavailable project recovery; tabs/navigation/loading checks |
| M09e | Working-copy review controller: displayed status, pending-update state and refresh/accept/toggle actions | Polling pauses/resumes, serialized requests, loaded snapshot, card preferences, review position; live-change/loading/navigation checks |
| M09f | Presentational project picker, Files sidebar, and Changes content | Explicit small props; current phone/tablet/desktop hierarchy, focus, wrapping and overflow |

Keep Files/Search resource state keyed to its current project/path/query. Extract it further only where the move creates a coherent owner. Do not use one generic loading hook for working-copy status, mutable files, branch snapshots, and immutable commits. Navigation extraction comes last and only if it can retain synchronous route ownership, draft saving, and one-time focus without introducing a second source of truth.

**Validation:** run focused browser checks and four-size captures after each relevant extraction. Rebuild the client for review. Update state ownership references in the documentation map and affected behavior records as files move.

### M09a — Appearance and typography ownership

**Status:** implemented and accepted 2026-10-02, committed as `8eab286` after explicit approval.

**Decision:** preferences share the whole App lifetime, independent of Settings or the selected project. One owner hides storage synchronization, system-theme tracking, theme application, and font loading behind typed values and change/reset commands. Settings delegates resets so defaults have one source. App applies typography to its existing shell element; wrapping remains with the review views. The storage boundary and separate prepaint bootstrap retain their existing roles.

The [handoff below](#m09a-handoff--2026-10-02) records verification and captures. The [documentation map](README.md#where-state-belongs) identifies the owner; engineering conventions remain general principles.

### M09b — Shared modal ownership

**Status:** implemented 2026-10-02, accepted and committed as `5a951ad` on 2026-10-03 after explicit approval.

**Decision:** installation depended on a feedback view module solely to reuse modal behavior. A shared hook now owns browser presentation behind an explicit ref/cancel contract. Dialog owners retain their close actions, saved data, and pending work; the native dialog retains its focus policy. This keeps presentation reusable without tying unrelated workflows together. The hook body is unchanged.

The [handoff below](#m09b-handoff--2026-10-02) records verification and captures.

### M09c — Feedback session ownership

**Status:** implemented, verified, and accepted 2026-10-03; approved for commit.

**Decision:** one [feedback owner](../src/client/review-feedback.ts) hides persistence, editor saving, preview, Undo, and reattachment behind explicit scoped values and actions. App announces navigation and accepted project opening, and retains URL ownership and polling policy. The owner saves the latest editor synchronously before a destination change, retains a hidden same-project session through the picker, and keeps one transaction instance for the App lifetime so an issued clipboard write keeps its lease across project switches. Closing Feedback alone permits copy completion; editing or navigation cancels its ownership. Dialogs identify drafts by ID so actions use the current record. Storage formats, anchor checks, and the transaction engine are unchanged.

The [handoff below](#m09c-handoff--2026-10-03) records verification and captures.

## M10 — Share diff loading and language controls

**Finding:** [DiffCard.tsx](../src/client/DiffCard.tsx) and the commit card in [CommitViewer.tsx](../src/client/CommitViewer.tsx) repeat language override validation, cache-first loading, keyed state, retries, cancellation and error handling. Language-picker presentation also repeats in [DiffCardFrame.tsx](../src/client/DiffCardFrame.tsx) and [FileViewer.tsx](../src/client/FileViewer.tsx).

**Boundary:** a small diff-loading controller owns request lifetime, keyed loaded state, retry, and cache-first rendering. Domain adapters own identity, freshness and response handling. Working-copy stale handling stays explicit; historical diff requests retain their three-request queue and exact object identity. A focused language-picker component owns the common control presentation.

**Validation:** delayed/superseded requests, expand/collapse, retry, override persistence, immediate cached rendering, fresh mutable diffs after accepted Update/Refresh, unchanged immutable commit reuse, scroll restoration, and historical queue bounds. Use loading, diff, Files, Git and navigation checks as affected; inspect four-size captures.

## M11 — Centralize Git execution and repository/object context

**Finding:** [git-status.ts](../src/server/git-status.ts) owns the runner and command error used by other Git features; [media-stream.ts](../src/server/media-stream.ts) has a separate streaming process path. Context detection/prefix handling repeat across status, diff, and history.

**Proposed boundaries:** a small Git execution module owns argument-array execution, read-only environment policy, output/time limits, and process errors. A repository context/object reader owns validated project scope, repository prefix, object-ID format, source-to-object translation, and bounded object access. Streaming keeps a streaming API while sharing applicable command policy and process cleanup.

Keep porcelain, patch, raw inventory and numstat parsers at their domain boundaries. Do not combine all Git code into one utility module. Preserve non-Git/unborn/detached/shallow states, SHA-1/SHA-256 IDs, literal unusual paths, immutable comparison semantics and missing-parent recovery. Consider moving `AppError` out of filesystem paths only as a separate small boundary improvement when it clarifies imports.

**Validation:** existing status/diff/history/stats/API/media regressions, especially M01's outside-namesake fixture; subprocess failure/limits and streamed media range/HEAD/cancellation behavior. Update engineering/source-boundary records to match the final ownership.

## M12 — Centralize checked working-file opening

**Finding:** the working-file reader in [git-diff.ts](../src/server/git-diff.ts), text reader in [project-files.ts](../src/server/project-files.ts), and media open path in that same module duplicate containment/open logic with different no-follow and identity rechecks. A filesystem race exploit was not reproduced.

**Boundary:** a checked-open primitive owns approved/project containment, regular-file verification, file identity rechecks, and descriptor lifetime. Text/diff/media callers own byte limits, decoding, streaming and their distinct unsupported/missing/stale result variants.

**Edges and validation:** final and intermediate links, traversal, outside paths, literal backslash filenames, disappearing/replaced files, changing sizes, binary/invalid UTF-8 and oversized content, and descriptor cleanup. Preserve exact CRLF diff source text and anchor context; preserve intentional Files display normalization. Retain existing file/media/diff tests and add meaningful boundary regressions where missing.

## M13 — Share QA and low-level test support

**Finding:** 19 QA scripts repeat Chrome launch, 17 repeat the phone viewport, 15 collect page errors, and 11 repeat overflow checks. URL/folder parsing and fixture paths repeat too. Media checks omit page-error collection. Six server test files repeat low-level Git wrappers.

**Substeps:** introduce modest browser/fixture support owning launch/context lifetime, viewport matrix, error collection, artifact paths, argument parsing and overflow assertions. Migrate two or three scripts first, review the interface, then migrate the rest where useful. Separately share test Git execution, deterministic author setup and temporary-root cleanup.

Keep feature interactions/assertions and scenario-specific commits/files beside the checks. Avoid a large test framework or one centralized fixture that obscures each scenario.

**Validation:** type-check and run each migrated script on an isolated fixture server; confirm equivalent failure detection and M04 output ownership. Run server tests after test-support extraction. Document any changed QA invocation in the workflow and package scripts.

## M14 — Curate artifacts and clarify historical records

The review found 82 tracked screenshot sets (328 PNGs plus manifests), about 43.7 MiB. Thirteen unreferenced sets total 65 files/about 7.4 MiB. Representative inspected images show earlier layouts superseded by accepted navigation or hidden-phone-gutter behavior.

**Prune/archive shortlist:**

- `foundation-picker`, `foundation-selected`, `foundation-drawer`
- `design-tokens-picker`, `design-tokens-selected`, `design-tokens-drawer`
- `diff-cards-collapsed`, `diff-cards-expanded`
- `diff-density-wrap-on`, `diff-density-scroll-right`
- `diff-compact-wrap-on`, `diff-compact-scroll-right`
- `live-change-update-review`

Recheck references before removing the shortlist. Git preserves the old files; retain one early overview if the maintainer finds that history useful. The other 69 sets have current or historical evidence links and need deliberate evidence/link changes before removal. Retain useful new maintenance captures under fresh labels.

No confidently obsolete whole documentation record, dependency, runtime icon, or server module was found. Keep existing proposal filenames and links unless an actual navigation problem warrants a move. Clarify the original finding in [live-change detection](live-change-detection-slice-proposal.md) with historical wording, and label older “current shell” screenshots in the [QA workflow](qa-workflow.md) as dated milestones. If a new doc subfolder becomes useful, move files and repair all relative links in a separate reviewable step.

Ignored `dist/`, `node_modules/`, and `qa/.artifacts/` are separate from tracked cleanup. The artifacts directory includes service plists, logs, saved browser state and voice fixtures as well as disposable run outputs. Remove only identified unused outputs after checking their role; do not blanket-delete local service configuration or stored evidence.

**Validation:** scan tracked references, check surviving manifests and local Markdown links, and run `git diff --check`. Record removed sets and retained evidence. No browser regeneration or code tests are required for artifact/doc-only pruning.

## M15 — Measure repeated historical commit work

**Finding:** historical diff and raw-media requests in [api.ts](../src/server/api.ts) reread full commit detail/inventory through [git-history.ts](../src/server/git-history.ts). Expanded cards repeat immutable comparison work per file; only statistics currently have a server cache. User-visible performance impact was not measured.

**First slice:** measure subprocess counts and latency for an ordinary larger commit, with text and media, cold and repeated requests, and scoped subfolder access. Record method and results here without claiming a benchmark from inspection.

**Decision:** if the cost is material, propose a bounded exact-project/commit cache or narrower comparison lookup. Preserve project revalidation, scope, limits, process failures and missing-parent recovery; unavailable shallow comparisons can become available later. Agree the concrete freshness/invalidation policy before implementing caching. If measurement does not justify a change, close this item with evidence and leave the behavior as it is.

## Completion and handoff record

A slice is complete after its scoped implementation, relevant checks, documentation updates, and maintainer review. Record implementation/review/commit status separately. Do not claim whole-pass completion while a pending item lacks either a delivered result or an explicit evidence-backed decision to defer it.

Use this compact entry for each handoff:

- **Slice/date:**
- **Result and files:**
- **Checks and evidence:** include useful capture links and distinguish emulation from real devices.
- **Remaining uncertainty or scope adjustment:**
- **Review status:** awaiting review / changes requested / accepted.
- **Commit status:** uncommitted / explicitly approved / committed with hash.
- **Next proposed slice:**

### Planning handoff — 2026-09-30

- Review completed; plan written and linked from the documentation map.
- Implementation has not started. All M01–M15 slices are pending.
- Await the maintainer's go-ahead, then begin M01 as the first small reviewable fix.

### M01 handoff — 2026-10-01

- **Result and files:** corrected HEAD media resolution in [media.ts](../src/server/media.ts); added [media API regressions](../src/server/media-api.test.ts). Source-correct Old/New metadata and raw bytes now work when the approved project is a repository subfolder. This is the focused path fix; the broader Git boundary work remains M11.
- **Checks:** all five new tests reproduced the failure before the fix. Afterward, `bun run typecheck`, `bun run qa:check`, and `bun run test` passed: 53 tests, zero failures, 945 assertions across 15 files. The regression matrix covers SHA-1/SHA-256, outside namesakes present/absent, spaces/newlines/Unicode and literal pathspec characters, staged/unstaged image/audio/video sources, raw GET/HEAD/ranges, outside-object version rejection, staged rename, and deletion. Existing root-level, historical, containment, and stale-version tests also pass.
- **Visual evidence:** captured with `bun run qa:capture` on an isolated server approving only the fixture subfolder; inspected [phone](../qa/screenshots/maintenance-m01-scoped-media/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m01-scoped-media/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m01-scoped-media/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m01-scoped-media/desktop.png). Old shows the scoped blue HEAD image and New the scoped green index image, without the red repository-root namesake or page-wide overflow.
- **Operation:** stopped the isolated QA server. Restarted the existing HTTP and HTTPS backends; both and the public HTTPS origin returned 200 for the approved-root health check. The ignored fixture is retained under `qa/.artifacts/m01-media-repository/inside` for review. Client source/assets were unchanged.
- **Remaining uncertainty:** browser captures use Chrome emulation. No new real-device gestures/playback checks were performed. Audio/video regression payloads exercise source and range fidelity, not decoder compatibility. No broader filesystem race claim is made.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `ba62d1d` on 2026-10-01 after explicit approval, including the maintenance plan.
- **Next authorized slice:** M02, restore transcription API error translation.

### M02 handoff — 2026-10-01

- **Result and files:** corrected three asynchronous delegations in [api.ts](../src/server/api.ts), so transcription and audio/video response-preparation failures reach the existing JSON error boundary. Added [transcription API regressions](../src/server/transcription-api.test.ts) and expanded the existing raw Files audio checks in [api.test.ts](../src/server/api.test.ts). Updated the [voice behavior record](local-voice-comment-slice-proposal.md) with the error contract and this verification.
- **Checks:** all ten new transcription tests failed before the fix and passed afterward. They verify missing/unsupported MIME, missing/empty body, invalid/oversized advertised length, actual streamed byte overflow and cancellation, concurrent request rejection, aborted uploads, generic unexpected-failure translation, and release of the job slot after each failure. New tests require no microphone, FFmpeg, Handy, or model. `bun run typecheck`, `bun run qa:check`, and `bun run test` passed: 63 tests, zero failures, 1,018 assertions across 16 files. Existing adapter, media, Git, containment, and client tests remain passing.
- **HTTP evidence:** the real server on isolated port 39908 with an empty approved fixture root returned JSON 415 for an unsupported recording and JSON 400 for a zero-length POST, which Bun exposes as a missing body. Its root endpoint returned 200. After restarting both existing backends, the HTTP endpoint, HTTPS backend, and public HTTPS origin each returned 200 for the app/root and the expected JSON 415 transcription error.
- **Operation:** stopped the isolated QA server and removed its empty temporary fixture. Both maintainer services remain running with the fix. No client source/assets changed; no new screenshots were needed for this server-only slice.
- **Remaining uncertainty or scope adjustment:** the audit's two matching audio/video delegations are included in this slice; stream-body failures after response creation keep their existing stream-error behavior. Ordinary media GET/HEAD/range responses are covered, but descriptor-close failure was not injected. No new successful engine transcription, microphone, browser Retry, timeout, or real-device checks were performed. Earlier voice verification remains dated evidence.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `cbe97fb` on 2026-10-01 after explicit approval. M01 and the maintenance plan were committed separately as `ba62d1d`.
- **Next authorized slice:** M03, own feedback check/copy transactions so asynchronous work cannot overwrite newer comments or copy history.

### M03 handoff — 2026-10-01

- **Result and files:** added [FeedbackTransactions](../src/client/feedback-transactions.ts) as the owner of check cancellation/generations and the shared clipboard lease; replaced captured-store commits in [App.tsx](../src/client/App.tsx) with synchronous current-store updates. [Comment helpers](../src/client/comments.ts) own matching-anchor validity merges, checked export snapshots, exact-version removal, history bounds, and capacity-safe Undo. [FeedbackDialog](../src/client/ReviewDialogs.tsx) uses the checked snapshot for manual text, shows pending-copy status, and disables overlapping writes. The [feedback record](feedback-slice-proposal.md) and [engineering conventions](engineering-conventions.md#asynchronous-transactions) document ownership and cancellation.
- **Behavior:** checks preserve newer bodies, added/deleted/reattached drafts, and history. Copy archives exactly what was exported and clears only unchanged copied versions. A draft added/restored during checking cannot enter an unchecked export. Navigation and existing-draft Edit cancel the active operation; an issued clipboard write may still reach the OS but holds its lease until settlement and cannot mutate a canceled session. Closing Feedback alone permits copy completion. No persisted-state migration was introduced.
- **Automated checks:** added 25 regression tests covering held status/diff/clipboard results, full anchor/body/timestamp matching, edits/deletion/reattachment/additions/Undo/history, supersession, same-project return and other-project cancellation, clipboard failures/retry/serialization, checked manual export, bounded history, capacity-safe Undo, and version-1 reloads. `bun run typecheck`, `bun run qa:check`, `bun run test`, and `bun run build` passed: 88 tests, zero failures, 1,155 assertions across 17 files; all 140 CSS token references resolve.
- **Browser regression evidence:** [the focused check](../qa/check-feedback-transactions.ts), available as `bun run qa:feedback-transactions`, reproduces “A late status check overwrote an edit” with the compiled pre-fix client from `cbe97fb`. All seven scenarios pass with the final client: held status/diff edits, clipboard Edit/cancel/reopen/retry, navigation during checks/copies, rejection with selectable fallback, history-write serialization, and reload persistence. The ordinary `bun run qa:feedback` phone flow also passes with the final build.
- **Visual evidence:** captured with `bun run qa:capture` and inspected checked-preview [phone](../qa/screenshots/maintenance-m03-feedback/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m03-feedback/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m03-feedback/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m03-feedback/desktop.png); also inspected pending-copy [phone](../qa/screenshots/maintenance-m03-copying/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m03-copying/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m03-copying/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m03-copying/desktop.png). Text wraps and controls fit at every captured size; both manifests report no page-wide overflow. The pending-copy set uses a QA-only proxy with a controlled clipboard promise.
- **Scope adjustment and remaining uncertainty:** added the 200-draft Undo guard and existing 250,000-character export guard because exceeding either made a later reload reject otherwise valid working data. Both preserve drafts/history and offer recovery. Limit guards have domain regression coverage. Browser checks use Chrome emulation and controlled clipboard promises for race timing; they do not establish real iOS/Android clipboard permissions, native gestures, or keyboard behavior.
- **Operation:** rebuilt shared client assets and stopped the isolated QA server on 39909 and capture proxy on 39910. Both existing review backends and the public HTTPS origin returned 200 for the app/root and served the exact final client bundle. Backend source was unchanged. The baseline bundle and QA helper state remain ignored artifacts for reproducibility; the eight reviewed screenshots are curated milestone evidence.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `59cadf3` on 2026-10-01, following explicit approval. M02 was committed separately as `cbe97fb`.
- **Next authorized slice:** M04, separate ordinary QA output from curated milestone captures.

### M04 handoff — 2026-10-01

- **Result and files:** [qa/check-live-changes.ts](../qa/check-live-changes.ts) allocates a fresh `mkdtemp` directory under ignored `qa/.artifacts/live-changes-runs/`, writes its four viewport PNGs and manifest there, and prints the path. Earlier run output and tracked milestones are preserved. [The QA workflow](qa-workflow.md#live-change-detection) and [live-change record](live-change-detection-slice-proposal.md#maintenance-verification--2026-10-01) describe this ownership; project status records M03's approved commit as `59cadf3`.
- **Checks and evidence:** `bun run typecheck` passed all five TypeScript projects; `bun run qa:check` passed with all 140 CSS token references resolved. Two consecutive `bun run qa:live-changes http://127.0.0.1:39911/` runs passed the existing four-viewport, 320 px, steady-code, Update/card/draft/scroll, hidden-tab, serialized-request, error-recovery, and manual Refresh assertions. Run output is retained locally in `qa/.artifacts/live-changes-runs/run-lIho1D/` and `run-rBLjes/`, with five expected files and validated manifests in each. SHA-256 comparisons confirm all 426 tracked screenshot/manifest files and the first run's five files remain unchanged. Git confirms both output directories are ignored. `qa:capture` refused the existing `maintenance-m03-feedback` label before opening Chrome, as expected.
- **Operation and remaining uncertainty:** the isolated server used port 39911 and `qa/.artifacts` as its approved root. Both temporary Git fixtures were removed and the QA server was stopped; the maintainer's running services and built assets were unchanged. The check generated four-size diagnostic screenshots in each run; this slice has no visible UI changes and adds no curated milestone. Browser assertions use Chrome emulation; real iOS/Android behavior was not reverified.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `0e55b07` on 2026-10-01, following explicit approval. M03 was committed separately as `59cadf3`.
- **Next authorized slice:** M05, starting with confirmed obsolete UI/CSS remnants before a separate review of navigation CSS consolidation.

### M05a handoff — 2026-10-01

- **Result and files:** [App.tsx](../src/client/App.tsx), [styles.css](../src/client/styles.css), and [design-tokens.css](../src/client/design-tokens.css) remove the unreachable picker button, inert Changes wrapper class, ready-panel/icon/footnote styles and their responsive overrides, unused sidebar-switch selectors, and the ready-action indent token. Sixteen full CSS rules are removed; the shared `.changes-heading button` rules retain their active declarations. A source scan confirms none of the removed classes/token/control remain in `src/`. The active `.project-view`, welcome/error styles, and shell media rules remain for M05b's separate consolidation.
- **Automated checks:** `bun run typecheck`, `bun run qa:check`, and `bun run build` passed; all 138 remaining CSS token references resolve. Navigation parser tests passed: three tests, zero failures, 31 assertions. `bun run qa:loading` passed delayed folder/project/file/Search checks and cache/height/scroll preservation across Back/Forward. `bun run qa:diff` passed touch navigation, staged comparison, syntax/override/reload, compact rows, wrap, contained horizontal scrolling, and sticky headings. A focused ignored check confirmed the picker, Changes content, Changes list, and Settings each fit a 320 px touch viewport, with a zero content top margin.
- **Navigation result and remaining uncertainty:** the initial `qa:navigation` run, concurrent with other browser checks/captures, timed out waiting for “Open this folder” after returning to the picker. An instrumented diagnostic run and a subsequent unmodified run both passed without code changes, including selected-card control, Back/Forward, direct links, drafts, phone/tablet/desktop panes, the 899/900 px boundary, Settings at 320 px, and invalid-link recovery. The first timeout's timing cause was not isolated. Keep this observation available when reviewing project/route ownership in M09d and shared QA support in M13; these later successes do not establish that rapid picker transitions are free of timing issues. Actual iOS/Android gestures were not reverified.
- **Visual evidence:** captured with `bun run qa:capture` and inspected [picker](../qa/screenshots/maintenance-m05-obsolete-picker/mobile.png), [expanded Changes](../qa/screenshots/maintenance-m05-obsolete-changes/mobile.png), [Changes list](../qa/screenshots/maintenance-m05-obsolete-list/mobile.png), and [Settings](../qa/screenshots/maintenance-m05-obsolete-settings/mobile.png) at phone, tablet portrait, tablet landscape, and desktop sizes. Each linked folder contains all four images and its manifest; all sixteen final records report no page-wide overflow. Every final PNG is byte-for-byte identical to its corresponding pre-cleanup PNG. Baselines and the SHA-256 comparison record remain in ignored `qa/.artifacts/`; only the four final milestone sets are added. All 426 previously tracked screenshot/manifest files remain unchanged.
- **Operation:** rebuilt client assets. Both existing review backends and the public HTTPS origin returned 200 for the app/root and served JavaScript/CSS matching the final build. The isolated QA server on 39911 was stopped; existing fixture projects were reused and retained. No backend source or maintained service changed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `2d6879d` on 2026-10-01, following explicit approval. M04 was committed separately as `0e55b07`.
- **Next authorized step:** M05b, consolidate active navigation/layout CSS property by property.


### M05b handoff — 2026-10-01

- **Result and ownership:** [navigation.css](../src/client/navigation.css) gives the active shell one owner, imported by [styles.css](../src/client/styles.css) and bundled into the existing `styles.css` asset. It combines earlier active declarations with current menu/list/content rules and removes overwritten two-column widths, project/heading margins, redundant align/overflow resets, and repeated phone sticky offsets. [Design tokens](../src/client/design-tokens.css) now name the active 216 px menu and 300 px list widths. The obsolete generic project-tab class is removed from [App.tsx](../src/client/App.tsx), retaining the contextual class. The [CSS gate](../qa/check-css-tokens.ts) scans all client CSS; the [navigation check](../qa/check-navigation.ts) now uses the accessible “Project views” name for its absence-from-content assertion. Component/welcome/error styles remain owned by the component stylesheet. An independent read-only cascade review found no behavior regression.
- **Preserved boundaries:** the list remains adjacent at 900–1199 px, while the mobile header/content spacing still includes exactly 900 px; at 901 px the desktop header/vertical spacing applies. Settings keeps its block layout at tablet widths. Picker rules precede phone list rules, open-drawer rules precede compact resets, drawer/scrim/action stacking remains intact, and reduced-motion rules follow the transitions they disable.
- **Computed comparison:** an ignored browser harness compares every standard computed CSS property and bounding box for shell selectors against assets built from committed `2d6879d`, intercepted only inside QA contexts. All 224 route/drawer states match exactly across 12 widths (320, 390, 600, 601, 820, 899, 900, 901, 1180, 1199, 1200, 1440 px) and normal/reduced motion. Readiness includes loaded expanded diff content before measuring restored list routes. Another 28 exact comparisons cover Search results, disabled Changes/Git tabs from a controlled non-Git status response, and retained open drawers while resizing 899→900→901→899 and 1199→1200→1199. Baseline bundles, harnesses, and comparison data remain ignored under `qa/.artifacts/`.
- **Automated behavior checks:** `bun run typecheck`, `bun run qa:check`, and `bun run build` passed; 138 CSS token references resolve. A temporary undefined-token probe in the new stylesheet made the gate fail as expected, then was removed. Navigation parser tests passed (3 tests, 31 assertions). Loading, diff, Search, and live-change browser checks passed. The unmodified navigation check initially timed out on the preexisting cancellation path below, then passed in a sequential rerun, including Back/Forward, selected-card control, direct/invalid links, drafts, responsive panes, and the 899/900 boundary. A focused check confirms picker, Changes content/list, and Settings fit 320 px. Live-change diagnostics are retained at ignored `qa/.artifacts/live-changes-runs/run-PKKc1P/`.
- **Cancellation finding:** holding project opening and pressing Back deterministically leaves “Opening…” disabled on both the committed and current clients. Inspection identifies the missing reset after abort; the route-name label is not completed-project readiness. M05b leaves that state code unchanged. [M05c](#m05c--reset-canceled-project-opening) records the next focused fix and delayed-response regression; at this checkpoint it remained an application defect despite successful ordinary navigation runs. M05c now addresses the reset and the completion-before-cleanup window.
- **Visual evidence and artifact ownership:** fresh `bun run qa:capture` sets for picker, expanded Changes, Changes list, and Settings were inspected at phone, tablet portrait, tablet landscape, and desktop sizes. Every PNG matches the committed M05a image byte for byte, and all 16 capture records report no page-wide overflow. Reuse the curated [picker](../qa/screenshots/maintenance-m05-obsolete-picker/mobile.png), [Changes](../qa/screenshots/maintenance-m05-obsolete-changes/mobile.png), [list](../qa/screenshots/maintenance-m05-obsolete-list/mobile.png), and [Settings](../qa/screenshots/maintenance-m05-obsolete-settings/mobile.png) evidence instead of adding duplicate tracked images. Fresh comparison sets/manifests remain in ignored `qa/.artifacts/maintenance-m05b-navigation-*/`. All 446 tracked screenshot-tree files (445 PNG/manifest files plus `.gitkeep`) remain unchanged. Chrome emulation does not establish actual iOS/Android gestures or native browser behavior.
- **Operation:** rebuilt shared client assets. Both maintained review backends and the public HTTPS origin returned 200 for the app and `/api/roots`, and served JavaScript/CSS matching the final build. The isolated QA server on 39911 was stopped; existing fixture projects were reused and retained. No backend implementation or maintained service changed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `1d28fc5` on 2026-10-01, following explicit approval; M05a is separately committed as `2d6879d`.
- **Next authorized step:** M05c, restore the picker after canceled project opening, before M06 cache reuse.


### M05c handoff — 2026-10-01

- **Result and files:** [App.tsx](../src/client/App.tsx) clears the obsolete opening flag when no project open is needed. Both success/error handlers now check the request's abort signal and the latest synchronous route's project before touching the project handle, comments, saved selection, errors, or opening state. Back to the picker restores the same folder with an enabled “Open this folder” button. Cached handles and same-project section changes retain their existing behavior; no URL, HTTP, storage, or repository-write contract changed.
- **Regression evidence:** a focused copy of the new browser regression, intercepting assets built from committed `1d28fc5`, failed after Back waiting for the recovered picker button. The first flag-reset implementation fixed that path, but a deliberately buffered success released during `popstate` still acquired abandoned project ownership before cleanup; adding the synchronous route check made that assertion pass. The baseline bundle and comparison helper remain ignored in `qa/.artifacts/`.
- **Durable QA:** [project-opening-check.ts](../qa/project-opening-check.ts) is a focused helper invoked by [check-loading.ts](../qa/check-loading.ts), keeping the existing loading script from absorbing the whole cancellation harness. Native abort + same-folder retry pass at 320, 390, 820, 1180, and 1440 px with exactly two open requests and no page overflow. Five controlled late-result cases cover success released during Back, success/error while a replacement is pending, and success/error after its completion. Fully buffered responses avoid relying on body-download timing; the stale-result cases model a transport that completes despite cancellation. They check current route/project and persisted selection ownership. A normal, non-aborted open failure retains its error/recovery UI and permits one explicit retry.
- **Other checks:** `bun run typecheck`, `bun run qa:check`, and `bun run build` passed; 138 CSS token references resolve. Navigation parser tests passed (3 tests, 31 assertions). The final `qa:loading` run passed all new cancellation cases plus existing delayed loading, current-resource data, cached/renewed project handles, one-request project switches, expanded-diff height/cache/scroll, and Refresh checks. `qa:navigation` passed its unmodified rapid Back path, selected-card controls, history/direct links, draft preservation, responsive panes, 899/900 boundary, narrow Settings, and invalid-link recovery. `qa:feedback-transactions` passed all seven editing/check/clipboard/navigation/failure/history scenarios. An independent read-only review found no production blocker.
- **Visual evidence:** captured with `bun run qa:capture` and inspected the recovered picker at [phone](../qa/screenshots/maintenance-m05c-opening-recovery/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m05c-opening-recovery/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m05c-opening-recovery/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m05c-opening-recovery/desktop.png). An ignored capture proxy on 39912 injected a controlled open → abort → Back scenario and exposed the readiness selector only after the picker recovered; the maintained app was not modified by that harness. All four manifest records report no page-wide overflow. All 446 previously tracked screenshot-tree files remain unchanged. Browser emulation does not establish actual iOS/Android or installed-PWA interruption behavior; native clipboard behavior was not exercised.
- **Operation:** rebuilt shared client assets. Both maintained review backends and the public HTTPS origin returned 200 for the app and `/api/roots`, and served JavaScript/CSS matching the final build. The isolated QA server on 39911 and capture proxy on 39912 were stopped; existing fixture projects were retained. No backend implementation or maintained service changed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `b20b514` on 2026-10-01 after explicit approval; M05b is separately committed as `1d28fc5`.
- **Next authorized step:** M06, reuse the bounded cache implementation behind the existing diff-cache interface.

### M06 handoff — 2026-10-01

- **Result and files:** [diff-cache.ts](../src/client/diff-cache.ts) now delegates bounded storage to [ResourceCache](../src/client/resource-cache.ts), removing 21 repeated mechanism lines. The diff adapter retains its existing exports, module-scoped lifetime, working-copy identity, stale-result exclusion, and shared 128-entry/32 MiB estimated-byte budget for working and immutable commit diffs. The generic cache and all domain callers are unchanged. The documentation map, engineering conventions, loading record, and Git record now name the common mechanism and its domain owners; M05c's approved commit is recorded as `b20b514`.
- **Unit checks:** 11 new tests (49 assertions) exercise observable cache behavior through the public API: hit/miss eviction order, replacement promotion and byte growth/shrink accounting, removal exactly once, exact UTF-16 estimated-size limits, multiple oldest evictions, oversized-write value/order preservation, all working-copy key dimensions, stale exclusion/non-promotion, shared working/commit count pressure, and the configured diff byte budget. `bun run typecheck`, `bun run qa:check`, `bun test`, and `bun run build` passed: 99 tests, zero failures, 1,204 assertions across 19 files; all 138 CSS token references resolve. A separate read-only review found no remaining behavioral or test-quality concern.
- **Browser evidence:** `qa:loading` passed cached expanded-diff content/height/scroll through two Back/Forward cycles and fresh requests after Refresh, along with delayed/current-resource loading and all M05c cancellation/retry cases. `qa:git` passed immutable cache/card reuse, reading positions, branch/history/commit navigation, media, independent tabs, layout at all four standard sizes and 320 px, and the three-request queue bound; the observed peak was three at every standard size. `qa:live-changes` passed fresh data after accepted Update and manual Refresh, unchanged content before acceptance, card/draft/scroll preservation, four-size and 320 px fit, hidden-tab pause/resume, serialized checks, and error recovery.
- **Artifacts and limits:** no visible UI change was introduced. The live-change check produced diagnostic captures in ignored `qa/.artifacts/live-changes-runs/run-LBsdGo/`; no new curated milestone was added. All 451 tracked screenshot-tree files remain unchanged from `b20b514`. Browser checks use Chrome emulation; real iOS/Android gestures and installed-PWA interruption were not reverified. Cache size remains an estimate of serialized UTF-16 payloads, not measured total heap usage.
- **Operation:** rebuilt client assets. Both maintained backends and the public HTTPS origin returned 200 for the app and `/api/roots` and served JS/CSS matching the final build. Stopped the isolated server on 39911 after QA; its temporary live-change Git fixture was removed by the check, and existing inventory/history fixtures remain. Maintained services stay available.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `737a09b` on 2026-10-01 after explicit approval; M05c was committed separately as `b20b514`.
- **Next authorized slice:** M07, reuse syntax response validators while preserving diff token limits and reconstruction checks.

### M07 handoff — 2026-10-01

- **Result and files:** [shared/api.ts](../src/shared/api.ts) replaces duplicated diff syntax-state/token validation with the same private helpers used by Files. Syntax shape, language length, semantic-role checks, the 20,000-token line cap, and exact source reconstruction have one owner. Each domain retains its 100,000-token aggregate budget; diff checks that budget before parsing another token batch. All other diff guards remain unchanged. [tsconfig.client.json](../tsconfig.client.json) excludes shared Bun test roots while preserving production shared-code inclusion and strict checks. No wire format or helper export changed. M06's approved commit is recorded as `737a09b`.
- **Boundary evidence:** 16 [new public-parser tests](../src/shared/api.test.ts), with 89 assertions, cover supported syntax states and all 13 roles; malformed variants, language strings, token arrays/records/text/roles; empty/whitespace/Unicode/CRLF reconstruction; exact per-line and total token limits; total diff limits across hunks; early aggregate overflow rejection; and side/newline/span/hunk guards. An isolated copy of the final tests passes against committed `737a09b` validators and was removed afterward. The same tests pass with the refactor. Two review suggestions were applied so context-detail rejection cannot be masked by hunk counts, and overlap rejection cannot be masked by surrogate-boundary validation.
- **Automated checks:** `bun run typecheck`, `bun run qa:check`, `bun test`, and `bun run build` passed: 115 tests, zero failures, 1,293 assertions across 20 files; all 138 CSS token references resolve. After the final test-isolation adjustment, the type-check gate and all 16 boundary tests passed again. Existing Git diff, word-detail decoration, historical/API, Files, persistence, and transaction tests remain passing. The separate read-only review found no remaining concern.
- **Browser evidence:** `qa:diff` passed the phone working-copy flow, staged content, C syntax, saved language override/reload, compact gutter-free rows, wrap, contained horizontal scrolling, and sticky long-file heading. `qa:files` passed phone file navigation, C syntax, scrolling/wrap, and return to expanded Changes. `qa:git` passed historical text/media, branch/history/commit navigation, immutable cache/card reuse, reading positions, independent tabs, and layout at 390, 820, 1180, and 1440 px plus 320 px. Peak diff concurrency stayed at three at every standard size.
- **Artifacts and limits:** no visible UI change was introduced. These checks produced no new screenshots; all 451 tracked screenshot-tree files remain unchanged from `737a09b`. Existing captures remain dated evidence. Browser checks use Chrome emulation; real iOS/Android gestures and installed-PWA behavior were not reverified. The tests establish response-validator equivalence and budgets, rather than broader performance measurements.
- **Operation:** rebuilt client assets. Both maintained backends and the public HTTPS origin returned 200 for the app and `/api/roots`, and their served JS/CSS match the final build. Production server references to the shared API module are type-only; the validators run at the browser response boundary. Maintained services stay available. Stopped the isolated QA server on 39911; inventory/history fixtures remain, and the temporary pre-refactor comparison fixture was removed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `4eac2ec` on 2026-10-01 after explicit approval; M06 was committed separately as `737a09b`.
- **Next authorized step:** M08a, precise reviewable comment layers before the other independently reviewable domain/component contracts.

### M08a handoff — 2026-10-01

- **Result and files:** [comments.ts](../src/client/comments.ts) adds the explicit `ReviewLayer` union (staged/unstaged/untracked), uses it for `CommentAnchor.layer`, and removes unreachable conflict export ordering. The broad API `ChangeLayer` and line-anchor factory input remain at the status boundary, with the existing runtime conflict guard. Validated anchors carry the narrower contract through drafts, checks, copy snapshots/history, reattachment, and Undo. Storage/backup validation and transaction implementations are unchanged; store version 1 and backup versions 1–3 remain compatible. The other M08 substeps remain pending. M07's approved commit is recorded as `4eac2ec`.
- **Boundary evidence:** five new [comment](../src/client/comments.test.ts)/[backup](../src/client/backup.test.ts) tests and the extended all-layer export test add 33 assertions. They cover valid Old/New anchors for every reviewable layer; conflict factory rejection; atomic persisted draft/history rejection of conflict, unknown, and null layers; valid store round-trips; scrambled-input export ordering; and valid/conflict draft/history anchors across backup versions 1–3. These tests pass against the original runtime before the production edit and afterward. Existing transaction tests pass unchanged. A separate read-only review found no remaining concern.
- **Automated checks:** `bun run typecheck`, `bun run qa:check`, `bun test`, and `bun run build` passed: 120 tests, zero failures, 1,326 assertions across 20 files; all 138 CSS token references resolve. The focused comment/backup/transaction suite passes 39 tests with 214 assertions. Strict checking covers UI anchor consumers, reattachment, feedback ports, storage, and backup types without casts or new adapters.
- **Browser evidence:** `qa:feedback` passed phone comment creation, reload, checked preview, copy/history, Undo, clipboard fallback, and outdated-line exclusion. `qa:feedback-transactions` passed all seven held status/diff, editor cancellation/retry, navigation cancellation, late clipboard, rejection/reopen, and history-write serialization scenarios. Clipboard promises were controlled in the transaction check; actual device clipboard behavior was not exercised.
- **Artifacts and limits:** no visible UI change was introduced, and no new screenshots were generated. All 451 tracked screenshot-tree files remain unchanged from `4eac2ec`. The ordinary feedback check refreshed ignored `qa/.artifacts/feedback-storage.json` for fixture captures. Browser checks use Chrome phone emulation; tablet/desktop layouts, real iOS/Android gestures, and installed-PWA behavior were not reverified in this slice. The full unit suite covers Git/diff/API and historical inspection regressions; their browser checks were not repeated for this comment-type change.
- **Operation:** rebuilt client assets. Both maintained backends and the public HTTPS origin returned 200 for the app and `/api/roots`, and served JS/CSS matching the final build. Maintained services stay available. Stopped the isolated QA server on 39911 after the checks; inventory/history fixtures remain. No backend implementation changed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `acf06ca` on 2026-10-01 after explicit approval; M07 was committed separately as `4eac2ec`.
- **Next authorized step:** M08b, couple diff card source and interaction in a discriminated mode so historical cards cannot be paired with comment actions.

### M08b handoff — 2026-10-01

- **Result and files:** [DiffCardFrame](../src/client/DiffCardFrame.tsx), [DiffCard](../src/client/DiffCard.tsx), and [CommitViewer](../src/client/CommitViewer.tsx) use one private review/inspect mode for heading metadata and line interaction. Review has one entry shared by the heading and comment anchors; inspect carries the historical file. The frame reuses the body's existing review variant and forwards its mode directly, removing the independent `source`/`interaction` props. Heading expressions, IDs/classes/data attributes, loading and rendering behavior are preserved. M08a's approved commit is recorded as `acf06ca`.
- **Contract evidence:** the temporary JSX compiler comparison confirms valid modes and rejects all six contradictory/missing contracts described above; both unsafe pairings compile against the baseline. The comparison files were removed. A separate read-only review checked all heading expressions and both callers and found no remaining concern. No new test, cast, adapter, exported type, or dependency was added.
- **Automated checks:** `bun run typecheck`, `bun run qa:check`, `bun test`, and `bun run build` passed: 120 tests, zero failures, 1,326 assertions across 20 files; all 138 CSS token references resolve. The focused comment/backup/transaction/diff-detail suite passes 40 tests with 217 assertions. The strict gate also passed with the temporary positive/negative compiler probes.
- **Browser evidence:** `qa:line-action` passed phone context-New and removed-Old anchors, comment creation, feedback export, Escape dismissal, selection priority, 320 px fit, and desktop row/direct controls. `qa:git` passed historical text/media, explicit absence of a working-copy Comment action, wrapping/contained scrolling, branch/history/commit navigation, Back/Forward reading positions, immutable cache/card reuse, reload/direct links, independent tabs, and layout at 390, 820, 1180, and 1440 px plus 320 px. Peak diff concurrency remained three at each standard size.
- **Artifacts and limits:** no visible UI change was introduced and no new screenshots were generated. All 451 tracked screenshot-tree files remain unchanged from `acf06ca`. Existing captures remain dated evidence. Browser checks use Chrome emulation; real iOS/Android gestures, clipboard permissions, and installed-PWA behavior were not reverified. Reattachment and the full feedback transaction browser scenarios were not repeated; their source and mechanics are unchanged, and their unit tests pass.
- **Operation:** rebuilt client assets. Both maintained backends and the public HTTPS origin returned 200 for the app and `/api/roots`, and served JS/CSS matching the final build. Maintained services stay available. The isolated QA server on 39911 was stopped after the checks; the line-action check removed its own temporary fixture, while inventory/history fixtures remain. No backend implementation changed.
- **Review status:** accepted by the maintainer on 2026-10-01.
- **Commit status:** committed as `5942af5` on 2026-10-01 after explicit approval; M08a is separately committed as `acf06ca`.
- **Next authorized step:** M08c, narrow pure patch/content parser return types and preserve those variants through syntax/word decorators, then remove unreachable historical checks.

### M08c handoff — 2026-10-01

- **Result and files:** [git-diff.ts](../src/server/git-diff.ts) gives pure patch/content parsers a private text/binary/size-limit result type. [diff-syntax.ts](../src/server/diff-syntax.ts) and [diff-words.ts](../src/server/diff-words.ts) accept and return the canonical text variant, allowing decorations to change without promising arbitrary caller refinements. [git-history.ts](../src/server/git-history.ts) returns non-text outcomes before decoration and removes three unreachable stale/conflict checks. Working-copy loading already narrows to text. Parser/decorator algorithms, limits, wire formats, mutable state guards, and missing-parent/content/error handling remain unchanged. Unknown-response rejection stays in [parseCommitDiff](../src/shared/git.ts). M08b's approved commit is recorded as `5942af5`.
- **Behavior evidence:** five new tests add 30 assertions across [syntax fallbacks](../src/server/diff-syntax.test.ts), [historical content](../src/server/git-history.test.ts), and [immutable response validation](../src/shared/git.test.ts). They cover empty/plain-choice paths without source reads; null/rejected/mismatched sources on either side preserving valid rows and word detail; binary/oversized root-content and parent-patch outcomes; unknown stale/conflict rejection; and accepted text/binary/limit/media responses. The focused 21-test suite passes with 162 assertions against both committed `5942af5` producers/decorators and this refactor. Its isolated baseline copy was removed.
- **Type evidence:** a temporary server compiler comparison verifies the narrowed parser assignments and text-only decorator returns. All 12 expected negative cases are rejected: two broad baseline return assignments, six impossible parser states, two non-text decorator calls, and two false promises of preserved syntax/detail refinements. The probe and baseline source copy were removed. A separate read-only review found no remaining concern in the production/test diff.
- **Automated checks:** `bun run typecheck`, `bun run qa:check`, `bun test`, and `bun run build` passed: 125 tests, zero failures, 1,356 assertions across 22 files; all 138 CSS token references resolve. The strict gate also passed with the temporary positive/negative compiler probes. Existing Git patch/word detail, historical/API, source/containment, response validation, persistence, and transaction tests remain passing.
- **Browser evidence:** `qa:diff` passed phone working-copy navigation, staged content, C highlighting, saved language override/reload, compact gutter-free rows, wrapping, contained horizontal scrolling, and sticky long-file headings. `qa:git` passed historical text/media, no working-copy Comment action, branch/history/commit navigation, immutable cache/card reuse, reading positions, independent tabs, and layout at 390, 820, 1180, and 1440 px plus 320 px. Peak historical diff concurrency remained three at each standard size.
- **Artifacts and limits:** no visible UI change was introduced and no new screenshots were generated. All 451 tracked screenshot-tree files remain unchanged from `5942af5`. Browser checks use Chrome emulation; real iOS/Android gestures, clipboard permissions, and installed-PWA behavior were not reverified. Working-copy line-action and feedback transaction browser checks were not repeated in this server contract slice; their unit tests remain passing. No broader performance measurement was performed.
- **Operation:** rebuilt client assets and restarted both maintained backends. Both backends and the public HTTPS origin returned 200 for the app and `/api/roots`, with served JS/CSS matching the final build. Maintained services stay available. Stopped the isolated QA server on 39911 after the checks; inventory/history fixtures remain. Temporary compiler/runtime comparison files were removed.
- **Documentation correction — 2026-10-02:** at the maintainer's request, rewrote engineering conventions as reusable design principles and removed duplicated maintenance progress from entry-point docs. Behavior contracts stay in focused records; this plan owns review status and evidence.
- **Review status:** accepted by the maintainer on 2026-10-02.
- **Commit status:** committed as `86cc362` on 2026-10-02 after explicit approval; M08b is separately committed as `5942af5`.
- **Next authorized step:** M08d, replace the Git sidebar's whole inferred hook return type with an explicit list-view model and commands interface.

### M08d handoff — 2026-10-02

- **Result:** the sidebar declares private list-data and command contracts, separating its dependencies from the hook's inferred return shape. Commit loading, route ownership, rendering, and scroll behavior are preserved.
- **Verification:** strict type/CSS gates and build pass; the full suite passes 125 tests with 1,356 assertions. Temporary compiler probes accept a minimal list interface and the existing owner, and reject seven unwanted/missing/malformed dependencies; the probes were removed. Independent review found no remaining concern.
- **Browser evidence:** `qa:git` passes at 390, 820, 1180, and 1440 px plus the 320 px check. The added held Refresh check preserves loaded pages while pending and after failure, recovers successfully, and retains destination, cached diff, and collapse state. Existing navigation, pagination, media, wrapping, and three-request concurrency checks pass.
- **Delivery and limits:** client rebuilt and served by the maintained HTTP/HTTPS apps; health and asset-byte checks pass. The isolated QA server was stopped. All 451 tracked screenshot files are unchanged; no new captures or real-device checks were performed for this interface change.
- **Review/commit:** accepted and committed as `2a32695` after explicit maintainer approval on 2026-10-02.
- **Next authorized step:** M09a, extract the appearance/preferences owner.

### M09a handoff — 2026-10-02

- **Result:** [appearance-preferences.ts](../src/client/appearance-preferences.ts) owns live preferences behind an explicit values/commands interface. App and Settings no longer coordinate their lifecycle or duplicate reset defaults. Storage and backup formats, prepaint behavior, navigation, and visual structure are preserved.
- **Verification:** strict type/CSS gates and build pass; the full suite passes 125 tests with 1,356 assertions. `qa:themes`, `qa:typography`, and `qa:pwa` pass, covering palettes, system changes, prepaint loading, real Google font loading, review position, persistence, cross-tab updates, and backup export/import. New browser cases cover independent resets and persistence, malformed/cleared cross-tab storage, in-memory updates and reload with storage denied, and visible/contained code plus reset after blocking both Google font hosts. Independent source/QA/documentation review found no remaining concern; local links and whitespace checks pass.
- **Captures:** inspected full-page Settings with a dark app, light code, and 20 px Courier at [phone](../qa/screenshots/maintenance-m09a-settings/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m09a-settings/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m09a-settings/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m09a-settings/desktop.png) sizes. Controls and previews remain intact; the [manifest](../qa/screenshots/maintenance-m09a-settings/manifest.json) records no horizontal overflow.
- **Delivery and limits:** rebuilt assets match the maintained HTTP/HTTPS apps and health checks pass. The isolated QA server was stopped. Browser emulation was checked; no new real-device or installed-app gesture checks were performed. The blocked-font check verifies usable rendering and the available fallback stack, not the exact font face selected by the operating system.
- **Review/commit:** accepted and committed as `8eab286` after explicit maintainer approval on 2026-10-02.
- **Next authorized step:** M09b, move the shared modal primitive to its own owner for installation and feedback dialogs.

### M09b handoff — 2026-10-02

- **Result:** [modal.ts](../src/client/modal.ts) owns the shared presentation hook. Installation and both review dialogs import it directly. The implementation body matches committed `8eab286` exactly; the new private return contract exposes only its ref and cancel handler. M09a is committed as `8eab286`.
- **Verification:** strict type/CSS gates and build pass; the full suite passes 125 tests with 1,356 assertions. `qa:feedback`, `qa:feedback-transactions`, `qa:pwa`, and the extended `qa:voice` pass. Voice dismissal checks stop the mocked microphone without uploading, preserve typed feedback, and protect a reopened editor from a held transcription's late result; held-request waits have bounded cleanup.
- **Modal checks:** `qa:modals` passes at 390, 820, 1180, and 1440 px plus 320 px installation containment. It covers native presentation/focus, keyboard navigation without focusing background controls, inside interactions, Escape/header/backdrop dismissal, exact scroll-lock cleanup, Feedback-to-editor handoff, and latest-body saving. Header/Escape restore stable opener focus; backdrop dismissal leaves the background usable with the existing native focus behavior. Independent production and voice-QA review found no remaining concern.
- **Captures:** inspected the editor and idle voice footer at [phone](../qa/screenshots/maintenance-m09b-editor/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m09b-editor/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m09b-editor/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m09b-editor/desktop.png) sizes. Controls, text, and source context remain intact; the [manifest](../qa/screenshots/maintenance-m09b-editor/manifest.json) records no horizontal overflow.
- **Delivery and limits:** maintained HTTP/HTTPS health and rebuilt asset-byte checks pass. The isolated QA server was stopped. Checks used Chrome emulation and a mocked recorder/transcription endpoint; no new real-device gestures, microphone, clipboard, keyboard, or installed-app checks were performed.
- **Review/commit:** accepted and committed as `5a951ad` after explicit maintainer approval on 2026-10-03.
- **Next authorized step:** M09c, extract the feedback owner from App while preserving the existing transaction and editor lifetimes.

### M09c handoff — 2026-10-03

- **Result:** [review-feedback.ts](../src/client/review-feedback.ts) owns the loaded feedback session behind explicit values and actions. App no longer coordinates store persistence, editor saving, preview operations, Undo, or reattachment; it retains project acceptance, URLs, and polling policy. Dialog actions use current draft IDs. The transaction engine, anchor rules, and storage formats are unchanged. M09b is committed as `5a951ad`.
- **Verification:** strict type/CSS gates and build pass; the full suite passes 125 tests with 1,356 assertions. Feedback, all nine transaction scenarios, modals, voice, PWA, navigation, loading, tabs, and live-change browser checks pass. New cases cover copy completion/Undo after closing Feedback, a held clipboard lease across a real project switch with both stores isolated, Cancel/Old-side reattachment and checked export, persistent Delete, exact latest-body saving across Back and project changes, and editor/Feedback polling pause and close resume. The second-project transaction case uses real project identity/navigation with controlled Git responses; clipboard and voice promises remain controlled. Independent source and QA review found no material concern; local links and whitespace checks pass.
- **Captures:** inspected the checked preview at [phone](../qa/screenshots/maintenance-m09c-feedback/mobile.png), [tablet portrait](../qa/screenshots/maintenance-m09c-feedback/tablet-portrait.png), [tablet landscape](../qa/screenshots/maintenance-m09c-feedback/tablet-landscape.png), and [desktop](../qa/screenshots/maintenance-m09c-feedback/desktop.png) sizes. Source, feedback, selectable export, and controls remain intact; the [manifest](../qa/screenshots/maintenance-m09c-feedback/manifest.json) records no horizontal overflow.
- **Delivery and limits:** rebuilt assets match the maintained HTTP/HTTPS apps and health checks pass. The isolated QA server was stopped. Chrome emulation was checked; no new real-device gestures, microphone, clipboard, keyboard, or installed-app checks were performed.
- **Review/commit:** accepted and approved for commit by the maintainer on 2026-10-03.
- **Next authorized step:** M09d, extract the project/session owner while preserving accepted-open identity, canceled-opening recovery, recents, and per-tab restoration.
