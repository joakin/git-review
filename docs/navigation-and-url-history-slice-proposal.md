# URL history and navigation

Status: implemented, manually reviewed on phone, tablet, and desktop, and committed as `6c82a81`. Loading/cache and route-focus follow-ups are committed as `471521e`.

## Why revisit navigation

The former app kept Changes / Files / Search, the folder or file sidebar, the selected file, and the Search query in component state. Opening a Search result switched to Files without adding a browser history entry. Browser Back therefore could not return to the result list. The sidebar also switched between unrelated jobs: choosing a host folder, listing changes, and browsing project files. That made the phone drawer feel like another screen without giving it normal screen navigation.

The implemented navigation has **three distinct levels**:

1. **Menu:** choose a project, revisit recent projects, and open Settings. Settings contains the installation and local data controls.
2. **List screen:** browse host folders, Git changes, project files, Search results, or branches and commits. Its identity and selection come from the route.
3. **Content screen:** read a diff, working-tree file, or full commit comparison, add working-copy comments, and open feedback. The content keeps the list it came from as context.

These are logical screens, not a fixed number of visible columns. A wide desktop shows menu, list, and content together. The list stays beside content at 900 px and above; narrower tablets reveal it as a drawer using the content-heading back arrow. Phones up to 600 px show one full-width list or content screen at a time. **Changes / Files / Search / Git tabs belong only to the contextual list**, separate from the global menu; phone content shows the shared back arrow instead of repeating the tabs. A guarded horizontal swipe remains optional after real-device testing. The code pane keeps its own horizontal scroll, text selection, and line gestures; the app must not take over browser edge Back gestures. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action), [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior)

## Current user flow

1. Open the installed app or a normal tab. With no explicit route, show the project menu/recent projects or restore this tab's active project. An explicit project URL always wins over tab storage.
2. Choose a project. The Changes tab opens with the continuous **Review all changes** page by default. Its staged, unstaged, and untracked file list remains available alongside the content on a wide screen or as a full-width screen on a phone. Selecting an entry focuses its diff.
3. Open Files, walk directories, and select a file. The URL records the project, list context, file, and optional line. On a phone, Files list and file content are separate full-width screens; on a wide display they can sit side by side.
4. Submit Search. The results list becomes a route. Tap a result: the file opens while Search remains its parent list. Browser Back returns to those results and Forward reopens the file. On a wide display, the Search results can remain visible next to the file.
5. Open the host folder picker from the menu. It is a navigable list screen rather than a special sidebar mode. Selecting a folder changes the active project in this tab.
6. Open Git, choose a branch, and select a commit. Branch and commit destinations use the same list/content and Back/Forward patterns. The [Git inspection record](git-history-slice-proposal.md) describes immutable comparisons, paging, and cached reading positions; it is reviewed and committed as `22de40e`.

Feedback drafts, copy history, wrap choice, theme preferences, and recent projects remain browser-local. Opening or dismissing a menu, drawer, keyboard, or comment sheet does not by itself create a new URL. Before a route transition, close or save an edited comment sheet through the existing draft rules.

## URL and state shape

Use the existing `/` page with validated query parameters and the browser History API; no router dependency is needed for this route set. This keeps direct links within the current server and installed PWA scope. `pushState` adds meaningful destinations; `replaceState` normalizes the first entry or corrects an invalid one; `popstate` restores the route on Back/Forward. The URL, rather than `history.state` or component state, is the source of truth for navigation. [MDN History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API)

Example URLs (values shown decoded for readability; construct them with `URLSearchParams`):

```text
/?section=projects&dir=client-work
/?project=git-review&section=changes
/?project=git-review&section=changes&target=list
/?project=git-review&section=changes&layer=unstaged&file=src/client/App.tsx
/?project=git-review&section=files&dir=src/client&file=src/client/App.tsx&line=170
/?project=git-review&section=search&q=selectedWord
/?project=git-review&section=search&q=selectedWord&file=src/client/App.tsx&line=170
/?project=git-review&section=git&ref=refs/heads/main
/?project=git-review&section=git&ref=refs/heads/main&commit=<full-object-id>
```

