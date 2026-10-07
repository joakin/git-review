# Testing and visual QA

This guide owns runnable checks and their setup. Behavior records in the
[documentation map](README.md#behavior-records) own current contracts and selected milestone
evidence; scripts own detailed assertions. The closed implementation and maintenance stages do not
create a new acceptance gate. Further device/performance work stays in the
[optional backlog](initial-implementation-plan.md#remaining-roadmap) until requested.

## Checks for a change

- After any edit, run `bun run format` and `bun run format:check`. For documentation-only changes,
  also check local links, anchors, and referenced commands.
- For code changes, run `bun run typecheck` and `bun run qa:check`, plus tests that exercise the
  affected behavior. Add lasting tests for observable invariants and important failures, rather than
  private call order or incidental markup.
- For visible UI changes, run the relevant focused checks, capture and inspect phone, tablet
  portrait, tablet landscape, and desktop states, and report remaining device uncertainty.
- Keep completed work uncommitted until the maintainer approves it under [AGENTS.md](../AGENTS.md).

`qa:check` checks QA TypeScript, CSS tokens, and repository formatting; it does not run browser
scenarios. `bun run test` runs the unit/integration suite. Package commands are defined in
[package.json](../package.json); staged formatting and its isolated hook check are explained in the
[formatting workflow](formatting-workflow.md).

## Fixture setup and isolation

Run QA from the repository root with Bun and installed Google Chrome. Ensure the ignored artifacts
parent exists with `mkdir -p qa/.artifacts` before preparing individual fixtures. Browser checks
target an isolated fixture server; never use the maintainer's working repository as a mutation
fixture. Choose unused ports and stop only QA processes you started. The app's run/HTTPS setup
belongs in the [root README](../README.md#run-the-app).

| Fixture     | Preparation                              | Used by                                                                                   |
| ----------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Inventory   | `bun qa/prepare-inventory-fixture.ts`    | Most working-copy, navigation, feedback, and settings checks                              |
| Git history | `bun qa/prepare-git-fixture.ts`          | Git and loading checks; object IDs are saved in `qa/.artifacts/history-fixture-info.json` |
| Line counts | `bun qa/prepare-change-stats-fixture.ts` | Changes statistics                                                                        |
| Images      | `bun qa/prepare-media-fixture.ts`        | Image/SVG previews                                                                        |
| Audio/video | `bun qa/prepare-media-av-fixture.ts`     | Playback/ranges; preparation requires FFmpeg with H.264 encoding                          |

Preparation scripts create their named directories under ignored `qa/.artifacts/` and refuse to
overwrite existing fixtures. Reuse a fixture only while it matches its preparation script; remove
and recreate only an owned QA fixture when it needs resetting. Some checks temporarily edit fixture
files and restore them in `finally`; run these sequentially on a shared fixture server.

For the common inventory/history checks, prepare both fixtures and an empty second project:

```sh
bun qa/prepare-inventory-fixture.ts
bun qa/prepare-git-fixture.ts
mkdir -p qa/.artifacts/other-project
bun run dev --root "$PWD/qa/.artifacts" --port 39911
```

`<URL>` in the catalog below means this server's printed HTTP(S) address, for example
`http://127.0.0.1:39911/`. The second folder supports cross-project navigation; tab and transaction
checks also create it when absent. Line-action and live-change checks create and remove their own
Git fixtures beneath this approved root. Stateless-project and formatting-hook checks own their
entire temporary setup and need no manually started fixture server.

Project-entry and file-feedback checks additionally need a separate approved root **outside any Git
worktree**, with a non-Git `plain-folder/readme.txt` and a clean Git `clean-git/readme.txt`. One way
to prepare it is:

```sh
qa_plain_root="$(mktemp -d "${TMPDIR:-/tmp}/git-review-qa-plain.XXXXXX")"
mkdir "$qa_plain_root/plain-folder" "$qa_plain_root/clean-git"
printf 'QA readme\n' > "$qa_plain_root/plain-folder/readme.txt"
printf 'QA readme\n' > "$qa_plain_root/clean-git/readme.txt"
git -C "$qa_plain_root/clean-git" init -q
git -C "$qa_plain_root/clean-git" add readme.txt
git -C "$qa_plain_root/clean-git" -c user.name=QA -c user.email=qa@example.invalid commit -qm baseline
bun run dev --root "$qa_plain_root" --port 39912
```

Use the second server's address as `<PLAIN_URL>`. Keep the temporary root path for cleanup after
stopping that QA server; an old machine-specific artifact file is not a setup prerequisite. Client
assets under `dist/` are shared by servers: build the current client before browser QA, rebuild
after frontend edits, and restart the relevant backend after backend edits. Keep the maintainer's
review service available.

## Focused checks

Run these scripts directly with Bun. The command column supplies required arguments; links to the
scripts expose exact scenarios and any optional arguments. Catalog coverage is a selection guide,
not a second assertion list.

| Check                                                         | Command                                                             | Fixture/setup                                           | Coverage and behavior record                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Foundation](../qa/check-foundation.ts)                       | `bun qa/check-foundation.ts --url <URL> --folder inventory-fixture` | Inventory or another direct Git child                   | [Picker](foundation-slice.md), reload, saved browser state                                                                      |
| [Inventory/diffs](../qa/check-diff.ts)                        | `bun qa/check-diff.ts --url <URL> --folder inventory-fixture`       | Inventory; folder name may differ if contents match     | [Diff cards](diff-slice.md), compact rows, wrapping                                                                             |
| [Files](../qa/check-files.ts)                                 | `bun qa/check-files.ts <URL>`                                       | Inventory                                               | [Tree and viewer](file-browser-slice-proposal.md), syntax, wrapping and return to Changes                                       |
| [Search](../qa/check-search.ts)                               | `bun qa/check-search.ts <URL>`                                      | Inventory; host ripgrep                                 | [Literal Search](search-slice-proposal.md), result navigation and source freshness                                              |
| [Selected Search](../qa/check-selected-search.ts)             | `bun qa/check-selected-search.ts <URL>`                             | Inventory; host ripgrep                                 | [Selection action](search-slice-proposal.md#selected-code-search), native ranges and scrolling                                  |
| [Navigation](../qa/check-navigation.ts)                       | `bun qa/check-navigation.ts <URL>`                                  | Inventory and `other-project`                           | [URLs and responsive views](navigation-and-url-history-slice-proposal.md), card focus and Back/Forward                          |
| [History controls](../qa/check-history-controls.ts)           | `bun qa/check-history-controls.ts <URL>`                            | Inventory                                               | [Visible browser history](navigation-and-url-history-slice-proposal.md#visible-browser-history), branching, reload and overlays |
| [Project entry](../qa/check-project-entry.ts)                 | `bun qa/check-project-entry.ts <URL> <PLAIN_URL>`                   | Inventory plus separate plain/clean root                | [Phone entry](navigation-and-url-history-slice-proposal.md#current-user-flow), explicit URLs and project failures               |
| [Loading](../qa/check-loading.ts)                             | `bun qa/check-loading.ts <URL>`                                     | Inventory, history and `other-project`                  | [Ownership, caches and focus](loading-and-transition-polish.md), delayed responses, cancellation and bulk controls              |
| [Live changes](../qa/check-live-changes.ts)                   | `bun qa/check-live-changes.ts <URL>`                                | Creates its own fixture under `qa/.artifacts/`          | [Freshness and Update](live-change-detection-slice-proposal.md), drafts and reading position                                    |
| [Changes totals](../qa/check-change-stats.ts)                 | `bun qa/check-change-stats.ts <URL>`                                | Line counts                                             | [Counts](changes-line-counts-proposal.md), layers, exceptional summaries, Update and wrapping                                   |
| [Git](../qa/check-git.ts)                                     | `bun qa/check-git.ts <URL>`                                         | Git history and its generated info file                 | [Historical inspection](git-history-slice-proposal.md), paging, sources, metadata and cache navigation                          |
| [Line actions](../qa/check-line-action.ts)                    | `bun qa/check-line-action.ts <URL>`                                 | Creates its own fixture under `qa/.artifacts/`          | [Compact rows and Old/New actions](feedback-slice-proposal.md#line-actions-and-diff-sides)                                      |
| [Feedback](../qa/check-feedback.ts)                           | `bun qa/check-feedback.ts <URL>`                                    | Inventory                                               | [Draft/check/copy/history/Undo](feedback-slice-proposal.md)                                                                     |
| [File feedback](../qa/check-file-feedback.ts)                 | `bun qa/check-file-feedback.ts <URL> <PLAIN_URL>`                   | Inventory plus separate plain/clean root                | [File anchors and reattachment](feedback-slice-proposal.md#anchor-identity-and-checking), failed reads and copy                 |
| [Selected feedback](../qa/check-selected-feedback.ts)         | `bun qa/check-selected-feedback.ts <URL>`                           | Inventory                                               | [Exact fragments](feedback-slice-proposal.md#selected-fragments), Unicode, wrapped ranges, persistence and reattachment         |
| [Feedback transactions](../qa/check-feedback-transactions.ts) | `bun qa/check-feedback-transactions.ts <URL>`                       | Inventory; creates `other-project` when absent          | [Pending copy/check ownership](feedback-slice-proposal.md#copy-transactions-and-recovery), concurrent edits and navigation      |
| [Modals](../qa/check-modals.ts)                               | `bun qa/check-modals.ts <URL>`                                      | Inventory                                               | Feedback/settings modal scrolling and contained controls                                                                        |
| [Voice](../qa/check-voice.ts)                                 | `bun qa/check-voice.ts <URL>`                                       | Inventory; mocked recorder/transcription                | [Dictation lifecycle](local-voice-comment-slice-proposal.md), caret, Retry/Cancel and late results                              |
| [Typography](../qa/check-typography.ts)                       | `bun qa/check-typography.ts <URL>`                                  | Inventory; Google Fonts network access                  | [Code typography](code-typography-slice-proposal.md), persistence, fallback and contained large text                            |
| [Themes](../qa/check-themes.ts)                               | `bun qa/check-themes.ts <URL>`                                      | Inventory                                               | [Independent appearance](theme-settings-slice-proposal.md), System mode and cross-tab updates                                   |
| [Tabs](../qa/check-tabs.ts)                                   | `bun qa/check-tabs.ts <URL>`                                        | Inventory; creates `other-project` when absent          | [Per-tab selection](independent-tabs-and-pwa-proposal.md#independent-tabs), explicit URLs and obsolete-key deletion             |
| [PWA/backups](../qa/check-pwa.ts)                             | `bun qa/check-pwa.ts <URL>`                                         | Inventory                                               | [Installation/local data](independent-tabs-and-pwa-proposal.md), current-format import, offline fallback and storage limits     |
| [Images](../qa/check-media.ts)                                | `bun qa/check-media.ts <URL> media-fixture`                         | Images                                                  | [Source-correct media](media-preview-slice-proposal.md), SVG isolation and raw sources                                          |
| [Playback](../qa/check-media-playback.ts)                     | `bun qa/check-media-playback.ts <URL> media-av-fixture`             | Audio/video                                             | [Native media](media-preview-slice-proposal.md), loading, seeking and ranges                                                    |
| [Stateless projects](../qa/check-stateless-projects.ts)       | `bun qa/check-stateless-projects.ts`                                | Run `bun run build` first; owns temporary roots/servers | [Restart/root-change contract](stateless-project-access-plan.md), resource reads, drafts and recovery                           |
| [Formatting hook](../qa/check-format-hook.ts)                 | `bun qa/check-format-hook.ts`                                       | Owns isolated Git/index fixtures                        | [Staged formatting](formatting-workflow.md), partial edits, ignored files and rollback                                          |

Server/shared tests cover parsing, containment, exact source reads and invalid-input cases that
browser checks cannot exhaust. Source links in the relevant boundary record identify those tests. No
catalog entry claims physical-device verification.

## Screenshot procedure

Capture a new, descriptive milestone after rebuilding the client:

```sh
bun run qa:capture --url http://127.0.0.1:39911/ --label <new-milestone>
```

[The capture script](../qa/capture.ts) writes phone, both tablet orientations, desktop, and a
manifest into `qa/screenshots/<new-milestone>/`. It refuses an existing label before opening Chrome
so prior evidence is preserved. Inspect all four images for clipped controls, unreadable code,
obscured feedback actions and page-wide overflow; horizontal scrolling inside an unwrapped code pane
is intentional. The command checks page-load failures and document overflow but cannot judge visual
quality.

Use a complete destination URL for Files, Search or Git. Saved browser state omits per-tab session
storage: use `--active-path <root-relative-folder>` when a capture needs a selected Changes project,
and combine `--storage-state <file>` when saved drafts or preferences are needed. Explicit URLs
remain authoritative. Focused checks save reusable state beneath ignored `qa/.artifacts/` where
appropriate.

`bun run qa:capture --help` is the full option reference. Useful controls are:

| Purpose                         | Options                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Wait for loaded content         | `--ready <selector>`, `--after-click-ready <selector>`                                              |
| Set up an interaction           | Repeat `--click <selector>` and `--fill <selector> <value>` in order                                |
| Show narrow contextual lists    | `--reveal-list`                                                                                     |
| Inspect a long or scrolled view | `--full-page`, `--scroll-to <selector>`, `--scroll-offset <pixels>`, `--scroll-x-to-end <selector>` |
| Show a code selection           | `--select-text <code-selector> <text>`                                                              |
| Show recording or ready media   | `--fake-microphone`, `--media-ready`                                                                |

Keep useful milestone images and manifests, and link them once from the owning behavior record or
current review handoff. Older captures show their recorded version, not the current UI. Ordinary
check output and temporary state belong in ignored artifacts; do not copy screenshot inventories
into this guide. Curate only with incoming links and useful evidence in mind.

## Shared QA support

[Browser support](../qa/browser-support.ts) owns installed-Chrome lifetime, scoped context cleanup,
standard profiles, page-error collection and document-overflow checks. Use its scopes for new checks
and pass scenario options explicitly. Keep feature interactions, storage seeds, response gates and
fixture restoration beside each check. Release held responses before cleanup. Capture and loading's
private delayed-response scenarios retain their own lifetime requirements.

[Server test support](../src/test-support.ts) owns Git calls with explicit working directories and
argument arrays, deterministic child author identities, and temporary-directory cleanup. It mutates
only owned test fixtures; production reads use the separate [Git boundary](git-read-boundaries.md).
It is a mechanism shared by scenarios, not a centralized repository fixture or test runner. Run the
affected callers when changing shared support.

## Real-device checks

Chrome emulation checks layouts and automated interactions. It does not establish native selection
menus/handles, gestures, virtual keyboards, clipboard permissions, microphone capture, installed-app
storage or OS codec support. Some clipboard checks use granted localhost permissions; pending-write
checks and voice scenarios use mocks. Synthetic recording screenshots establish only the visible UI.

When an affected feature changes, check it on real Android/iOS browsers and installed windows over
HTTPS as appropriate: selection and horizontal scrolling, line actions, keyboard layout, copy,
recording/permission denial, native media playback, installation/data transfer, and navigation after
reload or host restart. Record the actual device/browser, steps, result and remaining uncertainty.
Selected historical evidence and maintainer confirmations belong in each behavior record. Do not
turn an unperformed device check into a claim that the feature passed.
