# Live change detection slice proposal

Status: implemented, approved by the maintainer on 2026-09-29, and committed as `aa9d091`.

## Finding

The current Changes view reads `GET /api/projects/:id/status` when a project opens or the user presses Refresh. Its `revision` is a hash of Git porcelain v2 status output. In a temporary repository, editing an already modified tracked file and editing an existing untracked file each left that revision unchanged. The file list was unchanged even though both diffs had new content. [Git's porcelain v2 format](https://git-scm.com/docs/git-status#_porcelain_format_version_2) includes index object IDs and state codes but no working-tree content ID for those entries. Polling only the existing revision would therefore miss the edits this feature is meant to reveal.

## Proposed user flow

1. While a Git project's **Changes** view is open and the tab is visible, check for updates about every 10 seconds and once immediately when the tab becomes visible again. Do not run overlapping checks. Pause in a hidden tab, another view, Settings, or a comment sheet.
2. Keep the displayed file list and diffs steady while the user reads. When a change is detected, show a persistent, compact **New edits · Update** action. On phones it sits above the existing Feedback action; on wider layouts it appears beside Refresh. It does not cover code or a line-action pop-up. The existing Refresh button continues to work.
3. Tapping Update reads the latest status and reloads expanded diffs. Keep cards expanded, draft comments intact, and the current file and approximate scroll position. If the viewed card disappeared, return to the closest surviving file or the Changes heading. Show a brief error while keeping the old review visible if the refresh fails.
4. A successful manual Refresh also clears the pending notice. If further edits arrive while a refresh runs, the next check can reveal them. Comment anchors are rechecked before feedback is copied, as they are today; an update must never silently move or export an outdated comment.

## Data and API shape

Extend the existing validated Git status response with a required `changeToken`:

```ts
type ProjectStatus =
  | { kind: "not_git" }
  | { kind: "git"; revision: string; changeToken: string; entries: ChangeEntry[] };
```

Keep `revision` for the current diff/media request contract. Derive `changeToken` from the porcelain output plus a deterministic fingerprint for each unique unstaged, untracked, or conflicted path: path, file type, mode, device/inode, size, and nanosecond modification/change times. Bun on this host exposes the bigint `lstat` times. Stage/index changes already alter porcelain output. Hash the bounded inputs and return a 20-character hexadecimal token; validate it with the other HTTP fields. No file contents, watcher events, or new endpoint are needed. The browser compares the token with its currently displayed status but does not replace that status until Update or Refresh succeeds. No polling state goes into browser storage.

Read metadata only below the selected real project path, without following a final symlink or an escaping parent. Deduplicate paths and bound concurrent filesystem reads. A path disappearing during the scan contributes a distinct missing-file marker; other I/O failures return a clear error. Existing Git subprocess limits and read-only rules still apply. Avoid a long-lived `fs.watch` tree: [Node's filesystem documentation](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) describes platform and filesystem cases where watcher events can be unreliable.

This is an **ordinary-edit signal**, not a proof that every byte changed. `touch` may produce an extra notice; an unusual rewrite that preserves all observed metadata can be missed until manual Refresh. Hashing the contents of every changed file on each interval would make large projects expensive. If that limitation matters in use, we can design a narrower content check for visible cards later.

## Scope and edge cases

- First slice covers Git Changes. Non-Git Files, working-tree Files, and Search retain their current manual Refresh controls.
- A project switch discards the old baseline and any pending notice. A hidden tab or an open comment sheet does not start a new check; returning to Changes checks immediately.
- Poll failures do not clear cards, drafts, or the last successful status. Retry on the next interval; keep manual Refresh available and show a small check-error state if failures persist.
- Staged plus unstaged entries for one path share one working-tree metadata read. A newly added file, deletion, rename, index update, or repository becoming non-Git is handled by the same status comparison.
- The existing global diff `revision` and media URLs are not changed by a mere metadata touch to an unrelated file. Applying an update still refetches expanded cards, even when `revision` is unchanged.
- The update action must remain reachable at 320 px phone width and clear of Feedback, code selection, and comment controls. It should be keyboard accessible with a polite announcement.

## Smallest useful implementation and QA

Add the token to the server status response and strict client parser, then add one visible-tab polling loop and the pending Update action in Changes. Reuse the current refresh path and persisted expanded-card keys. Do not add WebSockets, server watchers, per-file subscriptions, or automatic replacement of code under the reader.

Behavior tests should show that editing an already modified tracked file or an existing untracked file changes `changeToken` even while `revision` and entries stay the same; staging and new/deleted paths are also covered. Browser QA should check the pending action, hidden-tab pause and resume, no overlapping requests, successful and failed refresh, preserved open cards/scroll/drafts, and project switching. Capture and inspect phone, tablet portrait, tablet landscape, and desktop screenshots with the pending action visible.

## Decision and implementation record

The maintainer approved this slice. The reader applies updates explicitly, and the status API now returns a validated metadata-based `changeToken` alongside its original diff `revision`. The browser checks Git Changes while the tab is visible, shows the Update action when the token changes, and refreshes expanded diffs only on request. The action remains above Feedback on phones. A polite status announcement and a small repeated-check error complete the visible states.

The [working-copy review owner](../src/client/working-copy-review.ts) keeps the displayed snapshot separate from background checks and scopes refresh, card preferences, and reading position to the accepted project. Failed status refresh retains a ready snapshot and the pending notice; the manual generation still renews expanded diff requests. Late status results must belong to the current project. Refresh position waits for expanded diff bodies to finish loading and is restored only within its original Changes destination. App owns navigation and supplies the view/dialog polling policy. Maintenance decisions and verification are recorded in [M09e](maintenance-plan.md#m09e--working-copy-review-ownership).

The [QA workflow](qa-workflow.md#live-change-detection) records the behavior and four viewport captures. The remaining human check is the exact placement and reachability of the Update action on an actual phone browser.

## Maintenance verification — 2026-10-01

[M04](maintenance-plan.md#m04--separate-qa-output-from-milestone-captures) is accepted and committed as `0e55b07`. The live-change browser check now writes four screenshots and a manifest into a fresh ignored `qa/.artifacts/live-changes-runs/run-<suffix>/` directory and prints its path. Repeated runs preserve prior diagnostic output and the tracked navigation milestone. Curated captures remain an explicit `qa:capture` action with a fresh label.

Two consecutive runs passed all existing assertions on an isolated fixture server: steady displayed code before Update, preserved expanded card/draft/scroll, four-size and 320 px containment, hidden-tab pause/resume, serialized checks, error recovery, and manual Refresh. SHA-256 checks confirmed all 426 tracked screenshot/manifest files and the first run's five outputs were unchanged after the second run. Both output directories are ignored, both temporary Git fixtures were removed, and the QA server was stopped. Strict type checking and the CSS token gate passed; the capture command also refused an existing milestone label. App behavior and assets were unchanged. These are Chrome emulation checks; real phone reachability was not reverified.
