# PWA navigation, phone project entry, and file feedback

Status: U01 accepted and committed as `df92a53`; U02 accepted and committed as `b9aeee3`; formatting
accepted; continuing the agreed U03 slice

Created: 2026-10-04

The maintainer reported three issues while using the installed app: browser history has no visible
controls, feedback cannot be created while reading working-tree files, and entering a project on a
phone opens content before its contextual list. The maintainer requested the usual proposal,
alignment, implementation, and review sequence. The [maintenance pass](maintenance-plan.md) remains
on hold.

This proposal builds on the existing [URL navigation](navigation-and-url-history-slice-proposal.md),
[file browser](file-browser-slice-proposal.md), [feedback](feedback-slice-proposal.md), and
[installation/local-data](independent-tabs-and-pwa-proposal.md) contracts. Each slice is delivered
for review separately and stays uncommitted until explicit approval to commit the reviewed result.

## Proposed sequence

| Slice | Smallest useful result                                 | Status                           |
| ----- | ------------------------------------------------------ | -------------------------------- |
| U01   | Visible Back/Forward controls for known app history    | Accepted; committed as `df92a53` |
| U02   | Phone project entry opens the contextual list          | Accepted; committed as `b9aeee3` |
| U03   | Line feedback in working-tree Files and Search results | Agreed; implementation next      |

U01 and U02 are small, separately reviewable navigation changes. U03 changes the persisted feedback
model and receives its own focused implementation and review after navigation. Alignment on this
direction does not authorize committing any slice or resuming maintenance.

## U01 — Visible history controls

### User flow

- A compact floating pair of Back and Forward arrows sits at the bottom left, respecting safe areas.
  Feedback remains at the bottom right. Offer the same controls in the installed app and ordinary
  browser at every screen size.
- Hide the pair when neither direction is known to be available. When either is available, keep both
  arrows in stable positions and disable the unavailable direction. Use accessible names, visible
  keyboard focus, and at least 44 px touch targets.
- Back returns to the actual preceding app destination: for example, file → Search results → the
  code being read before Search. Forward revisits those destinations. Existing browser buttons and
  system Back use the same history.
- The content-heading arrow continues to open the parent list. Its destination can differ from
  history Back, so label it clearly as a list action.
- Hide the floating controls while a menu, list drawer, or modal covers the workspace. Floating line
  Comment and selected-text Search actions must remain reachable without colliding with navigation.

### State and API shape

Keep the URL as the source of truth and use the existing browser History API for traversal. Add a
small navigation owner with explicit `canGoBack`, `canGoForward`, and traversal commands; route
changes still synchronously save editor text and update route identity before dependent work can
settle.

Mark app-created history entries with validated, versioned metadata identifying their trail and
position. Retain a bounded per-tab journal in session storage to recognize neighboring app entries
across reload, including a reload after going Back. The journal is availability metadata; it does
not restore or override a destination independently of its URL. Route pushes discard the abandoned
forward branch; replacements preserve entry identity. All current `pushState`/`replaceState` sites,
including normalization and Git-ref resolution, must preserve this metadata through the same owner.