The Search URLs illustrate selecting a result: adding a file target keeps the result list as its parent. The plain Changes URL means continuous review; `target=list` opens its file list on a phone. Changes can also target an individual diff; Files can target a directory or file. A Git URL records the full branch ref (or `HEAD`) and an optional full commit ID. The [route parser](../src/client/navigation.ts) produces a precise discriminated union:

```ts
type Route =
  | { section: "projects"; directory: string }
  | { section: "changes"; projectPath: string; target: ChangesTarget }
  | { section: "files"; projectPath: string; directory: string; target: FileTarget }
  | { section: "search"; projectPath: string; query: string | null; target: SearchTarget }
  | { section: "git"; projectPath: string; ref: string | null; target: GitTarget }
  | { section: "settings"; projectPath: string | null };

type ChangesTarget =
  | { kind: "list" }
  | { kind: "all" }
  | { kind: "file"; layer: "staged" | "unstaged" | "untracked" | "conflict"; path: string };
type FileTarget = { kind: "list" } | { kind: "file"; path: string; line: number | null };
type SearchTarget = { kind: "results" } | { kind: "file"; path: string; line: number };
type GitTarget = { kind: "list" } | { kind: "commit"; oid: string };
```

The URL stores a **root-relative project path**, because the server's current project ID is registered only in memory. A direct link or reload first calls the existing project-open endpoint, which revalidates the approved root and returns a fresh ID, then loads the requested content. File paths remain project-relative. No repository path becomes a server filesystem write. No new backend endpoint is required for the first URL checkpoint. The server still validates every project, file, and search request independently.

Keep only navigable state in the URL. Search typing before submission, list filters, open cards, scroll positions, comment drafts, and preferences remain transient or in their current browser storage. Preserve the per-tab project selection: visiting an explicit project URL updates only that tab's `sessionStorage`; opening `/` may restore that tab's project. A link copied into a new tab or device opens the project named by the URL if that host allows it.

## History and responsive rules

- Push an entry when changing project, section, directory, submitted Search query, Git branch, or selected file/diff/commit. Do not push for each keystroke, wrap toggle, menu reveal, or drawer toggle.
- Back/Forward must parse the current URL and render it without writing another history entry. If results are still cached in the tab, reuse them; after reload, rerun the bounded Search query. Restore the prior list/content scroll position after asynchronous loading where practical.
- A direct link to a file must work without prior navigation in this tab. Its visible List control opens the route's parent list; browser Back follows the browser's actual previous entry. Never assume that the previous entry belongs to this app.
- The route describes the logical destination. Viewport width decides which panes are visible, so rotating a phone or resizing a browser does not rewrite history.
- On a phone, use explicit controls first. Add swipe between list and content only if real iOS and Android checks show no conflict with code horizontal scrolling, browser navigation, selecting text, or comment gestures. Use the same route transitions as the visible controls.
- The plain Changes route remains continuous review. Switching project tabs on a phone stays on the relevant list screen; selecting a changed file then opens the continuous content and focuses that card. On wide screens, the list stays available beside content.
- A selected diff URL expands and focuses its card once per navigation. Card toggles and Refresh do not repeat that focus. Choosing the same file again or Back/Forward to its URL can focus it again. Matching expanded diff payloads come from the tab cache on the first render; see [loading and screen transitions](loading-and-transition-polish.md).

## Boundaries and failure cases

- Parse URL data as untrusted: reject unknown or duplicate state parameters, malformed encodings, invalid section/layer, out-of-range line numbers, oversized query/path, traversal, and impossible combinations. Normalize harmless omissions with `replaceState`; show a recoverable error and project picker for a route that cannot be opened. Do not silently substitute another project for an explicit broken link.
- Handle unusual filenames (spaces, Unicode, `?`, `#`, `%`, and newlines) through `URLSearchParams`; do not concatenate raw path strings. The URL exposes root-relative names and Search terms in browser history, so keep absolute host paths, comment text, and tokens out of it.
- A project can move, be deleted, become inaccessible, or leave the approved root; the existing open/read boundaries decide access on every reload. A file or matching line can change between Search and opening it; show the current file and a stale-result notice.
- Switching routes while a comment is open must preserve its draft. Back should never clear feedback or copy history. Two tabs can show different project URLs and retain separate active projects.
- Check installed PWA reload and deep links over the existing HTTPS origin. Query URLs use the already served `/` path, so no new HTML route fallback is needed for this first design.

