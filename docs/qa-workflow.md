# Testing and visual QA

This document records the verification tools, procedures, and evidence for the app. The initial
implementation stage is closed as of 2026-09-30. Additional device and performance checks are
[optional future work](initial-implementation-plan.md#remaining-roadmap), not an active acceptance
gate. Keep the procedures below available for future fixes and improvements; recorded uncertainty
remains unverified until the relevant check is actually performed.

## Every small change

1. For code changes, run the project-local native TypeScript type checker with `bun run typecheck`
   and the CSS token and formatting checks with `bun run qa:check`. For documentation-only changes,
   check local links, referenced commands, and whitespace; browser captures and code tests are
   needed only when app behavior changes.
2. Exercise the behavior that changed. Add a lasting automated test when it protects an observable
   invariant or a bug that could recur.
3. For a UI change, capture the relevant state at four sizes and inspect the images for clipped
   controls, page-wide overflow, unreadable code, and obscured feedback actions.
4. Describe the behavior, checks, and any remaining device-specific uncertainty in the handoff to
   the maintainer.

Keep unit and integration tests focused on inputs and outputs. Prefer Git fixture repositories for
status/diff behavior, bounded invalid-input cases for APIs, and browser interactions for comment,
drawer, wrap, and copy flows. Avoid tests of private function call order, redundant getters, and
snapshots of incidental DOM structure. Remove exploratory tests that would only create maintenance
noise.

Keep the maintainer's running app available for review. Start fixture QA on a separate port with
`--root "$PWD/qa/.artifacts"`; the inventory fixture is created by
`bun qa/prepare-inventory-fixture.ts`, which refuses to overwrite an existing fixture. Client assets
are shared under `dist/`, so rebuild the current client before the handoff and reload the review
tab. Clean up QA processes you started without stopping the existing review service. Backend source
changes need a restart of the relevant service; frontend-only edits need `bun run build`.

## QA commands

The package exposes two QA commands: `bun run qa:check` for the static gate and `bun run qa:capture`
for screenshots. Run focused checks directly with Bun, for example
`bun qa/check-files.ts <local app URL>`. Fixture preparation and the formatting-hook check also run
directly from their scripts; the sections below document the required setup and arguments.

Dated review records retain the former `qa:<name>` aliases used at those checkpoints. Their current
invocation is `bun qa/check-<name>.ts`; the old `qa:fixture` and `qa:git-fixture` aliases correspond
to `bun qa/prepare-inventory-fixture.ts` and `bun qa/prepare-git-fixture.ts` respectively.

## Shared browser support

[browser-support.ts](../qa/browser-support.ts) owns headless installed-Chrome lifetime and scoped
context cleanup. Use `withQaBrowser` for a run and `withQaContext` for each isolated context. Pass
context options explicitly: `qaProfiles.phone` preserves the 390 × 844 mobile touch profile,
`qaProfiles.tabletPortrait` and `qaProfiles.tabletLandscape` the 820 × 1180 and 1180 × 820 tablet
touch profiles, `qaProfiles.desktop` the 1440 × 900 desktop, and `{}` retains Chrome's default
context options. `appUrl` accepts HTTP(S) URLs; scripts continue to own positional/flag requirements
and fixture selection. Keep feature interactions, requests and scenario assertions beside their
check.

The context scope records page errors from all tabs and popups before invoking the check. It fails a
completed check if any were collected and closes the context on either success or failure.
`assertNoHorizontalOverflow` checks the document with a two-pixel tolerance; feature checks still
own whether a code pane should scroll or wrap. Browser and context scopes close in `finally`.

The first adopters are `bun qa/check-files.ts`, `bun qa/check-media.ts` and
`bun qa/check-media-playback.ts`; their arguments and fixture defaults are unchanged. When changing
this shared owner, type-check and run the affected existing checks against the isolated fixture
server. Ordinary check output belongs in ignored `qa/.artifacts/`; these checks create no screenshot
milestones. The [M13a handoff](maintenance-plan.md#m13a-handoff--2026-10-05) records verification
and the remaining browser/fixture and server-test migrations.

The [first M13b batch](maintenance-plan.md#m13b-first-batch-handoff--2026-10-05) adds
`bun qa/check-search.ts`, `bun qa/check-selected-search.ts` and `bun qa/check-diff.ts` as callers of
the same interface. These checks retain their existing phone profile, arguments and inventory
fixture setup; code-pane geometry and feature assertions remain in each script. Run the affected
existing app flows when changing them.

The [M13b feedback batch](maintenance-plan.md#m13b-feedback-batch-handoff--2026-10-05) adds
`bun qa/check-feedback.ts`, `bun qa/check-line-action.ts` and `bun qa/check-modals.ts`. Feedback
retains its saved-state handoff to the clipboard-fallback context. Line actions retain their own
temporary Git fixture and cleanup. Modals use all four profiles with service workers blocked; dialog
geometry, focus, dismissal and scroll-lock checks remain local. Their usage and fixture requirements
are unchanged.

The [M13b project-entry batch](maintenance-plan.md#m13b-project-entry-batch-handoff--2026-10-05)
adds `bun qa/check-foundation.ts`, `bun qa/check-project-entry.ts` and `bun qa/check-tabs.ts`.
Foundation retains its flag arguments and saved browser state. Project entry retains its custom
breakpoint matrix and two fixture servers; the tab check retains default Chrome contexts and its
delayed-root release guard. Their scenario assertions and setup remain local.

The [M13b navigation batch](maintenance-plan.md#m13b-navigation-batch-handoff--2026-10-05) adds
`bun qa/check-navigation.ts`, `bun qa/check-history-controls.ts` and `bun qa/check-loading.ts`.
Navigation retains its compact/sidebar breakpoint checks; history controls retain their custom
viewport and touch matrix, default journal context and extra-tab scenarios. Loading retains its
private delayed-response helpers and their local gate cleanup. Run all three existing app checks
against the inventory/history fixture server when changing these callers.

The [M13b appearance/PWA batch](maintenance-plan.md#m13b-appearancepwa-batch-handoff--2026-10-06)
adds `bun qa/check-themes.ts`, `bun qa/check-typography.ts` and `bun qa/check-pwa.ts`. Themes retain
saved-state paths and the default prepaint context. Typography still requires real Google font
requests and waits for font registration before loading; its separate fallback context blocks both
Google hosts. PWA retains its download-enabled context and fresh import context through the offline
check. Their arguments and inventory fixture setup are unchanged.

The
[M13b voice/live changes/transactions batch](maintenance-plan.md#m13b-voice-live-changes-and-feedback-transactions-handoff--2026-10-06)
adds `bun qa/check-voice.ts`, `bun qa/check-live-changes.ts` and
`bun qa/check-feedback-transactions.ts`. Voice and transaction response gates release before scoped
context cleanup; transaction setup seeds storage and installs controls only on the app origin. Live
changes keeps four contexts open together, including its custom mobile tablet options and named
error collection, within the shared browser lifetime. It still owns its temporary Git fixture and
unique ignored screenshot runs. Recorder/transcription and clipboard controls remain mocked; these
checks do not establish physical-device behavior. Their arguments and fixture setup are unchanged.

The [final M13b browser batch](maintenance-plan.md#m13b-final-browser-batch-handoff--2026-10-06)
adds `bun qa/check-git.ts`, `bun qa/check-file-feedback.ts` and `bun qa/check-selected-feedback.ts`.
They retain their custom viewport/touch matrices, including mobile tablet contexts. Git releases its
delayed refs gate before scoped cleanup and collects errors from its direct-link tab. File feedback
closes its seeded context before restoring saved state; its legacy seed runs only on the app origin.
Fresh backup-import contexts, plain-folder/clean-Git file feedback and desktop Old/New selection
checks now use the same error collection and cleanup. Feature assertions, native Clipboard API
permissions and fixture restoration remain local. All feature checks share browser lifetime; the
screenshot command and loading's private scenario context cleanup retain their own contracts. This
completes the bounded browser adoption; package commands and the helper interface are unchanged.

## Shared server test fixtures

[test-support.ts](../src/test-support.ts) owns the repeated low-level server-test setup. `testGit`
runs Git with an explicit working directory and argument array, returns bytes, and supplies fixed
fixture author/committer names and emails in the child environment. `testGitText` keeps the existing
UTF-8 decoding and trimming used for object IDs and refs. Subprocess failures propagate to Bun.
These helpers initialize and mutate only owned test fixtures; production Git reads retain their
separate [read-only boundary](git-read-boundaries.md).

`withTempDirectory` creates an OS temporary directory with the caller's fixture prefix, awaits the
scenario, and removes that directory in `finally`. Nest scopes for independent approved/outside
roots so partial setup also releases the first root. Keep files, commits, repository formats,
containment attacks, FIFO/stream controls and assertions beside the scenario. Unrelated non-Git
fixtures can keep their local setup; this extraction introduces no runner or centralized fixture.

Run `bun run typecheck`, `bun run qa:check` and the existing `bun run test` suite when changing
these callers. The [M13c handoff](maintenance-plan.md#m13c-handoff--2026-10-06) records verification
of status, diff, history, objects, execution, API, media and Search callers.

## Repository formatting

The [formatting workflow](formatting-workflow.md) owns formatter configuration, automatic hook
installation, staged-file behavior, and its review evidence. Run `bun run format` after edits and
`bun run format:check` before delivery. Run `bun qa/check-format-hook.ts` when changing formatter or
hook setup; it uses an isolated Git fixture and checks staged formatting, partial edits, ignored
files, unusual names, deletions, and failure rollback without modifying this checkout's index.

## Screenshot command

Start the local app, then run:

```sh
bun run qa:capture --url http://127.0.0.1:3000/ --label foundation
```

The command launches the installed Google Chrome through Playwright and writes `desktop.png`,
`tablet-landscape.png`, `tablet-portrait.png`, `mobile.png`, and `manifest.json` to
`qa/screenshots/foundation/`. Use a new, descriptive label for each reviewable milestone; an
existing directory makes the command fail before opening Chrome, preserving the earlier capture. The
default is a viewport screenshot. Add `--full-page` when the entire continuous diff needs review,
`--ready '.selector'` if a screen must finish loading, and `--click '.selector'` to open a control.
Repeat `--click` for a sequence, such as the project switch then the install dialog. For a lazy
diff, add `--after-click-ready '.diff-code'` so capture waits for its lines. `--reveal-list` opens
the contextual drawer at narrower tablet widths before waiting for the ready selector, so a list
capture works at all four layouts. `--help` lists options.

For the foundation picker,
`bun qa/check-foundation.ts --url http://127.0.0.1:3000/ --folder <direct-child-name>` checks mobile
folder selection and reload, then saves browser state under `qa/.artifacts/`. Browser state files
omit per-tab `sessionStorage`; add `--active-path <folder-relative-path>` to capture the explicit
Changes URL for a selected project at all four sizes. Combine it with `--storage-state` when the
capture also needs saved drafts or preferences. To capture a particular Files or Search destination,
pass its full `--url` with query parameters; direct links are the authoritative navigable state.

## URL navigation and responsive screens

Run `bun qa/check-history-controls.ts http://127.0.0.1:39911/` against an isolated inventory-fixture
server to verify visible Back/Forward at 320 px and all four standard widths, native traversal,
Search return, reload, branching, Git-ref replacement, overlay/resizing behavior, touch targets, hit
testing, denied/malformed storage, independent tabs, and return from another document. The
[U01 record](pwa-navigation-and-file-feedback-proposal.md#u01-handoff--2026-10-04) links inspected
four-size captures and records device-verification limits. Unit checks live in
`src/client/navigation-history.test.ts`. History metadata stays out of review-data backups.

Run `bun qa/check-project-entry.ts http://127.0.0.1:39911/ http://127.0.0.1:39912/` for implicit
phone entry, the 600/601 px boundary, picker/menu recents, bare restoration, Review all changes,
Back/Forward, explicit content reload, rotation, touch targets, host-root failure, and containment.
The first server uses the inventory fixture root. The second uses a separate temporary approved root
**outside any Git worktree**, containing `clean-git` (a clean initialized Git repository with a
committed `readme.txt`) and `plain-folder` (a non-Git folder with `readme.txt`). Start that server
on its own port; stop only QA servers you started. Project-open failure/cancellation/retry remains
covered by `bun qa/check-loading.ts`. The
[U02 handoff](pwa-navigation-and-file-feedback-proposal.md#u02-handoff--2026-10-04) links all eight
inspected entry/review captures and records device limits. Existing phone feature checks use Review
all changes when they need continuous review.

`bun qa/check-navigation.ts` also checks that a URL-selected diff can be collapsed and that toggling
another card does not scroll back to it, on phone and desktop. Refresh must keep the selected card
collapsed; selecting it again, opening its direct link, and browser Forward must still expand and
focus it. The [diff navigation focus captures](../qa/screenshots/diff-navigation-focus/mobile.png)
show another expanded card after entering Changes through a file URL at all four sizes.

For loading and transition regressions, run `bun qa/check-loading.ts http://127.0.0.1:3000/` against
the inventory and history fixtures (prepare the latter with `bun qa/prepare-git-fixture.ts`). It
delays project, folder, file, and Search responses to check the 300 ms feedback delay,
route-specific content, and return to an open project. It also checks that expanded diffs retain
their content, height, and scroll position across Changes/Files Back and Forward, while Refresh
refetches. [Diff request checks](../qa/diff-loading-check.ts) also hold fully buffered responses
that ignore abort for working-copy and historical cards: collapse and changed language exclude
abandoned results from both view and cache, errors retry with the same override, reload restores it,
and a current working-copy stale response refreshes. The
[loading and transition record](loading-and-transition-polish.md) describes the behavior;
[loaded Files screenshots](../qa/screenshots/loading-polish-file/mobile.png) and
[expanded diff screenshots](../qa/screenshots/diff-cache-expanded/mobile.png) cover the four
viewport sizes.

Start the app with `--root "$PWD/qa/.artifacts"` and the inventory fixture present, then run
`bun qa/check-navigation.ts http://127.0.0.1:3000/`. The browser check covers the project picker,
tab navigation, Search results and file Back/Forward, reload and direct links, Files directories and
lines, a targeted Git diff, a comment draft preserved across Back and a project switch, phone
list/content screens, tablet Changes/Search/Files list access, desktop's three panes, and invalid or
unavailable link recovery. Run `bun test src/client/navigation.test.ts` for URL parser round trips
and rejection cases. The
[project picker](../qa/screenshots/navigation-project-picker-review/mobile.png),
[continuous Changes view](../qa/screenshots/navigation-changes-review/mobile.png),
[Files list](../qa/screenshots/navigation-files-final-review/mobile.png),
[Search results](../qa/screenshots/navigation-search-results-review/mobile.png), and
[Search file view](../qa/screenshots/navigation-search-file-final-review/mobile.png) each have
four-size captures. The
[live-change capture](../qa/screenshots/navigation-live-update-review/mobile.png) checks the update
action with the new shell. The
[live HTTPS project](../qa/screenshots/navigation-live-project-review/mobile.png) and
[direct file link](../qa/screenshots/navigation-live-file-review/mobile.png) captures check this
repository through the installed origin.

The hierarchy refinement places project identity and tabs in the contextual list, removes repeated
host/project headings, and moves Install & local data into Settings. Its four-size captures show
[Changes](../qa/screenshots/navigation-hierarchy-changes-review/mobile.png), the
[Files list](../qa/screenshots/navigation-hierarchy-files-list-review/mobile.png),
[Search](../qa/screenshots/navigation-hierarchy-search-review/mobile.png),
[Settings](../qa/screenshots/navigation-hierarchy-settings-review/mobile.png), and
[this repository over HTTPS](../qa/screenshots/navigation-hierarchy-live-review/mobile.png). The
[unified content navigation](../qa/screenshots/navigation-unified-content-review/mobile.png),
[phone list with tabs](../qa/screenshots/navigation-unified-list-review/mobile.png), and
[updated live HTTPS app](../qa/screenshots/navigation-unified-live-review/mobile.png) captures show
the later back-arrow refinement at all four sizes. `bun qa/check-navigation.ts` checks phone tabs
only with the list, the tablet drawer, the 899/900 px boundary, root Files breadcrumb, and Settings
actions at 320 px; `bun qa/check-pwa.ts` opens the backup dialog from Settings. The selected-code QA
uses a short viewport to test the docked action after the main header was removed.

The shared content-heading alignment was checked in loaded
[Changes](../qa/screenshots/nav-heading-changes-final/mobile.png),
[Files](../qa/screenshots/nav-heading-files-final/mobile.png), and
[Search result](../qa/screenshots/nav-heading-search-final-review/mobile.png) captures at phone,
tablet portrait, tablet landscape, and desktop sizes. The title has no extra top margin and shares
the vertical center of its row with the back and action buttons.

The following polish pass has four-size captures of the
[rounded phone Changes list](../qa/screenshots/navigation-polish-changes-list/mobile.png),
[folder browser and breadcrumb](../qa/screenshots/navigation-polish-folder-list/mobile.png), and
[file view with one visible path](../qa/screenshots/navigation-polish-file-view/mobile.png).
`bun qa/check-navigation.ts`, `bun qa/check-files.ts`, `bun qa/check-search.ts`, and
`bun qa/check-foundation.ts` cover navigation after the icon swap; a 320 px Chrome check covers
overflow in Changes list, Files list, and file content.

The [M05a maintenance record](maintenance-plan.md#m05a-handoff--2026-10-01) verifies obsolete UI/CSS
removal with four-size [picker](../qa/screenshots/maintenance-m05-obsolete-picker/mobile.png),
[expanded Changes](../qa/screenshots/maintenance-m05-obsolete-changes/mobile.png),
[Changes list](../qa/screenshots/maintenance-m05-obsolete-list/mobile.png), and
[Settings](../qa/screenshots/maintenance-m05-obsolete-settings/mobile.png) captures. All sixteen
final images match the pre-cleanup baselines byte for byte. The handoff records
responsive/navigation/loading/diff checks and an initial navigation timeout that was unisolated at
that checkpoint. M05b later reproduced the project-opening cancellation path described below.

The [M05b handoff](maintenance-plan.md#m05b-handoff--2026-10-01) records active navigation CSS
consolidation: 252 exact computed-style/geometry comparisons, including breakpoint and
reduced-motion states, Search results, controlled disabled Git tabs, and open drawers while
resizing. Sixteen fresh four-size captures match the committed M05a images byte for byte; their
comparison copies remain ignored and the curated images above are reused. Strict gates and loading,
diff, Search, live-change, and a sequential navigation rerun passed. A held project-open response
followed by browser Back deterministically leaves the picker disabled on both the committed and
refactored clients: aborting the operation does not clear its opening flag. The later
[M05c](maintenance-plan.md#m05c-handoff--2026-10-01) correction resets opening and adds the
route-ownership guard, with deliberate delayed-response regression checks; a successful ordinary run
alone does not prove cancellation is correct. The CSS gate now checks every client stylesheet.

`bun qa/check-loading.ts` now invokes [project-opening-check.ts](../qa/project-opening-check.ts):
native canceled-open → Back → same-folder retry at 320 px and all four standard sizes, success
released during `popstate`, late success/error while a replacement is pending or completed,
persisted selection ownership, and non-aborted failure/recovery. Controlled responses are fully
buffered, and the stale-result cases intentionally model completion despite cancellation. The
[M05c recovery captures](../qa/screenshots/maintenance-m05c-opening-recovery/mobile.png) show the
picker after a controlled opening request was aborted by Back at all four sizes. They were made with
`qa:capture` through an ignored local capture proxy; the manifest URL records that isolated origin.
Actual device/PWA interruption and clipboard behavior were not exercised by these checks.

On actual Android and iOS devices, open a direct Files or Search result URL in a new tab and in the
installed app, then try browser Back/Forward, project switching, a comment draft followed by Back,
tablet rotation, text selection, horizontal code scrolling, and the native edge Back gesture. The
optional list/content swipe remains deferred until these gesture interactions are checked.

For inventory screenshots, run `bun qa/prepare-inventory-fixture.ts` once to create
`qa/.artifacts/inventory-fixture` with staged, unstaged, and untracked changes. Start the app with
`--root "$PWD/qa/.artifacts"`, run `bun qa/check-foundation.ts` with `--folder inventory-fixture`,
then pass its saved browser state to `qa:capture`. The fixture script refuses to overwrite an
existing fixture; remove that ignored folder yourself when you need a fresh one.

Run `bun qa/check-diff.ts --url http://127.0.0.1:3000/ --folder inventory-fixture` against that
fixture to check a phone flow through the file drawer, staged diff rows, wrap persistence, open-card
persistence, contained horizontal scrolling, and the sticky heading of a long file.
[Long-file screenshots](../qa/screenshots/sticky-file-header/mobile.png) show the header after
scrolling at all four sizes. The same command checks C syntax tokens and a language override saved
across reload. [Syntax screenshots](../qa/screenshots/syntax-c-diff/mobile.png) show the expanded C
card at all four capture sizes.

Run `bun qa/check-files.ts http://127.0.0.1:3000/` with the inventory fixture under the approved
root to check phone Files navigation, syntax, wrapping, contained horizontal scrolling, and return
to an open diff.
[Working-tree Files screenshots](../qa/screenshots/files-working-tree-first/mobile.png) and
[non-Git Files screenshots](../qa/screenshots/files-nongit-first/mobile.png) each have four-size
captures. A non-Git folder must live outside any enclosing Git repository for that case; a directory
under `qa/.artifacts` is still inside this repository. The
[horizontally scrolled Files capture](../qa/screenshots/files-horizontal-scroll-first/mobile.png)
shows the sticky line-number gutter with wrapping off at the four standard sizes. The
[live project Files capture](../qa/screenshots/files-live-project-first/mobile.png) shows
`src/client/App.tsx` loaded through the HTTPS service at all four sizes.

Run `bun qa/check-search.ts http://127.0.0.1:3000/` against the inventory fixture to check the phone
Search tab, a deep result opening at its highlighted line, the sticky file path, drawer closure,
preserved results, refresh, a simulated deleted-result notice, and page width. The
[Search results](../qa/screenshots/search-results-first/mobile.png),
[result-to-file view](../qa/screenshots/search-file-jump-first/mobile.png), and
[deep-line jump](../qa/screenshots/search-deep-jump-review/mobile.png) have four-size captures. The
[live Search view](../qa/screenshots/search-live-project-review/mobile.png) uses this repository
over private HTTPS. For repeatable search captures, `qa:capture` accepts `--fill <selector> <value>`
interleaved with `--click`; use `--after-click-ready` to wait for results or the target row.

Run `bun qa/check-selected-search.ts http://127.0.0.1:3000/` against the same fixture to check
selection in a diff and a full file, tooltip repositioning on page and horizontal code-pane scroll,
rejection of a cross-line range, and Search submission. The
[revised tooltip captures](../qa/screenshots/selected-code-search-touch-placement/mobile.png) show
phone, tablet portrait, tablet landscape, and desktop without page-wide overflow. Touch placement is
below the selection, with a header-adjacent fallback when there is no room; desktop placement is
above. `qa:capture --select-text <code-selector> <text>` makes the selected-code action visible for
repeatable screenshots after the chosen clicks and scrolls. Real Android Chrome and iOS Safari still
need manual checks for native selection handles, browser selection menus, and long-press
interaction.

Run `bun qa/check-feedback.ts http://127.0.0.1:3000/` against the same fixture to check a phone flow
through line comments, reload persistence, export, copy history, Undo, Clipboard API absence, and
stale-line exclusion. It writes `qa/.artifacts/feedback-storage.json` for repeatable captures.
[Feedback preview](../qa/screenshots/feedback-first-slice/mobile.png) and
[comment editor](../qa/screenshots/comment-editor-first-slice/mobile.png) each have all four
viewport captures.

Run `bun qa/check-modals.ts http://127.0.0.1:3000/` against the inventory fixture to check comment,
Feedback, and installation dialogs at phone, tablet portrait, tablet landscape, and desktop sizes.
It covers native modal focus, background controls remaining inert during keyboard navigation, inside
interaction, Escape/header/backdrop dismissal, focus return after Escape/header close, exact
scroll-lock restoration, Feedback-to-editor handoff, and saving the latest edited body. It also
checks installation containment at 320 px. Voice QA separately covers editor dismissal while
recording or transcribing.

Run `bun qa/check-line-action.ts http://127.0.0.1:3000/` with `qa/.artifacts` as the server root. It
makes a temporary Git fixture with staged and unstaged versions of the same file, then checks the
hidden phone gutters, 320 px fit, unchanged-line New anchor, removed-line Old anchor, copied
feedback, selection priority, Escape, Feedback-button clearance, and desktop row clicks and direct
line controls. [Line action screenshots](../qa/screenshots/line-action-review/mobile.png) and
[long-code width screenshots](../qa/screenshots/line-action-code-width/mobile.png) each cover all
four capture sizes. Browser emulation does not prove native long-press selection or tap accuracy;
verify those on real Android and iOS devices.

Run `bun qa/check-typography.ts http://127.0.0.1:3000/` against the inventory fixture to check phone
Settings access before project selection, live preview, diff and Files fonts, scroll restoration,
320 px containment at 20 px, reload, and cross-tab updates. `bun qa/check-pwa.ts` checks version 3
backup export/import of typography and appearance alongside drafts.
[Settings](../qa/screenshots/font-list-20-settings-review/mobile.png) and
[larger diff text](../qa/screenshots/code-typography-diff-review/mobile.png) have four-size
captures. Font availability and comfortable reading should also be judged on actual devices.

The [Google font follow-up](google-code-fonts-followup.md) extends `bun qa/check-typography.ts` to
check that local choices make no Google request, that Settings offers 20 Google families, that
JetBrains Mono and a newly added family load, that diff rows have no separator border, and that the
selected family reaches the `<code>` content in both Changes and Files. Each Google Fonts CSS URL is
checked for an HTTP 200 response. Chrome loaded JetBrains Mono through the live HTTPS app after the
backend Content Security Policy update. The
[expanded Settings](../qa/screenshots/font-list-20-settings-review/mobile.png) and
[new font in review code](../qa/screenshots/font-list-20-code-closeup/mobile.png) have four-size
captures. The check also blocks both Google font hosts in a fresh context, verifies visible code and
containment at 320 px with the local fallback stack, and resets typography after the failed
download.

## Theme settings

Run `bun qa/check-themes.ts http://127.0.0.1:3000/` with `qa/.artifacts` as the approved root and
the inventory fixture present. It checks app/code independence in the Settings preview and real
diffs, the Files and feedback palettes, 320 px fit, reload, cross-tab sync including malformed
values and cleared storage, System preference changes, independent appearance/typography resets,
unavailable storage, and saved-theme application before the main browser app loads.
`bun qa/check-pwa.ts` checks version 3 backup export/import of a dark app and light code while
retaining drafts and typography.
[Dark Settings](../qa/screenshots/theme-dark-settings-review/mobile.png),
[dark app with dark code](../qa/screenshots/theme-dark-app-dark-code-review/mobile.png),
[dark app with light code](../qa/screenshots/theme-dark-app-light-code-review/mobile.png), and
[light app with dark code](../qa/screenshots/theme-light-app-dark-code-review/mobile.png) each have
phone, tablet portrait, tablet landscape, and desktop captures. Check reading comfort, native
controls, and the installed app's status bar on real devices.

## Live change detection

Start the app with `--root "$PWD/qa/.artifacts"`, then run
`bun qa/check-live-changes.ts http://127.0.0.1:3000/`. It creates and removes a temporary Git
project. The script checks that a same-length edit to an already modified file raises the Update
action without replacing the displayed diff, then confirms Update keeps expanded cards, a draft
comment, and a deliberately scrolled tall-file reading position. It checks the 320 px phone width,
editor/Feedback and hidden-tab polling pauses, immediate resume, serialized status requests,
repeated-check recovery, failed manual Update with retained inventory/preferences/draft and
successful retry, and manual Refresh.

Each run saves four pending-action screenshots and `manifest.json` in a fresh ignored
`qa/.artifacts/live-changes-runs/run-<suffix>/` directory and prints its path. These diagnostics
remain available after the temporary project is removed; repeated checks preserve earlier runs and
tracked milestone images. Use `qa:capture` with a fresh descriptive label to create a curated
milestone explicitly. The [phone](../qa/screenshots/navigation-live-update-review/mobile.png),
[tablet portrait](../qa/screenshots/navigation-live-update-review/tablet-portrait.png),
[tablet landscape](../qa/screenshots/navigation-live-update-review/tablet-landscape.png), and
[desktop](../qa/screenshots/navigation-live-update-review/desktop.png) links preserve the reviewed
navigation milestone; routine runs no longer rewrite them. Inspect the action's reachability on real
phone browsers as well as in emulation.

Run `bun qa/check-voice.ts http://127.0.0.1:3000/` against the inventory fixture to check transcript
insertion at a saved caret, selected-range replacement, failure and Retry with the original clip,
Cancel without upload, automatic Send at five minutes, and control access in a keyboard-sized
viewport using a mocked recorder and endpoint. It also dismisses the editor during recording and a
held transcription, checking track cleanup, saved typed feedback, and protection of a reopened
editor from late results. The [idle voice footer](../qa/screenshots/voice-comment-idle/mobile.png)
and [recording footer](../qa/screenshots/voice-comment-recording/mobile.png) have four viewport
captures. `qa:capture --fake-microphone` uses Chrome's synthetic microphone to capture recording
controls. Browser emulation does not prove real microphone permission, audio capture, start/stop
cues, or iOS/Android keyboard behavior. Test those on devices through the private HTTPS origin. A
local endpoint smoke check can POST a non-sensitive WebM speech fixture to `/api/transcriptions`; it
must return validated text through FFmpeg and Handy.

Run `bun qa/check-tabs.ts http://127.0.0.1:3000/` to check that two tabs keep different projects
across reload and bare `/` restoration while sharing recents. It also checks explicit-link priority,
delayed root completion after a route change, and one-time legacy selection migration. Run
`bun qa/check-pwa.ts http://127.0.0.1:3000/` to check manifest/icon delivery, service-worker offline
fallback, that API responses stay out of its cache, and draft backup export/import with invalid-file
rejection. The [install/data dialog](../qa/screenshots/tab-pwa-install-data/mobile.png) and
[review view](../qa/screenshots/tab-pwa-review/mobile.png) have four-size captures. Browser QA does
not prove actual Android or iOS installation; check that on real devices after HTTPS is enabled.

The current tailnet HTTPS deployment uses port 8443, leaving the machine domain's default HTTPS root
free. The [live project view](../qa/screenshots/https-port-8443-review/mobile.png) has four-size
captures from that address. A port change creates a new browser storage origin, so export and import
local review data before leaving an origin that contains drafts.

The capture exits nonzero for page load failures or page-wide horizontal overflow. A horizontally
scrolling **code pane** is allowed; the document itself should fit the viewport. Inspect the images
rather than relying solely on the overflow check. Link useful screenshots in the human handoff.
Generated test traces and temporary files belong in `qa/.artifacts/`; curated milestone screenshots
remain under `qa/screenshots/`.

Use `--scroll-x-to-end '.diff-scroll'` to capture a code pane at its far-right edge. The
[wrapped](../qa/screenshots/diff-marker-left-wrap/mobile.png) and
[horizontal-scroll](../qa/screenshots/diff-marker-left-scroll/mobile.png) sets show compact rows,
left-hand change markers, fixed gutters, and background coverage at all four sizes. The
[tapped collapsed heading](../qa/screenshots/diff-header-tap-collapsed/mobile.png) set shows its
rounded border and background.

For a long file header, use `--click` to expand its card, `--after-click-ready` to wait for diff
lines, then `--scroll-to` the card and `--scroll-offset 360` to capture its header while the page is
partway through the file.

The command uses desktop Chrome with emulated touch, viewport, and mobile settings for smaller
screens. This does not reproduce mobile Safari or Android Chrome exactly. Use real devices for long
press, double tap, keyboard/safe-area layout, clipboard, and voice recording before those features
are called complete.

## Feedback transaction races

For feedback transaction changes, also run
`bun qa/check-feedback-transactions.ts http://127.0.0.1:39909/` against an isolated server approving
`qa/.artifacts` with `inventory-fixture` present. It holds status/diff/clipboard results to check
edits, same-project navigation, project-switch isolation, late-result cancellation, preview-close
completion and Undo, feedback/history write serialization, failure/retry, and persisted reloads. It
creates the empty second-project picker fixture as needed and uses controlled Git responses for that
case. Clipboard promises are controlled; this does not establish real-device clipboard permission or
gesture behavior. Its optional second command argument is a compiled baseline client bundle for a
before/after regression comparison, served only inside the isolated browser contexts. The
[feedback record](feedback-slice-proposal.md) links maintenance evidence.

## Native media previews

Use `bun qa/prepare-media-fixture.ts` and `bun qa/prepare-media-av-fixture.ts` to create ignored Git
fixtures under `qa/.artifacts/`; both commands refuse to overwrite an existing fixture. The
audio/video fixture generator needs FFmpeg with H.264 encoding. Start the local app with
`--root "$PWD/qa/.artifacts"`. Run `bun qa/check-media.ts http://127.0.0.1:3000/` for image
rendering and the raw SVG script restriction, then
`bun qa/check-media-playback.ts http://127.0.0.1:3000/` for mobile Chrome audio/video loading,
seeking, and raw byte ranges.

Capture four sizes with `bun run qa:capture --active-path media-fixture` or
`--active-path media-av-fixture`. Use `--media-ready` to wait for native player metadata. The
[image Old/New cards](../qa/screenshots/media-images-diff-first/mobile.png),
[current Files image](../qa/screenshots/media-images-files-review/mobile.png),
[final HTTPS audio/video cards](../qa/screenshots/media-av-live-ready-review/mobile.png), and
[final HTTPS Files video](../qa/screenshots/media-av-live-control-review/mobile.png) have phone,
tablet portrait, tablet landscape, and desktop captures. The script checks do not replace playback
and raw-link checks in real Android Chrome and iOS Safari over HTTPS.

## Git branches and commits

Run `bun qa/prepare-git-fixture.ts` once to create `qa/.artifacts/history-fixture`; it refuses to
overwrite existing content. Start the fixture server on a separate port with
`--root "$PWD/qa/.artifacts"`, then run `bun qa/check-git.ts http://127.0.0.1:39901/`. The fixture
includes local/remote branches, a root commit, over 50 commits for paging, an empty history
checkpoint, a first-parent merge, a full multi-paragraph message, five changed files, mode changes,
Old/New SVGs, long C code, and a worktree that differs from the selected historical commit.

The check runs at phone, both tablet orientations, and desktop sizes. It covers default branch URL
normalization without closing an opened drawer (including a delayed-ref tablet check), paging, held
Refresh failure/recovery with loaded-page retention, branch selection, direct links/reload and
independent tabs, full messages/all changed files, historical line inspection without Comment, image
loading/raw-side links, wrapping and contained horizontal scrolling, Back/Forward reading positions,
collapsed cards and diff-cache reuse through Files, merge labeling, and the three-request
concurrency bound. Metadata checks cover matching list/detail line totals and times, two-row
alignment, compact parent/root/first-parent labels, and 320 px fit with long authors, full hashes,
and large totals. The [Git behavior record](git-history-slice-proposal.md#verification--2026-09-30)
also lists Git/API fixture coverage and shared-renderer regression checks.

The inspected four-size milestones are
[the Git list](../qa/screenshots/git-history-list/mobile.png),
[full commit and diff cards](../qa/screenshots/git-commit-inspection/mobile.png), and
[historical highlighted code](../qa/screenshots/git-historical-code/mobile.png). The metadata
refinement adds four-size [list metadata](../qa/screenshots/git-metadata-list-review/mobile.png) and
[commit metadata](../qa/screenshots/git-metadata-summary-review/mobile.png) sets. Pass the full Git
URL to `qa:capture`; use `--reveal-list --ready '.git-commit-row .commit-added'` for the list and a
commit-specific ready selector for content. The fixture's commit IDs are recorded in ignored
`qa/.artifacts/history-fixture-info.json`. On actual Android/iOS browsers and the installed PWA,
verify branch selection, opening a commit, returning to its list, native selection, horizontal
scrolling, and Back/Forward.

## Word-level diff detail

Use a Git fixture with several edited lines plus an inserted or deleted line. Expand its change
card, then capture the [wrapped review](../qa/screenshots/word-detail-review/mobile.png) and
[unwrapped, horizontally scrolled review](../qa/screenshots/word-detail-scroll/mobile.png) at all
four standard sizes. The screenshots should keep syntax colors, source text, line-number gutters,
and added/removed row colors intact while marking only changed spans on clear pairs. Check selection
contrast and no page-wide overflow. `bun qa/check-diff.ts`, `bun qa/check-selected-search.ts`, and
`bun qa/check-feedback.ts` cover compact rows, selected-code Search through decorated markup, and
line comments/copy in mobile Chrome emulation. Verify native selection handles and comment tapping
on real phones when reviewing the slice.

## Baseline matrix as features arrive

| Area             | Behavior to verify                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host boundaries  | Allowed root succeeds; traversal and symlink escapes fail; invalid API data is rejected.                                                                 |
| Git layers       | Staged, unstaged, and untracked changes stay separate, including two layers on one path; renames, deletion, binary files, and odd names are represented. |
| Git inspection   | Full/root/merge/empty commits, stable history paging, exact historical sources, project scope, Old/New previews, and Git URL/cache navigation.           |
| Review UI        | Menu/list/content navigation works at phone, tablet, and desktop widths; files collapse; code wraps or scrolls inside its pane; no page-wide overflow.   |
| Feedback         | Old/new line anchors are clear; drafts survive reload; copy history records only successful copies; export includes path, layer, side, and line.         |
| Search and files | Search result opens its file and line; older versions and unsupported previews fail safely.                                                              |
| Voice            | Recording and cancellation, permission denial, insertion at the saved caret, upload limits, Handy errors, and temporary-file cleanup.                    |

Run checks for the feature being built; do not create an exhaustive suite before the corresponding
behavior exists.

## Working-tree file feedback

`bun qa/check-file-feedback.ts http://127.0.0.1:39911/ http://127.0.0.1:39912/` checks the U03
follow-up. The first isolated server approves `qa/.artifacts`, with the existing inventory fixture.
The check creates/restores only `inventory-fixture/src/feedback notes β.txt` there for CRLF,
blank/last-line, changed-file and deletion cases. The second isolated server must approve a fixture
root outside any enclosing Git repository containing `plain-folder/readme.txt` and a clean Git
`clean-git/readme.txt`; the U02 setup is recorded in ignored
`qa/.artifacts/usability-u02-plain-root.txt` on this checkout. The maintainer's running project is
not a mutation fixture.

The check covers 320 px and all four standard widths, legacy migration, file-line actions and
keyboard access, reload, mixed preview/clipboard/history/Undo, Files/Search identity, selection
priority, stale exclusion/reattachment, read-failure retry, and actual non-Git/unchanged Git
file-only checks without status requests. Clipboard uses Chrome's granted Clipboard API on loopback.
Browser emulation does not establish physical-device clipboard, gesture, keyboard or microphone
behavior. Saved browser states stay under ignored `qa/.artifacts/` and support the U03
action/editor/preview captures via `qa:capture`.

## Selected-code feedback

`bun qa/check-selected-feedback.ts http://127.0.0.1:39911/` uses the inventory fixture under
`qa/.artifacts`. It creates/restores `src/selection-feedback.ts` to check repeated fragments,
whitespace/tokens, Unicode, wrapped ranges, save/reload, clipboard/history/Undo, source replacement,
reattachment, Search, backup transfer and diff Old/New/annotation boundaries at 320 px plus the four
standard viewports. Exact offsets are selected through native DOM Ranges; the app receives no
special test source metadata. Saved browser states support action/editor/preview `qa:capture`
milestones. Existing `bun qa/check-selected-search.ts` covers page/horizontal scrolling and invalid
cross-row selection; `bun qa/check-file-feedback.ts` covers legacy whole-line flows and source-kind
reattachment guards.
