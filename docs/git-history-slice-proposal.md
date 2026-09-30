# Git tab: branches and commit inspection

Status: implemented, reviewed, and committed as `22de40e` on 2026-09-30. The [initial implementation stage is closed](initial-implementation-plan.md#stage-closure--2026-09-30); broader Git features are optional future work.

Updated: 2026-09-30

## Smallest useful slice

**Git** sits beside Changes, Files, and Search. Its contextual list contains a branch selector and commit history. Selecting a commit opens its full message and a continuous page of collapsible diff cards, using the existing syntax highlighting, word detail, wrapping, themes, typography, and media previews.

The job is to inspect what was committed, including work an agent committed unexpectedly. The first slice browses existing Git objects through read-only commands. File-specific history and a full tree browser at an arbitrary revision remain later work.

## Current user flow

1. Open a Git project and choose **Git**. The selector defaults to the checked-out branch, or an explicitly labeled detached HEAD. Offer local branches and remote-tracking branches already present on this host, grouped in the native selector. Choosing one changes the history being browsed; it does not check out a branch or contact a remote. Omit symbolic aliases such as `origin/HEAD` from the branch choices.
2. Show 50 commits initially, with subject and two metadata rows: author left/date and time right, then short hash left/added and deleted line totals right. Include merge commits and their reachable history. Use Git's date ordering, which keeps children before parents. **Load older** adds another page. There is no graph in this slice. [Git log ordering and limits](https://git-scm.com/docs/git-log)
3. Selecting a commit highlights it in the list and opens the content pane. Show its complete message with paragraph breaks, followed by the same metadata rows with its full hash and compact parent label. Render the message as text. Show every changed file in the selected project scope, with its card expanded initially; the user can collapse individual files. Reuse the current compact code rows, sticky card headings, phone gutter behavior, and Old/New media ordering.
4. On phones, the four tabs, branch selector, and commit list occupy the list screen. Selecting a commit opens the full-width content screen; the existing content-heading back arrow returns to the list. Keep the current tablet drawer and desktop side-by-side patterns. No new navigation pattern is needed.
5. Changing branches opens that branch's list, clearing the selected commit. **Refresh** rereads branches and starts a history snapshot at the current tip. An already opened commit remains that exact commit. Newly created commits do not reorder a list while the user is reading or loading older pages.

Before a commit is selected, the content pane has a simple selection empty state. A non-Git project has an unavailable Git state, and a repository without a first commit has a no-commits state. Slow requests follow the existing delayed-loading policy; loaded same-resource content stays visible during Refresh.

### Historical line interactions

**This slice is inspection only.** A row tap reveals its sign and old/new line numbers, including the hidden phone gutters. Native code selection and copying still work. The view has no Comment action or selected-code Search shortcut: current comment anchors describe working-tree/index layers, and Search searches the current working tree.

Historical comments would need their own immutable commit/parent anchors and export labels. They should be proposed separately rather than labeling a historical line as Staged or Unstaged. Existing working-copy drafts remain available in Feedback.

## Comparison rules

| Commit | Old side | New side |
| --- | --- | --- |
| Ordinary commit | Its parent | The selected commit |
| Root commit | Empty tree | The selected commit |
| Merge commit | Its first parent | The selected commit |

For merges, label the comparison **(first parent: <short hash>)** beside the commit hash. This gives one familiar ordinary diff showing what the merge brought into that parent; combined diffs and choosing another parent are deferred. Git can compare two trees directly, and `diff-tree --root` represents a root commit against an empty tree. [Git diff-tree](https://git-scm.com/docs/git-diff-tree)

Both syntax sources and all preview bytes come from these immutable trees, even if the path has since changed or disappeared on disk. Read parent IDs from the commit object itself so shallow traversal or history simplification cannot make a missing parent look like a root. A missing parent in a shallow repository is an explicit unavailable-diff state. An empty commit still shows its message and a no-file-changes state. Mode-only changes, renames, deletions, links, and submodules retain meaningful file metadata even when there is no text patch. [Git raw commit format](https://git-scm.com/docs/pretty-formats)

The server inventories tree changes first, then compares each regular file's exact Old/New blob IDs with `git diff <blob> <blob>`. This keeps a renamed file's patch separate when another change also occupies its old path. Added/deleted files use a bounded one-sided patch from the selected blob. Syntax reads those full source blobs rather than individual hunk fragments. Mode changes appear in the card metadata; links and submodules are named states and are not followed. [Git blob comparisons](https://git-scm.com/docs/git-diff)

## URLs, loading, and cache

- Extend the validated route union with a Git list destination and a Git commit destination. Record the project, full branch ref (or detached `HEAD`), and full commit object ID in the URL. For example: `?section=git&project=git-review&ref=refs%2Fheads%2Fmain&commit=<full-object-id>`. A list destination omits `commit`.
- Resolve the default branch once and replace the initial Git URL, preserving an opened list drawer and the reading position while the default resolves. Branch changes and commit selections create history entries. Back/Forward and direct links reopen the correct destination; a missing ref or object produces a recoverable error instead of selecting another commit silently.
- A selected commit is immutable even when its branch advances or is rewritten. A direct link can inspect that object while it remains available locally; the branch ref supplies list context. If that branch was deleted, retain the available commit detail and offer another branch for the list.
- Pin each loaded history list to its resolved tip object ID. Subsequent pages use that tip and an offset. Refresh starts a new snapshot; returning through navigation restores the cached snapshot and scroll position when available. Reload fetches current branch history and the exact selected commit.
- Reuse bounded tab-memory caching for commit metadata and per-file diffs. Historical keys include project, commit, comparison base, path, and language; working-tree change tokens cannot invalidate an immutable commit. Keep card expansion and scroll state scoped to that commit. Do not persist Git payloads in local storage or the service worker.
- Build the whole file inventory first, then fetch expanded cards with a small concurrency limit (initially three). Reserve card structure during requests, delay loading indicators, and render cached diffs on the first render. Every ordinary file is included; oversized or unsupported content has a named state. Card toggles never repeat route focus.

## Server/API and internal data

Implemented routes, all under an opened and revalidated project:

| Endpoint | Result |
| --- | --- |
| `GET /api/projects/:id/git/refs` | Git/non-Git state, checked-out branch or detached/unborn HEAD state, and local/remote branch refs with tip IDs. |
| `GET /api/projects/:id/git/log?ref=<full-ref-or-HEAD>` | First bounded page, resolved immutable tip, commit summaries, and next-page state. |
| `GET /api/projects/:id/git/log?tip=<object-id>&offset=<number>` | Another page from the same history snapshot. Reject mixed ref/tip inputs. |
| `GET /api/projects/:id/git/commits/:oid` | Full message, author/date, parents, comparison-base variant, line totals, and changed-file inventory. |
| `GET /api/projects/:id/git/commits/:oid/diff?path=<path>&language=<id>` | One file's parsed patch, semantic syntax/word data, or explicit media/binary/limit state. |
| `GET/HEAD /api/projects/:id/raw/commit?...` | Version-checked Old/New media from that commit comparison, with the existing range and raw-link behavior. |

The [shared Git boundary](../src/shared/git.ts) uses purpose-built types: `GitHead` variants for branch/detached/unborn; a `GitHistoryPage` carrying its tip and nullable next offset; `CommitDetail` with full message and parents; and `CommitComparison` variants for parent/empty/missing-parent. A `CommitFileChange` has change kind, validated old/new paths and modes, and explicit absent/present sides. It has no working-copy `ChangeLayer`.

Working-copy and commit cards share [the card frame](../src/client/DiffCardFrame.tsx), [diff body](../src/client/DiffBody.tsx), word decoration, media presentation, and [source syntax boundary](../src/server/diff-syntax.ts). Review and inspection interactions are explicit variants; comment creation stays on the working-copy variant. [CommitViewer](../src/client/CommitViewer.tsx) owns historical card state, and [git-history.ts](../src/server/git-history.ts) owns the read-only Git commands.

Git supplies structured ref fields and full commit messages, so no new dependency or human-output scraping is needed. Ref enumeration can use NUL-delimited fields; pretty formats provide `%B` for the full message. Validate all field counts, encodings, IDs, dates, paths, and output bounds before constructing internal types. [Git for-each-ref](https://git-scm.com/docs/git-for-each-ref), [Git pretty formats](https://git-scm.com/docs/pretty-formats)

### Boundaries and limits

- Accept exact refs from the server's branch inventory or the explicit HEAD choice. Accept complete object IDs of the repository's actual hash format and verify they name commits. Do not accept arbitrary revision expressions. Use fixed argument arrays, literal pathspecs, disabled external diffs/text conversion/color, and `--` before paths.
- Preserve the selected project boundary. When a project is a subdirectory of a repository, history and file diffs are scoped to that subtree and the UI labels the scope. Historical paths need not exist on disk; validate their tree entries and never follow historical symlinks or recurse into submodules. A rename across the boundary becomes a scoped addition/deletion; do not read its outside side.
- Start with 50 commits per page, at most 1,000 branch choices and 1,000 changed files per commit, and a 64 KiB full-message limit. Reject an over-limit inventory/message explicitly rather than silently truncating it. Retain the existing Git timeout/output bounds, text/patch limits, and media limits. These are protective limits, not a truncated summary of an ordinary commit.
- Missing objects, malformed Git output, denied access, deleted branches, shallow history, request failures, and limit states have explicit recovery behavior. Abort or ignore superseded requests. A failed old-side read cannot fall back to the current file.

### Data lifetime

[git-browser.ts](../src/client/git-browser.ts) keeps validated refs (16 projects, about 1 MiB), loaded history snapshots (16 lists, about 4 MiB), and commit metadata (64 commits, about 4 MiB) in bounded tab-memory caches. Historical diffs share the existing 128-entry/about-32-MiB diff cache with working-copy diffs. Byte accounting estimates serialized UTF-16 data size; it is a cache bound, not a total browser-memory measurement.

Branch lists stay pinned until Refresh or reload. Each **Load older** action carries the existing tip and offset; refreshing starts a new snapshot without changing a selected commit ID. Three concurrent diff slots are shared across commit cards; canceled queued requests release their place. Successfully loaded diffs render immediately when returning to a commit. Historical collapsed-card and list-scroll records retain at most 64 destinations in tab memory. They reset on reload; wrapping, themes, typography, and per-path language choices use existing browser preferences. Git payloads do not enter local-data backups or the service-worker cache.

## Implementation checkpoints and verification

1. **Git data boundary:** implement branch/history/commit metadata and immutable comparisons, with focused Git fixture tests. Cover branches, full multi-paragraph messages, root and merge commits, empty commits, renames, unusual paths, changed/deleted worktree files, project-subdirectory confinement, invalid inputs, and missing/oversized data. Run the strict type gate.
2. **Git navigation and text review:** add the fourth tab, selector, paginated list, Git URL variants, and shared diff rendering. Verify direct links, refresh, Back/Forward, cancellation, cache reuse, independent tabs, and no repeated scrolling when a card toggles. Exercise the existing Changes comment flow after extracting shared rendering. Rebuild the running app and capture phone, both tablet orientations, and desktop for maintainer review.
3. **Media and final polish:** use immutable Old/New raw sources for images/audio/video, verify missing and bounded content, inspect wrapping/overflow and long messages/subjects, and repeat focused navigation checks. Refresh the docs with the actual behavior and QA evidence. Leave the completed slice uncommitted for maintainer review.

The smallest complete result is a phone that can choose a branch, open any ordinary commit, read its full message and all file diffs, return to its commit list with Back, and switch to working-copy Changes without losing drafts or review position. No Git writes are part of this slice.

## Verification — 2026-09-30

- `bun run typecheck`, `bun test`, and `bun run qa:check` pass. The complete suite has 46 tests and 381 assertions. Git fixtures cover full/root/merge/empty commits, pagination snapshots, detached/unborn HEAD, remote aliases, renames and unusual paths, source fidelity after disk changes/deletion, mode changes, subfolder confinement, missing shallow parents, limits, and SHA-256 object IDs.
- API checks cover unopened projects and revalidated roots, malformed requests, immutable Old/New SVG bytes, raw-link version checks, CSP restrictions, and audio HEAD/range responses.
- `bun run qa:git` passes in Chrome at 390, 820, 1180, and 1440 px, with an extra 320 px fit check. It exercises branches, pagination, full messages, all five fixture cards, inspection line information, Old/New image loading and raw links, wrapping and contained horizontal scrolling, Back/Forward reading positions, cached diff/card reuse through Files, reload/direct links, independent tabs, and first-parent merge labeling. The observed peak is three concurrent diff requests.
- `qa:navigation`, `qa:line-action`, and `qa:loading` pass after sharing the renderer, including working-copy comment/export anchors and one-time route focus. This guards the existing Changes workflow during the refactor.
- All 12 images in the four-size [Git list](../qa/screenshots/git-history-list/mobile.png), [full-message and diff](../qa/screenshots/git-commit-inspection/mobile.png), and [historical code](../qa/screenshots/git-historical-code/mobile.png) capture sets were inspected. They have no page-wide overflow.
- Chrome opened this repository through the running private HTTPS origin, read the full current commit message and all 23 historical cards, and navigated between the phone commit/list screens without page errors or overflow. This was a browser check on the host, not a physical phone check.
- Browser emulation does not prove native iOS/Android selection or the installed app's navigation. Dedicated real-device checks remain unverified [optional future work](initial-implementation-plan.md#remaining-roadmap).

## Agreed scope and later work

The maintainer approved local and already-present remote branches, merge comparison against the first parent, all commit cards initially expanded with bounded fetching, and inspection without historical comments. Graphs, fetch/checkout, arbitrary revision comparisons, file-specific history, and browsing an entire old tree remain outside this slice. Delivery review is complete, with approval to commit on 2026-09-30.

## Proposed follow-up: line totals and time

Status: implemented, reviewed, and committed with the Git slice as `22de40e` on 2026-09-30. The section heading is retained for existing review links.

### User flow and appearance

- Keep the commit subject above two aligned metadata rows in the list: **author on the left, date/time on the right**; then **short SHA on the left, +added −deleted on the right**. Use the existing added/removed color roles and explicit signs. The full commit summary uses the same two-row arrangement below its message, with its full SHA.
- Show **date and local time to the minute** in both places, using the browser's locale and timezone and the existing author timestamp as the source. The ISO timestamp stays on the `<time>` element, with an exact timestamp/timezone available in its title.
- In the main summary, place the comparison base beside the full SHA as muted parenthetical text: `(parent: a1b2c3d4)`, `(first parent: a1b2c3d4)` for a merge, or `(root)` for a root commit. Remove the separate “Compared with parent…” line. Preserve the missing-parent warning and scoped-project context; these describe real limits rather than repeated comparison text.
- Each metadata row has an independent left/right grid. At narrow widths, a long author or full SHA wraps within the left column; its parent label can wrap below the SHA in that group. Date/time and line totals remain on the right, with the added/deleted pair together. Metadata has no page-wide horizontal overflow and does not change code font settings.

Illustrative list metadata (actual date ordering and separators follow the browser locale):

```text
Improve reading and preserve historical context
History QA               30 Sep 2026, 10:00
23f5586c                         +163 −163
```

The main summary replaces the short hash with its full SHA and adds the compact parent label in that left-hand group; totals stay aligned on the right.

### Counting rules and API shape

Use Git's `--numstat -z` output to obtain added/deleted line counts without fetching highlighted patches or opening every card. Git reports binary entries with `-` count fields; they contribute to a separate binary-file count. Git determines which content is textual, so an SVG can contribute line counts even when its card is an image preview. [Git numeric diff statistics](https://git-scm.com/docs/git-diff-tree#Documentation/git-diff-tree.txt---numstat)

Totals follow the same comparison as the displayed cards: parent → ordinary commit, empty tree → root, first parent → merge. They cover only the selected project scope. A pure rename or mode-only edit contributes zero lines; a rename entering/leaving a project subfolder matches the scoped addition/deletion shown in its card. Empty commits show `+0 −0`. Binary changes get a small binary-file label below the totals rather than being counted as text lines.

The required `stats` field belongs to `CommitSummary` and therefore `CommitDetail`, returned by the existing history/detail endpoints:

```ts
type CommitStats =
  | { kind: "ready"; added: number; deleted: number; binaryFiles: number }
  | { kind: "unavailable"; reason: "missing_parent" | "limit" };
```

Validate nonnegative safe integers and NUL-delimited paths/counts at the Git and HTTP boundaries. Missing shallow parents or protective output/time limits show “Stats unavailable”, never fabricated zeroes, and leave the commit readable. Invalid Git output remains an error. No new endpoint or dependency is needed.

The [shared counting implementation](../src/server/git-stats.ts) batches up to one 50-commit history page. `cat-file --batch` reads true parent headers; `cat-file --batch-check` checks the first parents are locally available; `diff-tree --stdin --numstat -z` compares explicit commit/parent pairs within the project scope. Raw commit headers prevent shallow traversal from turning a missing parent into a root. Batch output remains bounded at 8 MiB, with the existing 10-second command timeout. Ready totals are cached in server memory for at most 256 project-path/commit pairs; unavailable states are not cached so newly available objects can recover. Detail uses the same comparison and parser. The [shared metadata component](../src/client/CommitMeta.tsx) renders both list and detail.

Research on 2026-09-30 confirmed the fixture yields `+163 −163` for its five-file update, `+1 −0` for the first-parent merge, and `+161 −161` for the update scoped to `src/`. Explicit batched comparisons were chosen to keep true-parent and project-scope handling consistent with the cards.

### Verification — metadata refinement, 2026-09-30

- `bun run typecheck`, `bun test`, and `bun run qa:check` pass: 48 tests, 406 assertions. Totals agree between list and detail for ordinary/root/merge/empty commits, binary changes, deletion, mode-only changes, renames across subfolder boundaries, filenames with tabs/newlines, and SHA-256 IDs. Missing shallow parents and oversized batch reads preserve explicit unavailable statistics; malformed HTTP counts are rejected.
- `qa:git` passes at 390, 820, 1180, and 1440 px. It checks matching list/detail totals and times, two-row alignment, parent/root/first-parent labels, and the existing navigation/cache/media flows. Its extra 320 px check covers long author names, full hashes, and large totals. A delayed-ref tablet check ensures resolving the default branch cannot close an already opened list drawer.
- All eight new [list metadata](../qa/screenshots/git-metadata-list-review/mobile.png) and [commit metadata](../qa/screenshots/git-metadata-summary-review/mobile.png) captures were inspected: phone, tablet portrait, tablet landscape, and desktop. There is no page-wide overflow.
- The running private HTTPS app was rebuilt and its servers restarted. Host Chrome verified the live phone list/content flow, matching totals/timestamps, full message, and all 23 historical cards. The maintainer approved the delivery and committing it on 2026-09-30; dedicated real-device checks remain optional and unverified.
