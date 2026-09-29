# Initial Implementation Plan

Status: planning document  
Updated: 2026-09-29

## Goal

Build a read-only, host-served code review app that works well on a phone, tablet, and desktop. A user opens the web UI, selects a folder on the host, reviews staged, unstaged, and untracked changes, adds line comments, and copies a line-numbered feedback summary into an editing session. The same app can browse and search files, including older Git versions. Drafts and convenience state survive reloads in the browser.

The initial release also supports voice dictation into a comment without an OpenAI API key or per-request API charge. The selected implementation uses the locally installed Handy model through Handy's headless file transcription command.

## Decisions and constraints

| Area | Decision |
| --- | --- |
| Runtime and tooling | Bun for the TypeScript server, package management, browser build, and tests. Git remains the source of repository state. |
| UI | Preact with hooks and plain CSS. One browser application with responsive layouts. |
| Type checking | Project-local, stable TypeScript 7 native compiler. Bun transpiles; `tsc --noEmit` is the required type-check gate. |
| Syntax highlighting | Shiki on the server, returning per-line tokens. Reuse one highlighter and load grammars as needed. |
| Persistence and navigation | Explicit URLs identify the project and navigable screen; `/` restores a tab's active project from `sessionStorage`. Recent folders, drafts, copy history, and preferences use versioned `localStorage` records per browser origin and project. No account or sync service in the initial release. See [the navigation record](navigation-and-url-history-slice-proposal.md) and [the independent tabs and PWA proposal](independent-tabs-and-pwa-proposal.md). |
| Speech to text | Browser recording sent to the Bun server, normalized by FFmpeg to 16 kHz mono WAV, then transcribed by Handy's local headless CLI. |
| Repository access | Read-only APIs. Explicit host directory roots, path containment checks, and no shell interpolation. |

This machine currently has Bun 1.3.1, Deno 2.7.11, Git 2.55.0, FFmpeg, and Handy 0.9.6. The global `tsc` is 5.9.3, so TypeScript 7 must be installed within the project. Bun is preferred because its server and browser bundler are built in; Deno's current browser bundling command is experimental. TypeScript 7 is the native compiler release. [Bun bundler](https://bun.sh/docs/bundler), [Deno bundle](https://docs.deno.com/runtime/reference/cli/bundle/), [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## User journeys

1. **Open a project.** The web app lists host directories inside server-approved roots. Select a folder. If it is a Git repository, open Changes; otherwise, open Files with a clear non-Git state. Recent projects are shown in the picker.
2. **Review changes.** The file list groups Staged, Unstaged, and Untracked. Select a file to jump to its card. Expand or collapse cards, inspect highlighted code, toggle wrapping, and add comments to old or new lines.
3. **Browse and search.** Open any allowed working-tree file. Select code text and use its Search action to find it in the working tree; tap a result to open that file at its matching line. Repository and file commit history is a distant optional expansion.
4. **Dictate a comment.** Place the caret in a line comment, tap the textarea-footer microphone, record on the phone, and send the clip for local transcription. Insert the returned text at that caret, then edit the draft normally. The recording footer has separate Cancel and Send controls, a five-minute limit, and audible start/stop cues.
5. **Send feedback.** Preview comments grouped by file and Git layer, copy the text, and paste it into an editing session. Successful copies enter history. An unsuccessful copy preserves the draft.

The [working-tree Files browser](file-browser-slice-proposal.md), [Working-tree Search](search-slice-proposal.md), [selected-code Search shortcut](selected-code-search-slice-proposal.md), and [local voice comment slice](local-voice-comment-slice-proposal.md) are implemented and approved. Repository and file commit history, including opening files at older revisions, is a distant optional slice.

The [URL history and navigation redesign](navigation-and-url-history-slice-proposal.md) is implemented: browser Back/Forward and direct links cover the main destinations, with a separate menu, contextual list, and content pane. Continuous Changes review remains the default. Changes / Files / Search tabs and the project identity live in the contextual list. On phones, tabs appear only on that full-width list screen. The contextual list stays beside content at widths of 900 px and above; narrower tablets can reveal it from the content heading.

## Responsive interface

### Wide desktop