The ordinary History API exposes a total
[entry count](https://developer.mozilla.org/en-US/docs/Web/API/History/length) and the
[current entry's state](https://developer.mozilla.org/en-US/docs/Web/API/History/state), which do
not alone establish an app-owned previous or next destination. Enable controls only for known
neighboring app entries. A fresh direct link or old unmarked history entry starts a new known trail.
Do not guess from `history.length`. Validate session data and current-entry metadata together;
[session storage survives reload](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage),
but malformed, unavailable, or inconsistent data must fall back conservatively to the history known
during the current page lifetime.

No backend API or shared browser-local setting is needed. History metadata contains no comment
bodies or source content and is excluded from review-data backups.

### Edge cases and checks

- Search → result → Back → results → Back → previous code → Forward; section, directory, project,
  Settings, and Git destinations.
- Reload at both the newest entry and after Back; navigate after Back and verify the old forward
  branch is unavailable.
- Fresh deep links, unmarked or malformed state, unavailable session storage, independent tabs, and
  returning from an external page must never advertise an unknown destination.
- Repeated or rapid traversal cannot save a draft into another project, accept a superseded
  response, or leave the buttons permanently pending. A bounded journal may conservatively omit
  older destinations beyond its retained range.
- Same-route selections and canonical URL replacements do not invent entries or erase valid
  availability. Preserve existing loading, focus, and reading-position behavior.
- Inspect 320 px and all four standard viewports, long code, selection/Comment actions near the
  bottom, drawers, dialogs, media controls, and safe-area placement.

## U02 — Phone project entry opens the list

### User flow

Selecting a project from the picker or recents, or restoring a project from bare `/`, opens the
contextual list in the existing phone layout (up to 600 px). For a Git project, show the Changes
file list and Changes / Files / Search / Git tabs. The list offers a visible **Review all changes**
action so continuous review remains one tap away; selecting a changed file opens its card as today.
A non-Git project continues to open the Files list.

Tablet and desktop retain their current pane arrangement and project-entry behavior. A direct link,
reload, or history traversal to a selected file, diff, commit, Search result, or explicit
continuous-review route opens that destination. Rotating/resizing does not rewrite the URL or force
the reader back to a list.

### State and API shape

Reuse the existing Changes `target=list` route. Choose it for implicit phone project entry rather
than `target=all`; explicit routes retain their meaning. Use the current project/session owner for
picker selection, recents, and bare-URL restoration. Add the Review all changes command to the
Changes list view. No new storage, route variant, or backend endpoint is required.

### Edge cases and checks

- Picker, recents, and bare-URL restoration on phones; Git, clean Git, and non-Git folders.
- The clean Changes list must still show project tabs and a useful route into Files.
- Direct links and reloaded content stay open, including explicit continuous review. Back/Forward
  retain the intended destination, and switching tabs still opens their existing lists.
- Desktop/tablet entry, phone rotation, canceled/failed project opening, and subsequent retry retain
  their existing resource ownership and recovery.
- Capture project entry and the route from list to review at phone, tablet portrait, tablet
  landscape, and desktop sizes.

## U03 — Line feedback while reading files

### User flow

1. Open a text file from Files or a Search result, including an unchanged file or a file in a
   non-Git project.
2. Tap/click a code row, then **Comment**, using the established diff interaction. Provide a
   keyboard-accessible line action and a visible draft marker/count. Preserve native text selection
   and its Search action, wrapping, and contained horizontal scrolling.
3. Use the same comment editor and voice input. Show the path, **Working tree · line N**, and source
   quote. Use neutral editor guidance suitable for questions, learning notes, and suggested changes.
4. Open Feedback from any project view. It lists that project's diff and file comments with clear
   source labels. The empty state explains where comments can be created. The button opens the
   project's existing drafts/history while viewing lists or Git history as well.
5. Check and copy through the existing preview, selectable-text fallback, history, and Undo flow.
   File comments export path, working-tree source, line, quoted code, and body. Reattaching a file
   comment opens its working-tree file at the anchored line and asks for a new line using the same
   gesture.

The first slice adds comments to text lines. Empty, media, binary, symlink, unsupported, and
oversized views have no text line to anchor; they retain their named viewing states and access to
existing project feedback. Whole-file/project notes and historical Git comments would require
separate flows.

### Data and API shape

Use a discriminated anchor rather than pretending a full file is a Git diff:

```ts
type LineContext = {
  path: string;
  line: number;
  sourceText: string;
  before: string | null;
  after: string | null;
};

type CommentAnchor =
  | (LineContext & {
      kind: "diff";
      layer: "staged" | "unstaged" | "untracked";
      side: "old" | "new";
    })
  | (LineContext & { kind: "file"; source: "worktree" });
```

Keep the common draft/editor/copy transaction owner. Full anchor identity includes its kind, so a
file comment and a diff comment at the same path/line remain distinct. Diff markers count diff
anchors; file markers count file anchors. Reattachment keeps the comment's source kind and project.

Opening Feedback or copying rechecks each source using existing bounded read APIs. Diff drafts use
the current status/diff checks. File drafts reread each commented working-tree file once through
`GET /api/projects/:id/file?source=worktree`, using plain text for checking. A batch containing only
file drafts does not depend on Git status. The same line number, exact source text, and neighboring
context must match. Changed or missing lines become outdated and require explicit reattachment. Read
failures retain the draft and show a clear recovery state; no unavailable line enters the export. A
later edit elsewhere in the file need not invalidate an unchanged anchor.

Version the comment store for the anchor union and migrate valid version-1 drafts and history into
diff anchors without losing bodies, IDs, timestamps, or previously copied text. Keep the existing
storage location readable so migration can happen in place after validation. Emit a new backup
version for the expanded model, while retaining import of supported backup versions 1–3 and their
existing project/root validation. An older app must reject the new backup format clearly rather than
interpret file anchors as old diff data. No comment-writing endpoint or repository write is needed.

### Edge cases and checks

- Files and Search reach the same file-comment identity; unchanged Git and non-Git text both work.
- First/last/blank lines, CRLF, unusual filenames, duplicate comments, language changes, long code,
  wrapping, and selection priority.
- File changes between viewing, checking, and copying; missing files/lines, non-text replacements,
  read failure/retry, and explicit reattachment.
- Mixed diff/file exports keep clear grouping and deterministic order; outdated anchors stay
  excluded.
- Preserve navigation saving, delayed-check merging, pending clipboard ownership, copy failure,
  exact copied-batch history, Undo, project switching, and draft limits for both anchor kinds.
- Validate migration, malformed new anchors, legacy backups, new backup round trips, and unchanged
  old history text.
- Browser QA covers file comment → reload → preview/copy → history/Undo, Search-created feedback,
  non-Git feedback, stale exclusion/reattachment, and existing diff feedback. Capture editor, line
  action, and mixed preview at the four standard sizes.

## Delivery and review

For each aligned slice, run the strict TypeScript and CSS gates, relevant durable tests and focused
browser checks, rebuild client assets, and keep the maintained app available. Backend changes, if
needed for a precise file-read failure boundary, receive their relevant containment/API checks and
service restart. QA uses a separate port and fixture root.

Use `bun run qa:capture` and inspect phone, tablet portrait, tablet landscape, and desktop images
for every visible change. Record useful milestones and exact verification limits here. Real
installed-app Back/Forward and real-device selection, line taps, clipboard, and keyboard behavior
require maintainer device review; browser emulation alone cannot confirm them.

Next step: implement U03 after acceptance of the
[repository formatting and staged-file hook](formatting-workflow.md). The maintainer explicitly
approved committing the formatting work and continuing on 2026-10-04. Commit approval remains
separate from implementation approval; maintenance remains paused.

## U01 handoff — 2026-10-04

- **Alignment:** the maintainer accepted the proposal and requested implementation. Only U01 is
  implemented in this handoff; phone entry and file feedback remain pending their separate review
  steps.
- **Result:** Back/Forward float at the bottom left in every layout, with disabled unavailable
  directions and 44 px touch targets. The pair disappears when neither neighbor is known. The
  heading arrow is labelled Open list. Menus, drawers, modals, active Comment actions, and
  selected-code Search hide the floating pair; resizing an open drawer/menu restores the pair when
  the corresponding pane becomes adjacent. Bottom padding and safe-area offsets keep the final
  content reachable.
- **Ownership:** [NavigationHistory](../src/client/navigation-history.ts) owns a validated,
  versioned trail with at most 100 entries, current-entry identity, forward-branch removal,
  replacements, and traversal serialization.
  [The browser adapter](../src/client/use-navigation-history.ts) owns bounded session-storage I/O,
  reload restoration, page-return reset, and a two-second recovery for ignored traversal. All App
  history writes preserve the trail. URLs retain route ownership; the existing feedback owner
  saves/cancels before traversal and again on native `popstate` as needed. Unknown, malformed,
  oversized, hash, or inconsistent entries cannot become advertised neighbors. Other-document
  returns deliberately start a fresh trail because external navigation can replace remembered
  forward entries.
- **Automated checks:** strict TypeScript, CSS token validation, and build pass. The full suite
  passes 138 tests with 1,540 assertions across 23 files, including 13 new history tests (184
  assertions) for traversal/reload, replacements, branching, native/unknown entries, bounded
  retention and browser eviction, malformed storage, unknown URLs, and rapid/ignored traversal.
- **Browser evidence:** `qa:history-controls` passes at 320, 390, 820, 1180, and 1440 px. It covers
  selected-code Search → result → Back → results → Back → original code, Forward, native traversal,
  reload at earlier/latest entries, Git-ref canonicalization, new forward branches, overlay
  visibility/resizing, hit testing, 44 px targets, containment, rapid clicks, ignored traversal
  recovery, denied/corrupt storage, independent tabs, and return from another document. A
  60-destination run observed Chrome retaining 50 entries; reload and traversal stop correctly at
  the oldest retained entry, with the journal trimmed to the browser's retained length. Existing
  navigation, selected-code Search, loading, feedback transaction, line-action, PWA, tab, and media
  playback checks also pass. Line-action QA now explicitly checks history clearance during the
  action/editor and its restoration after saving.
- **Captures:** inspected [phone](../qa/screenshots/usability-u01-history/mobile.png),
  [tablet portrait](../qa/screenshots/usability-u01-history/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-u01-history/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-u01-history/desktop.png) Search-result captures. The
  [manifest](../qa/screenshots/usability-u01-history/manifest.json) reports no horizontal overflow.
  The initial captures remain in ignored diagnostics; final captures include the tablet stacking fix
  that prevents the adjacent list from intercepting navigation taps.
- **Delivery:** rebuilt assets match both maintained backends and the private HTTPS origin byte for
  byte; app and root API health checks return 200. No backend source change or maintained-service
  restart was needed. The isolated QA server on port 39911 was stopped after verification;
  maintained services remain available.
- **Limits:** checks use Chrome emulation and controlled clipboard promises for transaction cases.
  Actual installed-PWA Back/Forward, native Android/iOS gestures, keyboard, clipboard, and hardware
  safe-area behavior were not newly verified. The other-document check verifies a native browser
  return; it does not establish a physical-device or specific native BFCache outcome. Prior unmarked
  history, cross-document returns, storage denial after reload, and entries beyond the 100-entry
  trail conservatively omit unknown destinations.
- **Review/commit:** the maintainer reported that the behavior is reasonable and works, then
  explicitly approved committing U01 and continuing with U02 on 2026-10-04. U01 is accepted and
  committed as `df92a53` (`feat: add visible browser history controls`). That report does not
  establish every real-device scenario listed above. U02 receives its own uncommitted handoff;
  maintenance remains on hold.

## U02 handoff — 2026-10-04

- **Alignment:** after reviewing U01, the maintainer approved its commit and requested the next
  agreed slice. This handoff implements U02 only; file-line feedback remains U03.
- **Result:** selecting a project from the picker, picker recents, or workspace-menu recents opens
  Changes `target=list` on phones up to 600 px. Bare `/` restoration uses the same entry decision.
  The list includes a 44 px **Review all changes** action above the file groups; choosing it opens
  continuous review, while choosing a file still opens and focuses its diff. A clean Git folder
  retains project tabs and access to Files. A non-Git folder still resolves to its Files list with
  Changes/Git disabled.
- **Boundaries:** [App](../src/client/App.tsx) chooses the destination only for implicit project
  entry; the existing URL parser, project-session owner, and history owner keep their roles. Tablet
  and desktop entry still opens continuous review. Explicit URLs, reload, Back/Forward, and resizing
  preserve the destination. No route variant, storage format, or backend API changed.
  [ChangesSidebar](../src/client/ChangesView.tsx) receives the review command as a callback. Current
  project-open and host-root failures appear in the contextual list with a touch-sized **Choose
  another project** recovery action, so the new phone entry screen cannot hide those errors in the
  content pane.
- **Automated checks:** strict TypeScript, CSS token validation, and build pass. The full
  unit/integration suite passes 138 tests with 1,540 assertions across 23 files. The dedicated
  `qa:project-entry` check covers 320, 390, 600, 601, 820, 1180, and 1440 px; picker/menu recents;
  bare restoration; Review all changes; visible/native history; explicit diff, file, Search-result,
  and commit reload; rotation; touch targets; and containment. It also verifies a visible host-root
  failure and recovery to the picker. Actual clean Git and non-Git fixtures outside any enclosing
  Git repository passed entry, file access, and bare restoration on a phone.
- **Regression evidence:** foundation, navigation, loading, diff, Files, Search, selected-code
  Search, line actions, feedback, feedback transactions, history controls, tabs, PWA, themes,
  typography, voice, and live changes pass. Loading QA retains delayed/abandoned project completion
  guards, cancellation/retry at five widths, current-route ownership, and a normal project-open
  failure with preserved accepted selection and recents. Existing phone QA now explicitly enters
  continuous review when that is the behavior under test; Search starts directly from the entry
  list.
- **Captures:** captured and inspected project entry at
  [phone](../qa/screenshots/usability-u02-project-entry/mobile.png),
  [tablet portrait](../qa/screenshots/usability-u02-project-entry/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-u02-project-entry/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-u02-project-entry/desktop.png), plus Review all changes at
  [phone](../qa/screenshots/usability-u02-review-all/mobile.png),
  [tablet portrait](../qa/screenshots/usability-u02-review-all/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-u02-review-all/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-u02-review-all/desktop.png). Both manifests report no
  page-wide horizontal overflow; the phone enters its list while larger layouts retain their prior
  content entry.
- **Delivery:** rebuilt client assets match both maintained backends and the private HTTPS origin
  byte for byte; app and root API checks return 200. Fixture QA used isolated ports 39911 and 39912;
  both QA servers were stopped after verification. The temporary plain/clean fixture root remains
  recorded under ignored QA diagnostics for repeatability. Maintained services remain available; no
  backend change or restart was needed.
- **Limits:** browser checks use Chrome emulation. The maintainer accepted this slice, without a new
  detailed phone/PWA device-check record. Real-device safe areas, gestures, keyboard, clipboard, or
  microphone behavior were not newly verified. Voice uses the existing mocked recorder/endpoint
  checks; clipboard transaction cases use controlled promises.
- **Review/commit:** the maintainer accepted U02 and explicitly approved committing it on
  2026-10-04. U02 is committed as `b9aeee3` (`feat: open phone projects on the contextual list`).
  The maintainer requested repository formatting and a staged-file hook as the next separate review
  before U03; maintenance remains on hold.
