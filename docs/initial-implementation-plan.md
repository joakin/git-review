# Initial Implementation Plan

Status: initial implementation stage complete and closed; remaining ideas are optional

Updated: 2026-09-30

The maintainer confirmed the app is usable and useful and closed this stage on 2026-09-30. No
implementation or acceptance slice remains active. Further improvements can be chosen in new threads
from the [optional backlog](#remaining-roadmap); they are not required to complete this stage.

## Goal

Build a read-only, host-served code review app that works well on a phone, tablet, and desktop. A
user opens the web UI, selects a folder on the host, reviews staged, unstaged, and untracked
changes, adds line comments, and copies a line-numbered feedback summary into an editing session.
The same app browses and searches current working-tree files and inspects branches and commits.
General browsing of older file trees remains optional later work. Drafts and convenience state
survive reloads in the browser.

The initial release also supports voice dictation into a comment without an OpenAI API key or
per-request API charge. The selected implementation uses the locally installed Handy model through
Handy's headless file transcription command.

## Decisions and constraints

| Area                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and tooling        | Bun for the TypeScript server, package management, browser build, and tests. Git remains the source of repository state.                                                                                                                                                                                                                                                                                                                                       |
| UI                         | Preact with hooks and plain CSS. One browser application with responsive layouts.                                                                                                                                                                                                                                                                                                                                                                              |
| Type checking              | Project-local, stable TypeScript 7 native compiler. Bun transpiles; `tsc --noEmit` is the required type-check gate.                                                                                                                                                                                                                                                                                                                                            |
| Syntax highlighting        | Shiki on the server, returning per-line tokens. Reuse one highlighter and load grammars as needed.                                                                                                                                                                                                                                                                                                                                                             |
| Persistence and navigation | Explicit URLs identify the project and navigable screen; `/` restores a tab's active project from `sessionStorage`. Recent folders, drafts, copy history, and preferences use versioned `localStorage` records per browser origin and project. No account or sync service in the initial release. See [the navigation record](navigation-and-url-history-slice-proposal.md) and [the independent tabs and PWA proposal](independent-tabs-and-pwa-proposal.md). |
| Speech to text             | Browser recording sent to the Bun server, normalized by FFmpeg to 16 kHz mono WAV, then transcribed by Handy's local headless CLI.                                                                                                                                                                                                                                                                                                                             |
| Repository access          | Read-only APIs. Explicit host directory roots, path containment checks, and no shell interpolation.                                                                                                                                                                                                                                                                                                                                                            |

The initial host research recorded Bun 1.3.1, Deno 2.7.11, Git 2.55.0, FFmpeg, Handy 0.9.6, and a
global TypeScript 5.9.3 compiler. The project installed its own TypeScript 7 native compiler;
current dependency versions belong in `package.json` and `bun.lock`. Bun was selected for its
built-in server, browser bundler, and test runner. These versions and the original Deno comparison
are research context, not a requirement to keep host tools at those versions.
[Bun bundler](https://bun.sh/docs/bundler),
[Deno bundle](https://docs.deno.com/runtime/reference/cli/bundle/),
[TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## User journeys

1. **Open a project.** The web app lists host directories inside server-approved roots. Select a
   folder. If it is a Git repository, open Changes; otherwise, open Files with a clear non-Git
   state. Recent projects are shown in the picker.
2. **Review changes.** The file list groups Staged, Unstaged, and Untracked. Select a file to jump
   to its card. Expand or collapse cards, inspect highlighted code, toggle wrapping, and add
   comments to old or new lines.
3. **Browse and search.** Open any allowed working-tree file. Select code text and use its Search
   action to find it in the working tree; tap a result to open that file at its matching line.
4. **Dictate a comment.** Place the caret in a line comment, tap the textarea-footer microphone,
   record on the phone, and send the clip for local transcription. Insert the returned text at that
   caret, then edit the draft normally. The recording footer has separate Cancel and Send controls,
   a five-minute limit, and audible start/stop cues.
5. **Send feedback.** Preview comments grouped by file and Git layer, copy the text, and paste it
   into an editing session. Successful copies enter history. An unsuccessful copy preserves the
   draft.
6. **Inspect commits.** Choose Git, select a local or already-present remote branch, and browse its
   paginated commit list. Open a commit's full message and all changed-file diffs in the existing
   review style, including historical media. Line taps reveal Old/New information. This flow is
   inspection only; file-specific history and historical comments remain optional.

The [working-tree Files browser](file-browser-slice-proposal.md),
[Working-tree Search](search-slice-proposal.md),
[selected-code Search shortcut](selected-code-search-slice-proposal.md), and
[local voice comment slice](local-voice-comment-slice-proposal.md) are implemented and approved. The
maintainer promoted [branch and commit inspection](git-history-slice-proposal.md) on 2026-09-30 and
approved the completed delivery, including line totals and date/time metadata. File-specific history
and browsing old trees remain optional later work.

The [URL history and navigation redesign](navigation-and-url-history-slice-proposal.md) is
implemented: browser Back/Forward and direct links cover the main destinations, with a separate
menu, contextual list, and content pane. Continuous Changes review remains the default. Changes /
Files / Search / Git tabs and the project identity live in the contextual list. On phones, tabs
appear only on that full-width list screen. The contextual list stays beside content at widths of
900 px and above; narrower tablets can reveal it from the content heading.

## Responsive interface

### Wide desktop

- Sticky top bar with the active project. The menu, contextual list, and content pane are visible
  together.
- The menu holds project switching, recents, and Settings. Installation and local data tools live in
  Settings. The contextual list shows the project name and path, Changes / Files / Search / Git
  tabs, and the corresponding changed files, project files, Search results, or branch/commit list.
  The reading pane opens directly with its task content.
- Changes opens a continuous review page of collapsible cards by default. Files and Search can open
  a working-tree file beside their list. Feedback remains reachable while scrolling.

### Tablet

- At widths of 900 px and above, the contextual list stays beside the content pane while the menu is
  a drawer. Below 900 px, the contextual list is a drawer. The host folder picker fills the
  available screen when that route is open.
- A single back arrow beside the Changes, Files, Search, or Git content title reveals the list
  drawer when it is hidden. Feedback stays reachable while scrolling.

### Phone

- The Changes / Files / Search / Git tabs appear only on the full-width contextual list screen.
  Switching tabs stays on that screen. The menu is a drawer; choosing a host folder, browsing a
  contextual list, or reading content uses the full width.
- Selecting a changed file, browsed file, search result, or commit opens the full-width content
  screen. The same back arrow beside its title returns to the relevant list. Browser Back and
  Forward follow URL history, including folder navigation, Search result files, branches, and
  commits.
- One-column inline diffs only. Wrapping is on by default. When off, each code pane scrolls
  horizontally without widening the page. A row tap reveals the hidden phone gutters and comment
  action.
- Comment editor and feedback preview open as bottom sheets. Touch controls have comfortable targets
  and stay clear of browser safe areas and the on-screen keyboard.
- Avoid nested vertical scroll areas. All expanded review cards remain in one page flow; fetch each
  card's diff only when needed. Commit cards start expanded and use at most three concurrent diff
  requests.

Use text labels and symbols as well as color for added, removed, and outdated content. Restore open
cards and wrap preference after reload; retain list and review scroll positions during route
navigation where practical. Phone diff gutters are hidden for code width and revealed by tapping a
row, as described below.

### Appearance settings

The [code typography slice](code-typography-slice-proposal.md) adds a Settings screen with 11–20 px
and System mono/Courier choices, live preview, browser persistence, and backup support. The
[Google code fonts follow-up](google-code-fonts-followup.md) adds 20 optional monospace web fonts
and removes diff-row dividers. The [theme settings slice](theme-settings-slice-proposal.md) adds
reviewed personal app and code palettes through frontend design tokens; the server continues to
return semantic syntax roles.

### Phone portrait line action slice

The change-sign and old/new number columns took roughly a quarter to a third of a narrow phone's
code width. The [phone line-action record](phone-portrait-gutter-slice-proposal.md) hides those
columns on phones and reveals sign, line numbers, and one Comment action when a row is tapped or
clicked at any size. Unchanged lines use the New side in every Git layer. Browser QA covers
selection and anchoring; test gestures on real phones before calling the slice fully verified.

### Touch interactions

- A short tap or click on a diff code row reveals its sign, available old/new numbers, and a single
  Comment action. Phones hide the gutters; wider screens keep direct old/new number buttons. A
  removed line anchors to Old; added and unchanged lines anchor to New.
- Native code selection takes priority over the line action. Selected code offers Search. A drag or
  long press must not launch a line comment.
- Keyboard users can focus a line control and operate it without touch gestures. Validate gesture
  timing and selection behavior on iPhone Safari and Android Chrome, not only emulated viewports.

## Git and file model

Use `git status --porcelain=v2 -z --untracked-files=all` to obtain stable, machine-readable paths
and states. The same path may produce two review entries when it has both staged and unstaged
changes. [Git status](https://git-scm.com/docs/git-status)

| Review layer | Old side   | New side     |
| ------------ | ---------- | ------------ |
| Staged       | `HEAD`     | Index        |
| Unstaged     | Index      | Working tree |
| Untracked    | Empty file | Working tree |

Handle a repository without a first commit by treating `HEAD` as an empty tree. Preserve renames,
deleted files, file modes, conflicts, submodules, and binary status in the model, even when a text
hunk is unavailable. Request a per-file patch with fixed Git options when its card opens. Use
`--no-ext-diff`, `--no-textconv`, `--no-color`, a fixed context length, and an argument array ending
in `--` before a path. [Git diff](https://git-scm.com/docs/git-diff)

Each text diff has a layer, source-correct old/new sides, and hunks. Each `DiffLine` has kind,
old/new line numbers, source text, syntax tokens, and a validated word-change detail variant. The
[diff fidelity slice](diff-fidelity-slice-proposal.md) adds bounded word-change spans across paired
lines in multi-line edit chunks. Exact move indicators are a later optional refinement. Do not infer
an edited move from a weak match.

Shiki supplies grammar scopes for line tokens. Keep its full language bundle on the server and load
the needed grammar on demand. Return bounded syntax roles with exact token text; the browser applies
colors from CSS variables so theme changes need no new diff response. Detect languages from
filenames and extensions, and offer a per-file override for ambiguous or unknown types. Reuse the
highlighter and loaded grammars; consider caching tokenization by content hash and language if
profiling shows a need. Highlight source text before combining it with diff word spans.
[Shiki usage](https://shiki.style/guide/install),
[Shiki bundles](https://shiki.style/guide/bundles),
[Shiki performance](https://shiki.style/guide/best-performance)

The first Files slice shows bounded working-tree text and named states for binary, link, oversized,
and unsupported files. The [media preview slice](media-preview-slice-proposal.md) now adds native
image (including SVG), audio, and video previews in Files and source-correct Git change cards, each
with raw new-tab links. Change cards show Old then New vertically; Files shows the current
working-tree file. PDF can wait; HTML preview is not needed.
[Git inspection](git-history-slice-proposal.md) reuses this presentation with historical Old/New
blobs; general browsing of old trees remains deferred.

Git's commit list is scoped to the selected project, including a repository subdirectory. The list
and commit summary show aligned author/date-time and hash/line-total rows, with a compact parent
label in the summary. Totals follow the same comparison as the cards: parent → commit, empty tree →
root commit, or first parent → merge commit. Read historical metadata, syntax, diffs, and previews
from exact Git objects. Missing shallow parents have an explicit unavailable comparison and totals.
History paging stays pinned to its tip until Refresh; immutable commit payloads use bounded
tab-memory caches and keep historical card state separate from working-copy preferences.

## Search

Use ripgrep (`rg`) as a bounded read-only subprocess for fixed-string searches in both Git and
non-Git working-tree folders. Its JSON Lines output provides paths, line numbers, and matching text;
keep project ignore rules, include hidden source files, explicitly exclude `.git`, and never follow
symlinks. Limit result count, subprocess output, individual file size, and wall time; cancel stale
client requests and show grouped results with path, line number, and excerpt. Search results open
the current working-tree file and scroll to the line. The HTTPS service checks Homebrew locations
because its launch environment omits Homebrew from `PATH`; `GIT_REVIEW_RG_PATH` is an override. The
[Search behavior document](search-slice-proposal.md) records the first reviewable scope.
[Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)

The selected-code shortcut submits a validated single-line selection as a case-sensitive literal
query. Whole-word and case options are not implemented. Search runs on the server; the browser does
not receive or index the entire codebase.

## Comments, persistence, and export

A project-keyed comment store holds each anchor's path, Git layer, old/new side, line number, exact
source text, and neighboring context. Opening Feedback rechecks the current Git status and diffs. A
changed or missing anchor becomes outdated and is excluded from export until explicitly reattached
and checked again. Automatic relocation by context remains a possible future refinement; the current
behavior never silently moves an anchor.

Save drafts as edits occur, using versioned `localStorage` keys and a small migration path. Recent
projects, wrap choice, collapsed-card state, language overrides, appearance, typography, and bounded
copy history persist there as well; the active project uses per-tab `sessionStorage`. Recent-file
history is optional future work. A copy succeeds only after the clipboard API resolves; then store
an immutable history snapshot and clear the copied drafts, with an immediate Undo action. On
failure, keep the drafts and show selectable feedback text.

Export plain text with relative paths, Git layer, side, line number, source text, and the comment.
The current formatter produces text like:

```text
Review feedback for "/repo"

[staged] "src/parser.ts"
  old line 18  "return parse(input);"
    This case still needs coverage.

[unstaged] "src/view.ts"
  new line 42  "const result = render();"
    Please handle the empty result here.
```

History and drafts are local to each browser and origin; they do not sync across devices. Do not
store audio recordings in browser storage.

## Voice transcription design

### Original engine research

The engine comparison below records the research used to choose Handy. It is historical context; the
[voice behavior record](local-voice-comment-slice-proposal.md) describes the implemented
integration.

OpenAI Docs describe Codex and ChatGPT desktop voice or dictation as input to their own
conversations and composer. The documented OpenAI CLI transcription command calls the API. There is
no documented subscription-backed transcription endpoint for an unrelated web UI, so Codex or
ChatGPT are not the integration path for this app. API-key usage follows API pricing, which
conflicts with the no-API-cost requirement.
[ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice),
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[OpenAI CLI transcription](https://developers.openai.com/api/docs/libraries/openai-cli),
[OpenAI Docs pricing](https://learn.chatgpt.com/docs/pricing)

Handy is a local speech-to-text app. Its public CLI page currently documents recording controls
rather than file-to-text output, but Handy's headless transcription feature was merged in June 2026.
The installed `/Applications/Handy.app/Contents/MacOS/handy` version 0.9.6 confirms these flags in
`--help`:

```text
-f, --transcribe-file <WAV>  Transcribe a 16 kHz mono WAV headlessly and exit
--model <MODEL>               Optional model ID; defaults to the selected model
--json                        Emit file transcription results as JSON
```

The host already has a Handy Parakeet V3 model installed. This is a direct local route for
recordings made on the phone, with no external inference service. A synthetic speech fixture was
transcribed through the CLI, local endpoint, and private HTTPS service on 2026-09-28; Handy returned
JSON with the expected `text`. The CLI exited with code 134 in this task's sandbox but worked with
ordinary host permissions. The maintainer reported that phone dictation works well. See the
[voice slice proposal](local-voice-comment-slice-proposal.md).
[Handy repository](https://github.com/cjpais/Handy),
[Handy headless CLI change](https://github.com/cjpais/Handy/pull/1541),
[Handy public CLI page](https://handy.computer/docs/cli)

### Request flow

1. In a comment sheet, place the caret and tap the microphone button in the textarea footer. The
   browser saves that range, requests microphone permission, and records with `getUserMedia` and
   `MediaRecorder` using a supported format selected at runtime.
2. Show a timer, local microphone-level display, and separated Cancel and Send controls. Play a
   start cue and a stop cue. At five minutes, stop and automatically submit the clip for
   transcription. While a voice clip is pending, keep the textarea read-only so the saved insertion
   point remains valid.
3. Send the audio to the same-origin Bun endpoint `POST /api/transcriptions` over the private HTTPS
   service. The current app has no account system; the server accepts only bounded audio uploads and
   does not let the client choose a host path or executable.
4. FFmpeg decodes and normalizes the clip to 16 kHz, mono, 16-bit PCM WAV. Invoke Handy with fixed
   argument-array values: `--transcribe-file <temporary-wav> --json`.
5. Parse the returned transcript, return text to the browser, and remove temporary audio in a
   `finally` path. Insert the text at the saved caret (or over only the selected range) and let the
   user edit the comment. On failure, keep the recording in memory for Retry without changing the
   comment.

FFmpeg is present on this host; packaging should make it an explicit optional runtime requirement
for voice. Keep the transcription adapter behind a small interface so a future supported Handy
IPC/API or another local engine can replace the subprocess without changing the UI. Limit one active
transcription per host initially, set a timeout, and show a useful error when Handy or its model is
unavailable. Never log audio or transcript content by default.
[MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder),
[FFmpeg resampling](https://www.ffmpeg.org/ffmpeg-resampler.html)

Handy's normal desktop shortcut can also dictate directly into a focused comment field when
reviewing on the Mac. It uses the Mac microphone, so it does not solve phone recording by itself.
The original research also found a proposed Handy local HTTP API; the implemented app uses the
verified file-transcription CLI and does not depend on that proposal.
[Handy local API proposal](https://github.com/cjpais/Handy/pull/509)

### Secure origin requirement

Mobile microphone capture and programmatic Copy feedback both require a secure browser context.
Localhost is trusted for desktop use. The current remote setup uses private Tailscale Serve HTTPS on
port 8443, an exact configured public origin, and approved filesystem roots; run instructions are in
[README](../README.md). Text entry remains available when microphone capture is unavailable. General
LAN pairing and certificate setup are not implemented.
[MDN microphone security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[MDN clipboard security](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API),
[secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts.)

## Server/API outline

| Endpoint                                                                                | Purpose                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/roots`, `GET /api/directories`                                                | Browse permitted host folders.                                                                                      |
| `POST /api/projects/open`                                                               | Resolve a selected folder to a stable project ID.                                                                   |
| `GET /api/projects/:id/status`                                                          | Return Git layer groups, a status revision, and a metadata-based change token.                                      |
| `GET /api/projects/:id/diff`                                                            | Return one file/layer's parsed hunks and highlighted lines.                                                         |
| `GET /api/projects/:id/git/refs`, `GET /api/projects/:id/git/log`                       | Read local/remote branches and bounded history pages pinned to a tip.                                               |
| `GET /api/projects/:id/git/commits/:oid`, `GET /api/projects/:id/git/commits/:oid/diff` | Read full commit metadata, comparison inventory, and per-file historical diffs.                                     |
| `GET /api/languages`                                                                    | Return Shiki's bundled language IDs and display names for overrides.                                                |
| `GET /api/projects/:id/tree`, `GET /api/projects/:id/file`                              | Browse working-tree paths and read bounded current files.                                                           |
| `GET/HEAD /api/projects/:id/raw/file`, `GET/HEAD /api/projects/:id/raw/diff`            | Serve version-checked image/audio/video bytes from the correct worktree or Git side, including bounded byte ranges. |
| `GET/HEAD /api/projects/:id/raw/commit`                                                 | Serve version-checked historical Old/New media from the exact comparison blobs.                                     |
| `GET /api/projects/:id/search`                                                          | Return bounded server-side search matches.                                                                          |
| `POST /api/transcriptions`                                                              | Transcribe one bounded audio clip locally over the private, same-origin HTTPS service.                              |

Use a small shared TypeScript schema for responses and validate all untrusted inputs at runtime.
Resolve paths beneath configured roots after symlinks, prevent traversal, and pass Git/FFmpeg/Handy
arguments without a shell. Default to loopback binding; explicit binding to the host's Tailscale
IPv4 address supports direct tailnet access, and Serve proxies HTTPS to a loopback backend.
Same-origin checks and no permissive CORS apply today. The
[Git inspection record](git-history-slice-proposal.md) defines its read-only APIs; broader LAN
access still needs a separate design. Keep the app read-only with respect to repository files.

## Project structure

```text
AGENTS.md          Collaboration, type safety, and verification rules
README.md          Run instructions and current status
docs/initial-implementation-plan.md
docs/README.md     Documentation map and state lifetimes
docs/foundation-slice.md
docs/qa-workflow.md
qa/capture.ts      Browser screenshot capture at review milestones
qa/check-foundation.ts  Mobile folder selection and reload check
qa/screenshots/    Curated desktop, tablet, and mobile images
src/client/        Preact UI, styles, local state, audio capture
src/server/        Bun routes, Git adapter, file access, search, transcription
src/shared/        Wire types and runtime validation
src/client/comments.ts  Comment anchors, persistence, and feedback export
src/**/*.test.ts   Behavior tests colocated with their domain code
tsconfig.base.json
tsconfig.client.json
tsconfig.server.json
package.json
```

Type checking runs with the project-local native TypeScript 7 compiler. Enable `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`,
and unused-code checks. Keep server and client library/type environments separate. Use Bun's build
and test commands without a framework-specific toolchain.

## Delivery record and acceptance checks

1. **Foundation and secure access (complete):** Bun/Preact scaffold, native TypeScript type-check
   gate, folder picker, approved-root enforcement, loopback/direct-tailnet serving, and private
   HTTPS installation.
2. **Git and file model (complete):** Status, lazy diffs, bounded current-file reads, native media,
   binary handling, and Search. Git fixtures protect layer/source mapping, unusual paths, stale
   reads, and containment. Branch/commit inspection has since been implemented and reviewed; a
   general historical Files browser remains optional.
3. **Review UI (complete):** Responsive menu/list/content layout, continuous collapsible cards,
   syntax and word overlays, wrap toggle, full-file view, and URL navigation. Browser captures cover
   narrow phones and both tablet orientations.
4. **Feedback (complete):** Line interactions, durable drafts, conservative anchor checks and
   reattachment, preview, copy, and history. Copy output identifies every comment's file, layer,
   side, and line.
5. **Voice (complete):** Handy headless transcription, browser recording, FFmpeg normalization, a
   bounded endpoint, and insertion at the saved comment caret. Browser QA covers cancellation,
   Retry, five-minute automatic Send, and keyboard-sized layout; additional real-device interruption
   and iOS capture checks are optional and remain unverified.
6. **Git inspection (complete):** Read-only branches and paginated history, full messages, immutable
   parent/root/merge comparisons, historical media, Git URLs, cached card/scroll state, and matching
   list/detail totals and timestamps. Fixture tests and four-size browser QA pass; maintainer
   delivery review and approval to commit are complete.
7. **Device and performance pass (optional, deferred):** Additional touch, clipboard, microphone,
   large-project, and interruption checks can be selected in a future thread. This pass is not a
   remaining acceptance gate for the closed stage.

Keep a visible Refresh action and poll status while the page is active so new edits appear without
losing the review position. Set size limits and progressive loading for unusually large files; an
ordinary change set should remain a single continuous page.

The core Git review, Git inspection, Files, Search, media, feedback, voice, appearance, live-update,
and navigation slices are implemented and reviewed. The maintainer approved the navigation redesign
on phone, tablet, and desktop. The [loading and navigation polish](loading-and-transition-polish.md)
is committed as `471521e`, including tab-memory diff caching and one-time URL target focus. The
[documentation map](README.md) links the behavior and QA records.

## Stage closure — 2026-09-30

- **Accepted result:** the maintainer considers the app usable and useful for their code review
  workflow and has chosen to close this implementation stage.
- **Delivered baseline:** `22de40e` (`feat: add branch and commit inspection with line totals`)
  includes the final reviewed Git work, its tests, documentation, and QA captures. The preceding
  review, Files, Search, feedback, voice, media, appearance, installation, navigation, and loading
  slices are also delivered.
- **Verification record:** the latest code delivery passed strict type checking, the CSS token
  check, 48 tests with 406 assertions, and focused Git browser QA on phone, both tablet
  orientations, and desktop. The
  [Git record](git-history-slice-proposal.md#verification--metadata-refinement-2026-09-30) preserves
  the evidence and its device limits. Previously unverified checks remain unverified.
- **Future collaboration:** there is no active next slice. Further improvements will be discussed in
  new threads, with the existing proposal/review workflow. Use the optional backlog below to choose
  work when the maintainer requests further improvements.
- **Operation:** the app remains available using the existing host services and HTTPS setup, with
  its stored drafts/preferences. Run instructions remain in the [root README](../README.md).

## Remaining roadmap

**All items are optional future work.** There is no assigned order, deadline, or active next item.
This heading is retained for existing links. Select scope and agree an approach with the maintainer
in a new thread before starting another feature.

- **Additional device and performance checks:** iOS selection and microphone behavior, clipboard and
  keyboard layouts, interruptions during recording, large changes, and refreshes while drafts are
  present. The maintainer has confirmed selected-code Search and dictation work on their phone; the
  additional checks remain unverified.
- **Recent files:** a bounded per-project recent-file list. Its user flow and storage shape need a
  proposal and maintainer agreement.
- **Broader Git inspection:** file-specific history, browsing complete old trees, and historical
  comments. Current Git branch/commit inspection is already complete.
- **Additional previews:** PDF previews. Images, SVG, audio, and video are already supported; HTML
  preview is not planned.
- **Diff detail:** moved-block indicators, if they become useful enough to justify the work.
  Word-level detail is already complete.
- **Phone navigation gesture:** a list/content swipe only if real-device testing establishes that it
  adds value without conflicting with browser Back, code scrolling, or native selection.
