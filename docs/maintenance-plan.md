# Maintenance plan after the prototype review

Status: in progress; M01–M03 committed; M04 accepted and approved for commit; M05 next authorized

Created: 2026-09-30

Updated: 2026-10-01

The maintainer requested a codebase review after closing the initial implementation stage, then requested this work plan and gave the implementation go-ahead on 2026-10-01. **M01: correct staged media sources in repository subfolders** is accepted and committed as `ba62d1d`, following explicit approval to commit and continue. **M02: restore transcription API error translation** is accepted and committed as `cbe97fb`, following explicit approval to commit and continue. **M03: own feedback check/copy transactions** is accepted and committed as `59cadf3`, following explicit approval to commit and continue. **M04: separate QA output from milestone captures** is accepted with explicit approval to commit and continue to M05. Completed slices stay uncommitted for maintainer review.

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

M01 is accepted and committed as `ba62d1d`; M02 as `cbe97fb`; M03 as `59cadf3`. M04 is accepted and approved for commit; M05–M15 are pending, with M05 next authorized. The order is the proposed sequence for the authorized maintenance pass, with a review handoff for each small change. M09 and M13 contain several independently reviewable extractions. M15 starts with measurement; an optimization depends on its evidence.

| ID | Slice | Main dependency | Completion evidence |
| --- | --- | --- | --- |
| M01 | Correct subfolder staged media sources | None | Scope/source regression fixtures and existing API/Git tests |
| M02 | Restore transcription API error translation | None | HTTP-boundary invalid-upload tests |
| M03 | Own feedback check/copy transactions | None | Delayed-response and clipboard race tests |
| M04 | Separate ordinary QA output from milestone captures | None | A QA run leaves tracked milestone images untouched |
| M05 | Remove obsolete UI/CSS; consolidate navigation rules | M04 before captures | Four-size inspection and focused navigation checks |
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