## Implementation sequence

1. **URL history checkpoint:** add one typed route parser/serializer and a small navigation adapter in the Preact client. Derive Changes, Files, Search, project, selected file, and submitted query from it while keeping the current visual shell. Prove Search → result → browser Back → results → Forward → file, including reload/direct link and independent tabs. Do this before rearranging panes so the history behavior is reviewable on its own.
2. **Screen structure checkpoint:** separate the menu, list screens, and content screens. Keep current feedback and continuous diff behavior. Show all three levels on a wide display, make the tablet list toggleable, and give phone list/content full-width views with visible navigation. Check narrow widths and both tablet orientations at every change.
3. **Optional gesture checkpoint:** prototype list/content swipe on real phones, retain it only where it does not compete with native gestures and code reading. Keep visible navigation regardless of gesture support.

Behavior tests should cover URL parsing/serialization, invalid and unusual paths, explicit URL versus tab storage, Search result Back/Forward, reload/direct link, and draft retention. Browser QA should capture phone, tablet portrait, tablet landscape, and desktop; test real Android and iOS for swipe and installed-app Back behavior. The [QA workflow](qa-workflow.md) remains the checklist.

## Maintainer review

The maintainer confirmed that continuous review is the default Changes content. The Search result flow keeps Search as its parent list. After reviewing the first implementation, the maintainer moved Changes / Files / Search tabs to the contextual list and the project name and path above them. The global menu now contains project choice, recents, and Settings; Install & local data moved into Settings. The main reading pane no longer repeats the project heading or host-status subtitles. A further review placed phone tabs only on the list screen and replaced view-specific list buttons with one back arrow beside the content title.

## Implementation record

- `src/client/navigation.ts` owns the URL parser, serializer, and route variants. It rejects duplicate/unknown parameters, traversal, malformed encoding, invalid combinations, and out-of-range lines. Direct links are normalized with `replaceState`; meaningful destinations use `pushState`. `/` restores the active project in this tab or opens the project picker. Explicit URLs take precedence over tab storage.
- The route chooses the project, section, list context, selected file/diff, submitted Search query, and optional file line. A direct project link reopens it through the existing validated project endpoint. Search results remain the parent list when a result opens; Back and Forward restore each route. Switching routes saves an open comment as a draft through the existing draft path.
- At 1200 px and above, menu, contextual list, and content appear together. From 900 to 1199 px, the menu becomes a drawer while the list stays beside content. Below 900 px, the list becomes a drawer and the back arrow beside the content title reveals it. The list begins with the project name, absolute path, and project tabs; a subdirectory breadcrumb appears only after entering a folder. The project picker fills the tablet screen. On phones up to 600 px, the list and content are separate full-width route screens: tabs appear only with the list, switching tabs stays there, and the same content-heading arrow returns to it. Settings is a route so Back returns to the prior work. Menu and drawer reveals remain transient.
- A visual follow-up gives phone Changes groups rounded cards, uses shared local SVGs for folder, file, link, and back icons, and keeps a selected file's path in its sticky location bar. The working-tree card names the source and shows file metadata without repeating the path. [Devicon](https://github.com/devicons/devicon) focuses on language and tool logos; generic navigation icons use the small shared SVG set.
- The optional swipe gesture is deferred until real iOS/Android tests can establish that it does not interfere with browser Back, horizontal code scrolling, text selection, or line taps. Visible controls implement every transition.
- The later [loading and cache follow-up](loading-and-transition-polish.md) reuses the opened project in the tab, restores expanded diff height before scroll, records the latest route during rapid history changes, and limits selected-card focus to one action per navigation. The maintainer approved the corrected card behavior on 2026-09-30.
- `bun test src/client/navigation.test.ts` protects route round trips and invalid URL behavior. `bun run qa:navigation <url>` checks Back/Forward, Search → result → Back, reload/direct links, Files and Changes targets, a draft across Back, the phone list/content flow, tablet list toggle, the 899/900 px sidebar boundary, desktop panes, and invalid-link recovery. Existing feature QA was adapted to use routes. The [QA workflow](qa-workflow.md) has capture and device checks.

