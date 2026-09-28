# Initial Implementation Plan

Status: planning document  
Updated: 2026-09-28

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
| Persistence | Project selection belongs to each tab's `sessionStorage`; recent folders, drafts, copy history, and preferences use versioned `localStorage` records per browser origin and project. No account or sync service in the initial release. See [the independent tabs and PWA proposal](independent-tabs-and-pwa-proposal.md). |
| Speech to text | Browser recording sent to the Bun server, normalized by FFmpeg to 16 kHz mono WAV, then transcribed by Handy's local headless CLI. |
| Repository access | Read-only APIs. Explicit host directory roots, path containment checks, and no shell interpolation. |

This machine currently has Bun 1.3.1, Deno 2.7.11, Git 2.55.0, FFmpeg, and Handy 0.9.6. The global `tsc` is 5.9.3, so TypeScript 7 must be installed within the project. Bun is preferred because its server and browser bundler are built in; Deno's current browser bundling command is experimental. TypeScript 7 is the native compiler release. [Bun bundler](https://bun.sh/docs/bundler), [Deno bundle](https://docs.deno.com/runtime/reference/cli/bundle/), [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## User journeys

1. **Open a project.** The web app lists host directories inside server-approved roots. Select a folder. If it is a Git repository, open Changes; otherwise, open Files with a clear non-Git state. Recent projects are shown in the picker.
2. **Review changes.** The file list groups Staged, Unstaged, and Untracked. Select a file to jump to its card. Expand or collapse cards, inspect highlighted code, toggle wrapping, and add comments to old or new lines.
3. **Browse and search.** Open any allowed working-tree file. Later, hold a word to search for it in the working tree and tap a result to open that file at its matching line. Repository and file commit history is a distant optional expansion.
4. **Dictate a comment.** Open a line comment, tap the microphone, record on the phone, stop, review the transcript, and insert or replace text in the draft. Typed editing always remains available.
5. **Send feedback.** Preview comments grouped by file and Git layer, copy the text, and paste it into an editing session. Successful copies enter history. An unsuccessful copy preserves the draft.

The current checkpoint is a [working-tree Files browser](file-browser-slice-proposal.md). Repository and file commit history, including opening files at older revisions, is a distant optional slice. Search and voice remain higher priority than building a full Git browser.

## Responsive interface

### Desktop and tablet landscape

- Sticky top bar: project picker, Changes / Files / Search, wrap toggle, Feedback count, and Copy feedback.
- Persistent file sidebar: filter, Staged / Unstaged / Untracked counts, filenames, change counts, and comment badges.
- Main region: one continuous review page of collapsible file cards, followed by a full-file viewer when browsing.

### Phone and tablet portrait

- Compact sticky top bar with project name, file-drawer button, and Copy feedback. Keep the copy action reachable while scrolling.
- The file sidebar becomes an off-canvas drawer. Selecting a file closes the drawer and scrolls to its card.
- One-column inline diffs only. Wrapping is on by default. When off, each code pane scrolls horizontally without widening the page or hiding line numbers.
- Comment editor and feedback preview open as bottom sheets. Touch controls have comfortable targets and stay clear of browser safe areas and the on-screen keyboard.
- Avoid nested vertical scroll areas. All expanded review cards remain in one page flow; fetch each card's diff only when needed.

Use text labels and symbols as well as color for added, removed, moved, and outdated content. Restore scroll position, open cards, and wrap preference after reload.

### Future appearance settings

Add a Settings page in a later slice for each person's preferred app theme and code theme, plus code font size and font family. Save validated choices in versioned browser `localStorage`, scoped to the browser rather than the host project. Apply themes and code typography in the frontend through design tokens; the server continues to return semantic syntax roles. Show the effect of a choice immediately and preserve it across reloads. Decide the initial theme and font choices with the maintainer before implementing this slice.

### Future phone portrait gutter slice

The change-sign and old/new number columns currently take roughly a quarter to a third of a narrow phone's code width. After the [independent tabs and PWA bonus slice](independent-tabs-and-pwa-proposal.md), design a more compact portrait gutter without hiding the line anchor needed for comments. Explore a single visible number for added/deleted rows, a clear way to reveal both sides for context rows, and whether the marker can share space with a number. Review touch targets, accessibility labels, sticky horizontal scrolling, and comment side selection with the maintainer before implementing. Test on real phones as well as captured portrait viewports.

### Touch interactions

- A visible gutter button is the primary way to comment on a line. Double-tap on a code row is a shortcut. A deleted line anchors to the old side; an added or context line anchors to the new side by default.
- Holding a word in code opens a Search action. Holding the gutter can open the comment action. Keep native text selection available; a selection toolbar can offer Search when a browser captures the long press first.
- Cancel a pending long-press action when the finger moves to scroll. Validate gesture timing and selection behavior on iPhone Safari and Android Chrome, not only emulated viewports.
- Keyboard users can focus line controls and operate all actions without touch gestures.

## Git and file model