**Implemented and accepted 2026-10-01; approved for commit:** each live-change check allocates a fresh directory under ignored `qa/.artifacts/live-changes-runs/` using `mkdtemp`, writes its four viewport screenshots and manifest there, and prints the directory path. Runs preserve earlier diagnostic output as well as tracked milestones. The explicit `qa:capture` command continues to require a fresh milestone label. The [handoff below](#m04-handoff--2026-10-01) records repeated-run and preservation checks.

## M05 — Remove obsolete UI and consolidate layout CSS

**Confirmed deletion candidates:** the unreachable folder-picker “Back to project” button in [App.tsx](../src/client/App.tsx) and its sole `.sidebar-switch-mode` rules; `.project-ready`, `.ready-icon`, `.changes-footnote` and their responsive overrides in [styles.css](../src/client/styles.css); the solely associated `--ready-action-indent` token; and the ineffective `.project-view-changes` margin modifier/rules.

**Substeps:** remove the confirmed remnants first. Then consolidate the earlier two-column and appended current navigation CSS property by property. Earlier blocks still contain active declarations and welcome/error-screen styles; do not delete whole blocks from their age alone.

**Expected behavior:** the current layout, drawer breakpoints, sticky headers, welcome/invalid-link states, and controls retain their appearance and operation. The stylesheet presents one coherent definition of the current shell.

**Validation:** navigation and loading checks; inspected four-size captures of the affected picker, list/content and Settings states; 320 px overflow and the 899/900 px list boundary; wrapping/horizontal code-pane scrolling; CSS token gate. Record the actual removed declarations and evidence in the handoff.

## M06 — Reuse the bounded cache implementation

**Finding:** [diff-cache.ts](../src/client/diff-cache.ts) repeats the LRU promotion, replacement accounting, oversized-value rejection, and eviction already in [resource-cache.ts](../src/client/resource-cache.ts).

**Smallest slice:** use `ResourceCache<DiffResult>` behind the existing diff API. Retain the 128-entry/~32 MiB budget, diff identity builder, and stale-result exclusion.

**Validation:** promotion/oldest eviction, replacement byte accounting, oversized values, and stale-result rejection. Run relevant loading and Git cache/navigation checks. Keep working-copy invalidation and immutable commit identities in their domain callers; cached first-render height must remain available before scroll restoration.

## M07 — Reuse syntax validators

**Finding:** [shared/api.ts](../src/shared/api.ts) has `parseSyntaxState` and `parseSyntaxTokens` for Files but repeats their logic in diff parsing, including syntax-role allowlists and exact token-text reconstruction.

**Smallest slice:** reuse these validators while preserving per-line and aggregate diff token limits. Keep source-text, span, line-number, and hunk consistency checks intact.

**Validation:** malformed roles, token/source mismatch, invalid syntax state, and aggregate budgets through the relevant response parsers. Preserve existing word-detail tests. A later file split may group syntax/media/diff/file contracts with their parsers if it improves discovery; it is not a requirement to complete this de-duplication.

## M08 — Tighten domain and view contracts

Make these independently reviewable type changes without widening user-visible scope:

- In [comments.ts](../src/client/comments.ts), define reviewable layers precisely. Stored anchors cannot contain `conflict`; keep a broad factory input only where its boundary guard is useful.
- In [DiffCardFrame.tsx](../src/client/DiffCardFrame.tsx), couple source and interaction in one discriminated mode so historical cards cannot be paired with comment actions. Current callers are correct.
- In [git-diff.ts](../src/server/git-diff.ts), narrow pure patch/content parser results to variants they produce. Preserve those variants through syntax/word decorators and remove resulting unreachable checks in historical callers.
- Give [GitSidebar.tsx](../src/client/GitSidebar.tsx) an explicit list-view model/commands interface instead of the whole inferred hook return type.

**Validation:** strict type checking and current comment, diff, Git/API, and historical-inspection tests. Preserve runtime boundary guards. Reduce unnecessary exports when a symbol is internal, but keep intentional test seams and compatibility APIs; absence of external callers does not by itself prove the underlying code is dead.

## M09 — Extract cohesive App owners and views

**Finding:** [App.tsx](../src/client/App.tsx) has 924 lines, 44 state/ref declarations, and 22 effects across unrelated resource lifetimes and the responsive shell.

Each row below is a separate reviewable substep. Proposed names are illustrative; choose names matching the final responsibility.

| Substep | Owner and interface | Important invariants/checks |
| --- | --- | --- |
| M09a | Appearance/preferences controller: typed preferences and change/reset actions; owns storage events, system theme, DOM application, and font loading | Theme bootstrap, cross-tab updates, font fallback, Settings; `qa:themes`, `qa:typography`, relevant PWA checks |
| M09b | Shared modal primitive used directly by installation and feedback dialogs | Focus/cancel/close behavior and voice/editor lifetime; feedback and PWA checks |
| M09c | Feedback controller: store/editor/operation state and edit/check/copy/undo/reattach actions | M03 transaction rules, conservative anchors, persistence and navigation saving |
| M09d | Project/session controller: resolved project/opening/error state and project-opening actions | Root/project identity, recents, per-tab restoration, unavailable project recovery; tabs/navigation/loading checks |
| M09e | Working-copy review controller: displayed status, pending-update state and refresh/accept/toggle actions | Polling pauses/resumes, serialized requests, loaded snapshot, card preferences, review position; live-change/loading/navigation checks |
| M09f | Presentational project picker, Files sidebar, and Changes content | Explicit small props; current phone/tablet/desktop hierarchy, focus, wrapping and overflow |

Keep Files/Search resource state keyed to its current project/path/query. Extract it further only where the move creates a coherent owner. Do not use one generic loading hook for working-copy status, mutable files, branch snapshots, and immutable commits. Navigation extraction comes last and only if it can retain synchronous route ownership, draft saving, and one-time focus without introducing a second source of truth.

**Validation:** run focused browser checks and four-size captures after each relevant extraction. Rebuild the client for review. Update state ownership references in the documentation map and affected behavior records as files move.

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

- **Result and files:** added [FeedbackTransactions](../src/client/feedback-transactions.ts) as the owner of check cancellation/generations and the shared clipboard lease; replaced captured-store commits in [App.tsx](../src/client/App.tsx) with synchronous current-store updates. [Comment helpers](../src/client/comments.ts) own matching-anchor validity merges, checked export snapshots, exact-version removal, history bounds, and capacity-safe Undo. [FeedbackDialog](../src/client/ReviewDialogs.tsx) uses the checked snapshot for manual text, shows pending-copy status, and disables overlapping writes. The [feedback record](feedback-slice-proposal.md) and [engineering conventions](engineering-conventions.md#feedback-transactions) document ownership and cancellation.
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
- **Commit status:** explicitly approved on 2026-10-01. M03 was committed separately as `59cadf3`.
- **Next authorized slice:** M05, starting with confirmed obsolete UI/CSS remnants before a separate review of navigation CSS consolidation.