## Maintenance verification — 2026-10-01

[M05a](maintenance-plan.md#m05--remove-obsolete-ui-and-consolidate-layout-css) is accepted and committed as `2d6879d`. It removes the unreachable folder-picker “Back to project” control and unused ready-panel/icon/footnote styles, sidebar-switch selectors, indent token, and Changes margin modifier. Current route, state, pane, and button behavior retain their existing owners and rules; M05b now gives that shell a dedicated stylesheet, as recorded below.

Captured and inspected [picker](../qa/screenshots/maintenance-m05-obsolete-picker/mobile.png), [expanded Changes](../qa/screenshots/maintenance-m05-obsolete-changes/mobile.png), [Changes list](../qa/screenshots/maintenance-m05-obsolete-list/mobile.png), and [Settings](../qa/screenshots/maintenance-m05-obsolete-settings/mobile.png) at phone, tablet portrait, tablet landscape, and desktop sizes. All sixteen PNGs match their pre-cleanup captures byte for byte, and their manifests report no page-wide overflow. Four affected screens also fit at 320 px. Strict type/CSS gates, navigation parser tests, build, loading checks, and touch diff/wrap/scroll checks passed. An initial concurrent navigation run timed out returning to the picker; both a diagnostic run and an unmodified rerun then passed, including the 899/900 px boundary, without code changes. Its timing cause remains unisolated and is recorded in the [M05a handoff](maintenance-plan.md#m05a-handoff--2026-10-01). These checks use Chrome emulation; real-device gestures were not reverified. The QA server was stopped, and the maintained HTTP/HTTPS services serve the rebuilt client.


[M05b](maintenance-plan.md#m05b-handoff--2026-10-01) is accepted and committed as `1d28fc5`. [navigation.css](../src/client/navigation.css) owns header, menu, contextual list/tabs, content geometry, route visibility, breakpoints, and reduced motion; component styles remain in [styles.css](../src/client/styles.css). The active menu/list width tokens replace superseded two-column widths. Computed styles and geometry match committed M05a across 252 recorded states, including exact breakpoint widths, reduced motion, Search results, controlled non-Git tab disabling, and already-open drawers while resizing. Sixteen fresh four-size PNGs also match the curated images above byte for byte; comparison copies stay ignored rather than duplicating milestone assets. Strict gates, build, loading, diff, Search, live updates, a sequential navigation rerun, and 320 px checks passed.

The earlier picker timeout now has a deterministic reproduction on both committed M05a and M05b: hold project opening, then use browser Back before it completes. The aborted request leaves the opening flag set, so the picker stays disabled with “Opening…”. The route-name label appears before completed project data and can expose this timing path in ordinary QA. [M05c](maintenance-plan.md#m05c--reset-canceled-project-opening) now implements the focused reset and delayed-response regression, accepted and approved for commit. M05b leaves that state code unchanged, and successful navigation reruns do not eliminate the defect. These checks use Chrome emulation; actual iOS/Android behavior was not reverified.


[M05c](maintenance-plan.md#m05c-handoff--2026-10-01) clears the obsolete opening flag when leaving a pending open. Success and error completion also require the latest synchronous route to belong to that project, closing the interval before effect cleanup aborts the request. The picker returns to the same directory with “Open this folder” enabled; a retry can succeed, and abandoned results cannot acquire the current project's saved selection. `qa:loading` now calls the focused cancellation helper covering native abort/retry at five widths, buffered success during Back, late success/error around replacement completion, and normal failure recovery. Existing navigation and feedback transaction checks passed. Four-size [recovery captures](../qa/screenshots/maintenance-m05c-opening-recovery/mobile.png) show the picker only after a deliberately canceled open and Back; the manifest records no page overflow. The maintainer accepted the change and explicitly approved committing it on 2026-10-01.