Use `git status --porcelain=v2 -z --untracked-files=all` to obtain stable, machine-readable paths and states. The same path may produce two review entries when it has both staged and unstaged changes. [Git status](https://git-scm.com/docs/git-status)

| Review layer | Old side | New side |
| --- | --- | --- |
| Staged | `HEAD` | Index |
| Unstaged | Index | Working tree |
| Untracked | Empty file | Working tree |

Handle a repository without a first commit by treating `HEAD` as an empty tree. Preserve renames, deleted files, file modes, conflicts, submodules, and binary status in the model, even when a text hunk is unavailable. Request a per-file patch with fixed Git options when its card opens. Use `--no-ext-diff`, `--no-textconv`, `--no-color`, a fixed context length, and an argument array ending in `--` before a path. [Git diff](https://git-scm.com/docs/git-diff)

Each `DiffFile` has a project ID, layer, old/new paths, file status, version identifiers, and hunks. Each `DiffLine` has kind, old/new line numbers, source text, syntax tokens, changed word spans, and an optional moved-block ID. Parse line structure from Git's patch; calculate bounded word-level changes for paired removed/added lines. Mark exact multi-line moves distinctly. Do not infer an edited move from a weak match.

Shiki supplies grammar scopes for line tokens. Keep its full language bundle on the server and load the needed grammar on demand. Return bounded syntax roles with exact token text; the browser applies colors from CSS variables so theme changes need no new diff response. Detect languages from filenames and extensions, and offer a per-file override for ambiguous or unknown types. Reuse the highlighter and loaded grammars; consider caching tokenization by content hash and language if profiling shows a need. Highlight source text before combining it with diff word spans. [Shiki usage](https://shiki.style/guide/install), [Shiki bundles](https://shiki.style/guide/bundles), [Shiki performance](https://shiki.style/guide/best-performance)

The first Files slice shows bounded working-tree text and named states for binary, link, oversized, and unsupported files. Later previews may cover images, PDFs, and restricted HTML. Historical blobs, deleted files, and commit navigation belong to a distant optional Git browser. An iframe is not a universal file renderer. Serve any future HTML previews with a CSP sandbox as well as an iframe sandbox so direct navigation remains restricted. [MDN iframe guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

## Search

Use `git grep --untracked -I -F -n -z` for fixed-string searches in a Git working tree; it searches tracked and untracked files while respecting ordinary ignore behavior. Limit result count and response bytes, cancel stale requests, and show grouped results with path, line number, and excerpt. For a non-Git folder, use a bounded server-side file walker with explicit excludes. Search results open the working-tree file and scroll to the line. [Git grep](https://git-scm.com/docs/git-grep)

Extract a held identifier from code and offer whole-word or literal substring search. Search is initiated on the server; the browser does not receive or index the entire codebase.

## Comments, persistence, and export

A comment anchor stores project, path, Git layer or revision, old/new side, line number, and a small text/context fingerprint. On refresh, attempt a unique relocation when lines move. If relocation is ambiguous, mark the comment outdated and require review before exporting it under a new line number.

Save drafts as edits occur, using versioned `localStorage` keys and a small migration path. Keep recent projects, recent files, wrap choice, collapsed-card state, and a bounded copy-history list there as well; keep the active project in per-tab `sessionStorage`. A copy succeeds only after the clipboard API resolves; then store an immutable history snapshot and clear the active draft, with an immediate Undo action. On failure, keep the draft and show selectable feedback text.

Export plain text with relative paths, Git layer, side, line number, and the comment, for example:

```text
Unstaged — src/view.ts:42 (new)
Please handle the empty result here.

Staged — src/parser.ts:18 (old/deleted)
This case still needs coverage.
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

The host already has a Handy Parakeet V3 model installed. This is a direct local route for recordings made on the phone, with no external inference service. The command's actual transcription and JSON shape still need a fixture test under normal server permissions. [Handy repository](https://github.com/cjpais/Handy), [Handy headless CLI change](https://github.com/cjpais/Handy/pull/1541), [Handy public CLI page](https://handy.computer/docs/cli)

### Request flow

1. In a comment sheet, tap a microphone button. The browser requests microphone permission and records with `getUserMedia` and `MediaRecorder` using a supported format selected at runtime.
2. Show recording state, timer, Stop, and Cancel. Keep clips short (initial limit: 90 seconds) and allow a review or retry before submission.
3. Send the audio to the authenticated Bun endpoint `POST /api/transcriptions`. The server accepts only bounded audio uploads and does not let the client choose a host path or executable.
4. FFmpeg decodes and normalizes the clip to 16 kHz, mono, 16-bit PCM WAV. Invoke Handy with fixed argument-array values: `--transcribe-file <temporary-wav> --json`.
5. Parse the returned transcript, return text to the browser, and remove temporary audio in a `finally` path. The user can edit the transcript before inserting it into the comment.

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
| `POST /api/transcriptions` | Transcribe one authenticated, bounded audio clip locally. |

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
2. **Git and file model:** Implement status, lazy diffs, versioned file reads, binary handling, and search. Fixture repositories cover an initial commit, staged plus unstaged edits on one path, untracked files, renames, deletions, conflicts, binary files, unusual filenames, and symlink containment.
3. **Review UI:** Implement responsive drawer, continuous collapsible cards, syntax plus diff overlays, wrap toggle, full-file view, and search navigation. Test narrow phone widths and tablet orientations.
4. **Feedback:** Implement line interactions, durable drafts, stale-anchor handling, preview, copy, and history. Copy output identifies every comment's file, layer, side, and line.
5. **Voice:** Verify Handy headless transcription with a non-sensitive WAV fixture, then wire browser recording, FFmpeg normalization, a bounded server endpoint, and transcript review in the comment sheet. Test iPhone Safari and Android Chrome capture, permission denial, cancellation, timeouts, and model-unavailable errors.
6. **Final device and performance pass:** Check actual touch behavior, clipboard and microphone operation over LAN HTTPS, large files, search limits, and refreshes while comments are present.

Keep a visible Refresh action and poll status while the page is active so new edits appear without losing the review position. Set size limits and progressive loading for unusually large files; an ordinary change set should remain a single continuous page.