- Sticky top bar with the active project. The menu, contextual list, and content pane are visible together.
- The menu holds project switching, recents, and Settings. Installation and local data tools live in Settings. The contextual list shows the project name and path, Changes / Files / Search tabs, and the corresponding changed files, project files, or Search results. The reading pane opens directly with its task content.
- Changes opens a continuous review page of collapsible cards by default. Files and Search can open a working-tree file beside their list. Feedback remains reachable while scrolling.

### Tablet

- At widths of 900 px and above, the contextual list stays beside the content pane while the menu is a drawer. Below 900 px, the contextual list is a drawer. The host folder picker fills the available screen when that route is open.
- A single back arrow beside the Changes, Files, or Search content title reveals the list drawer when it is hidden. Feedback stays reachable while scrolling.

### Phone

- The Changes / Files / Search tabs appear only on the full-width contextual list screen. Switching tabs stays on that screen. The menu is a drawer; choosing a host folder, browsing a contextual list, or reading content uses the full width.
- Selecting a changed file, browsed file, or search result opens the full-width content screen. The same back arrow beside its title returns to the relevant list. Browser Back and Forward follow URL history, including folder navigation and Search result files.
- One-column inline diffs only. Wrapping is on by default. When off, each code pane scrolls horizontally without widening the page. A row tap reveals the hidden phone gutters and comment action.
- Comment editor and feedback preview open as bottom sheets. Touch controls have comfortable targets and stay clear of browser safe areas and the on-screen keyboard.
- Avoid nested vertical scroll areas. All expanded review cards remain in one page flow; fetch each card's diff only when needed.

Use text labels and symbols as well as color for added, removed, and outdated content. Restore open cards and wrap preference after reload; retain list and review scroll positions during route navigation where practical. Phone diff gutters are hidden for code width and revealed by tapping a row, as described below.

### Appearance settings

The [code typography slice](code-typography-slice-proposal.md) adds a Settings screen with 11–20 px and System mono/Courier choices, live preview, browser persistence, and backup support. The [Google code fonts follow-up](google-code-fonts-followup.md) adds 20 optional monospace web fonts and removes diff-row dividers. The [theme settings slice](theme-settings-slice-proposal.md) adds reviewed personal app and code palettes through frontend design tokens; the server continues to return semantic syntax roles.

### Phone portrait line action slice

The change-sign and old/new number columns took roughly a quarter to a third of a narrow phone's code width. The [phone line-action record](phone-portrait-gutter-slice-proposal.md) hides those columns on phones and reveals sign, line numbers, and one Comment action when a row is tapped or clicked at any size. Unchanged lines use the New side in every Git layer. Browser QA covers selection and anchoring; test gestures on real phones before calling the slice fully verified.

### Touch interactions

- A short tap or click on a diff code row reveals its sign, available old/new numbers, and a single Comment action. Phones hide the gutters; wider screens keep direct old/new number buttons. A removed line anchors to Old; added and unchanged lines anchor to New.
- Native code selection takes priority over the line action. Selected code offers Search. A drag or long press must not launch a line comment.
- Keyboard users can focus a line control and operate it without touch gestures. Validate gesture timing and selection behavior on iPhone Safari and Android Chrome, not only emulated viewports.

## Git and file model

Use `git status --porcelain=v2 -z --untracked-files=all` to obtain stable, machine-readable paths and states. The same path may produce two review entries when it has both staged and unstaged changes. [Git status](https://git-scm.com/docs/git-status)

| Review layer | Old side | New side |
| --- | --- | --- |
| Staged | `HEAD` | Index |
| Unstaged | Index | Working tree |
| Untracked | Empty file | Working tree |

Handle a repository without a first commit by treating `HEAD` as an empty tree. Preserve renames, deleted files, file modes, conflicts, submodules, and binary status in the model, even when a text hunk is unavailable. Request a per-file patch with fixed Git options when its card opens. Use `--no-ext-diff`, `--no-textconv`, `--no-color`, a fixed context length, and an argument array ending in `--` before a path. [Git diff](https://git-scm.com/docs/git-diff)

Each text diff has a layer, source-correct old/new sides, and hunks. Each `DiffLine` has kind, old/new line numbers, source text, syntax tokens, and a validated word-change detail variant. The [diff fidelity slice](diff-fidelity-slice-proposal.md) adds bounded word-change spans across paired lines in multi-line edit chunks. Exact move indicators are a later optional refinement. Do not infer an edited move from a weak match.

Shiki supplies grammar scopes for line tokens. Keep its full language bundle on the server and load the needed grammar on demand. Return bounded syntax roles with exact token text; the browser applies colors from CSS variables so theme changes need no new diff response. Detect languages from filenames and extensions, and offer a per-file override for ambiguous or unknown types. Reuse the highlighter and loaded grammars; consider caching tokenization by content hash and language if profiling shows a need. Highlight source text before combining it with diff word spans. [Shiki usage](https://shiki.style/guide/install), [Shiki bundles](https://shiki.style/guide/bundles), [Shiki performance](https://shiki.style/guide/best-performance)

The first Files slice shows bounded working-tree text and named states for binary, link, oversized, and unsupported files. The [media preview slice](media-preview-slice-proposal.md) now adds native image (including SVG), audio, and video previews in Files and source-correct Git change cards, each with raw new-tab links. Change cards show Old then New vertically; Files shows the current working-tree file. PDF can wait; HTML preview is not needed. Historical blobs for general browsing and commit navigation remain a distant optional Git browser.

## Search

Use ripgrep (`rg`) as a bounded read-only subprocess for fixed-string searches in both Git and non-Git working-tree folders. Its JSON Lines output provides paths, line numbers, and matching text; keep project ignore rules, include hidden source files, explicitly exclude `.git`, and never follow symlinks. Limit result count, subprocess output, individual file size, and wall time; cancel stale client requests and show grouped results with path, line number, and excerpt. Search results open the current working-tree file and scroll to the line. The HTTPS service checks Homebrew locations because its launch environment omits Homebrew from `PATH`; `GIT_REVIEW_RG_PATH` is an override. The [Search behavior document](search-slice-proposal.md) records the first reviewable scope. [Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)

Extract a held identifier from code and offer whole-word or literal substring search. Search is initiated on the server; the browser does not receive or index the entire codebase.

## Comments, persistence, and export

A comment anchor stores project, path, Git layer or revision, old/new side, line number, and a small text/context fingerprint. On refresh, attempt a unique relocation when lines move. If relocation is ambiguous, mark the comment outdated and require review before exporting it under a new line number.

Save drafts as edits occur, using versioned `localStorage` keys and a small migration path. Keep recent projects, recent files, wrap choice, collapsed-card state, and a bounded copy-history list there as well; keep the active project in per-tab `sessionStorage`. A copy succeeds only after the clipboard API resolves; then store an immutable history snapshot and clear the active draft, with an immediate Undo action. On failure, keep the draft and show selectable feedback text.

Export plain text with relative paths, Git layer, side, line number, source text, and the comment. The current formatter produces text like:

```text
Review feedback for "/repo"

[staged] "src/parser.ts"
  old line 18  "return parse(input);"
    This case still needs coverage.

[unstaged] "src/view.ts"
  new line 42  "const result = render();"
    Please handle the empty result here.
```

History and drafts are local to each browser and origin; they do not sync across devices. Do not store audio recordings in browser storage.

## Voice transcription plan

### Finding and recommendation

OpenAI Docs describe Codex and ChatGPT desktop voice or dictation as input to their own conversations and composer. The documented OpenAI CLI transcription command calls the API. There is no documented subscription-backed transcription endpoint for an unrelated web UI, so Codex or ChatGPT are not the integration path for this app. API-key usage follows API pricing, which conflicts with the no-API-cost requirement. [ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice), [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [OpenAI CLI transcription](https://developers.openai.com/api/docs/libraries/openai-cli), [OpenAI Docs pricing](https://learn.chatgpt.com/docs/pricing)

Handy is a local speech-to-text app. Its public CLI page currently documents recording controls rather than file-to-text output, but Handy's headless transcription feature was merged in June 2026. The installed `/Applications/Handy.app/Contents/MacOS/handy` version 0.9.6 confirms these flags in `--help`:

```text
-f, --transcribe-file <WAV>  Transcribe a 16 kHz mono WAV headlessly and exit
--model <MODEL>               Optional model ID; defaults to the selected model
--json                        Emit file transcription results as JSON
```

The host already has a Handy Parakeet V3 model installed. This is a direct local route for recordings made on the phone, with no external inference service. A synthetic speech fixture was transcribed through the CLI, local endpoint, and private HTTPS service on 2026-09-28; Handy returned JSON with the expected `text`. The CLI exited with code 134 in this task's sandbox but worked with ordinary host permissions. The maintainer reported that phone dictation works well. See the [voice slice proposal](local-voice-comment-slice-proposal.md). [Handy repository](https://github.com/cjpais/Handy), [Handy headless CLI change](https://github.com/cjpais/Handy/pull/1541), [Handy public CLI page](https://handy.computer/docs/cli)

### Request flow

1. In a comment sheet, place the caret and tap the microphone button in the textarea footer. The browser saves that range, requests microphone permission, and records with `getUserMedia` and `MediaRecorder` using a supported format selected at runtime.
2. Show a timer, local microphone-level display, and separated Cancel and Send controls. Play a start cue and a stop cue. At five minutes, stop and automatically submit the clip for transcription. While a voice clip is pending, keep the textarea read-only so the saved insertion point remains valid.
3. Send the audio to the same-origin Bun endpoint `POST /api/transcriptions` over the private HTTPS service. The current app has no account system; the server accepts only bounded audio uploads and does not let the client choose a host path or executable.
4. FFmpeg decodes and normalizes the clip to 16 kHz, mono, 16-bit PCM WAV. Invoke Handy with fixed argument-array values: `--transcribe-file <temporary-wav> --json`.
5. Parse the returned transcript, return text to the browser, and remove temporary audio in a `finally` path. Insert the text at the saved caret (or over only the selected range) and let the user edit the comment. On failure, keep the recording in memory for Retry without changing the comment.

FFmpeg is present on this host; packaging should make it an explicit optional runtime requirement for voice. Keep the transcription adapter behind a small interface so a future supported Handy IPC/API or another local engine can replace the subprocess without changing the UI. Limit one active transcription per host initially, set a timeout, and show a useful error when Handy or its model is unavailable. Never log audio or transcript content by default. [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [FFmpeg resampling](https://www.ffmpeg.org/ffmpeg-resampler.html)

Handy's normal desktop shortcut can also dictate directly into a focused comment field when reviewing on the Mac. It uses the Mac microphone, so it does not solve phone recording by itself. Handy's proposed local HTTP transcription API is still an open pull request; this plan does not depend on it. [Handy local API proposal](https://github.com/cjpais/Handy/pull/509)

### Secure origin requirement

Mobile microphone capture and programmatic Copy feedback both require a secure browser context. Localhost is trusted for desktop use; a phone reaching the host by a LAN address needs trusted HTTPS. Provide a LAN setup path with a trusted certificate, explicit bind address, pairing, and approved filesystem roots. If microphone access is unavailable, keep text entry and file upload available as fallbacks. [MDN microphone security](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN clipboard security](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API), [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts.)

## Server/API outline

| Endpoint | Purpose |
| --- | --- |
| `GET /api/roots`, `GET /api/directories` | Browse permitted host folders. |
| `POST /api/projects/open` | Resolve a selected folder to a stable project ID. |
| `GET /api/projects/:id/status` | Return Git layer groups and a revision marker. |
| `GET /api/projects/:id/diff` | Return one file/layer's parsed hunks and highlighted lines. |
| `GET /api/projects/:id/tree`, `GET /api/projects/:id/file` | Browse working-tree paths and read bounded current files. |
| `GET /api/projects/:id/history` | Optional distant Git browser: list older revisions of a tracked file. |
| `GET /api/projects/:id/search` | Return bounded server-side search matches. |
| `POST /api/transcriptions` | Transcribe one bounded audio clip locally over the private, same-origin HTTPS service. |

Use a small shared TypeScript schema for responses and validate all untrusted inputs at runtime. Resolve paths beneath configured roots after symlinks, prevent traversal, and pass Git/FFmpeg/Handy arguments without a shell. Default to loopback binding; explicit binding to the host's Tailscale IPv4 address supports tailnet access to the current foundation. Broader LAN mode requires pairing, trusted HTTPS, same-origin checks, and no permissive CORS. Keep the app read-only with respect to repository files.

## Project structure

```text
AGENTS.md          Collaboration, type safety, and verification rules
README.md          Run instructions and current status
docs/initial-implementation-plan.md
docs/foundation-slice.md
docs/qa-workflow.md
qa/capture.ts      Browser screenshot capture at review milestones
qa/check-foundation.ts  Mobile folder selection and reload check
qa/screenshots/    Curated desktop, tablet, and mobile images
src/client/        Preact UI, styles, local state, audio capture
src/server/        Bun routes, Git adapter, file access, search, transcription
src/shared/        Wire types, runtime validation, comment/export model
tests/             Git fixture and focused model tests
tsconfig.base.json
tsconfig.client.json
tsconfig.server.json
package.json
```

Type checking runs with the project-local native TypeScript 7 compiler. Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, and unused-code checks. Keep server and client library/type environments separate. Use Bun's build and test commands without a framework-specific toolchain.

## Delivery order and acceptance checks

1. **Foundation and secure access:** Create the Bun/Preact scaffold, native TypeScript type-check gate, folder picker, approved-root enforcement, and desktop/LAN serving modes. A phone can open the UI through trusted HTTPS in LAN mode.
2. **Git and file model:** Implement status, lazy diffs, bounded current-file reads, binary handling, and search. Historical file reads remain optional. Fixture repositories cover an initial commit, staged plus unstaged edits on one path, untracked files, renames, deletions, conflicts, binary files, unusual filenames, and symlink containment.
3. **Review UI:** Implement responsive drawer, continuous collapsible cards, syntax plus diff overlays, wrap toggle, full-file view, and search navigation. Test narrow phone widths and tablet orientations.
4. **Feedback:** Implement line interactions, durable drafts, stale-anchor handling, preview, copy, and history. Copy output identifies every comment's file, layer, side, and line.
5. **Voice:** Verify Handy headless transcription with a non-sensitive WAV fixture, then wire browser recording, FFmpeg normalization, a bounded server endpoint, and transcript review in the comment sheet. Test iPhone Safari and Android Chrome capture, permission denial, cancellation, timeouts, and model-unavailable errors.
6. **Final device and performance pass:** Check actual touch behavior, clipboard and microphone operation over LAN HTTPS, large files, search limits, and refreshes while comments are present.

Keep a visible Refresh action and poll status while the page is active so new edits appear without losing the review position. Set size limits and progressive loading for unusually large files; an ordinary change set should remain a single continuous page.

The selected-code Search shortcut, local voice work, appearance settings, portrait-gutter refinement, and [URL history and navigation redesign](navigation-and-url-history-slice-proposal.md) are implemented. The maintainer reviewed and approved the navigation redesign on phone, tablet, and desktop.

## Remaining roadmap

- **Device and performance pass:** check iOS selection and microphone behavior, clipboard and keyboard layouts on real devices, interruptions during recording, large changes, and refreshes while drafts are present. The maintainer has confirmed the selected-code Search action and dictation work on their phone.
- **Native media previews (complete):** images including SVG, audio, and video appear inline in Files and in source-correct Old/New Git change cards, with raw new-tab links. The [media slice record](media-preview-slice-proposal.md) contains the API and QA details.
- **Diff fidelity (complete):** bounded word-change spans decorate clear line pairs across multi-line edit chunks. The [slice record](diff-fidelity-slice-proposal.md) covers matching limits and QA. Moved-block indicators are optional later work.
- **Phone and personal layout (complete):** the [phone line action](phone-portrait-gutter-slice-proposal.md), [code typography Settings slice](code-typography-slice-proposal.md), and [app and code theme selectors](theme-settings-slice-proposal.md) are reviewed and complete.
- **Convenience:** [live change detection](live-change-detection-slice-proposal.md) is complete. Recent files remain from the initial plan. Explicit Refresh, row click actions, and wide-screen line-number controls cover the essential jobs today.
- **Navigation (implemented):** the [URL and screen redesign](navigation-and-url-history-slice-proposal.md) supports Back/Forward, direct file links, and the menu/list/content hierarchy. Real-device testing will decide whether a swipe gesture adds value. General file Git history and PDF previews are later optional expansions.
