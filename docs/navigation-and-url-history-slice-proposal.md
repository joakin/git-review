# Deferred slice proposal: URL history and navigation

Status: proposal for maintainer review; implementation deferred. Place this late in the roadmap, immediately before optional repository and file Git history browsing.

## Why revisit navigation

The current app keeps Changes / Files / Search, the folder or file sidebar, the selected file, and the Search query in component state. Opening a Search result switches to Files without adding a browser history entry. Browser Back therefore cannot return to the result list. The sidebar also switches between unrelated jobs: choosing a host folder, listing changes, and browsing project files. That makes the phone drawer feel like another screen without giving it normal screen navigation.

The proposed destination has **three distinct levels**:

1. **Menu:** choose a project, revisit recent projects, and eventually open Settings or local data controls.
2. **List screen:** browse host folders, Git changes, project files, or Search results. Its identity and selection come from the route.
3. **Content screen:** read a diff or working-tree file, add comments, and open feedback. The content keeps the list it came from as context.

These are logical screens, not a fixed number of visible columns. A wide desktop can show menu, list, and content together. A tablet can show content with a toggleable list and a compact menu. A phone shows one full-width screen at a time, with a visible List/Back control. Keep **Changes / Files / Search tabs in the project content area**, separate from the global menu; the active tab determines which list appears beside or behind the content. Keep those tabs reachable on the phone when either its list or content screen is visible. A guarded horizontal swipe may offer the same transition after real-device testing. The code pane must keep its own horizontal scroll, text selection, and line gestures; the app must not take over browser edge Back gestures. [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action), [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior)

## Proposed user flow

1. Open the installed app or a normal tab. With no explicit route, show the project menu/recent projects or restore this tab's active project. An explicit project URL always wins over tab storage.
2. Choose a project. The Changes tab opens with the continuous **Review all changes** page by default. Its staged, unstaged, and untracked file list remains available alongside the content on a wide screen or as a full-width screen on a phone. Selecting an entry focuses its diff.
3. Open Files, walk directories, and select a file. The URL records the project, list context, file, and optional line. On a phone, Files list and file content are separate full-width screens; on a wide display they can sit side by side.
4. Submit Search. The results list becomes a route. Tap a result: the file opens while Search remains its parent list. Browser Back returns to those results and Forward reopens the file. On a wide display, the Search results can remain visible next to the file.
5. Open the host folder picker from the menu. It is a navigable list screen rather than a special sidebar mode. Selecting a folder changes the active project in this tab.

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
```

The last two URLs are the key Search flow: selecting a result adds a file target to the Search route, so the result list remains its parent. The plain Changes URL means continuous review; `target=list` opens its file list on a phone. Changes can also target an individual diff; Files can target a directory or file. A route parser should produce a precise discriminated union, for example:

```ts
type Route =
  | { section: "projects"; directory: string }
  | { section: "changes"; projectPath: string; target: ChangesTarget }
  | { section: "files"; projectPath: string; directory: string; target: FileTarget }
  | { section: "search"; projectPath: string; query: string | null; target: SearchTarget };

type ChangesTarget =
  | { kind: "list" }
  | { kind: "all" }
  | { kind: "file"; layer: "staged" | "unstaged" | "untracked" | "conflict"; path: string };
type FileTarget = { kind: "list" } | { kind: "file"; path: string; line: number | null };
type SearchTarget = { kind: "results" } | { kind: "file"; path: string; line: number };
```

The URL stores a **root-relative project path**, because the server's current project ID is registered only in memory. A direct link or reload first calls the existing project-open endpoint, which revalidates the approved root and returns a fresh ID, then loads the requested content. File paths remain project-relative. No repository path becomes a server filesystem write. No new backend endpoint is required for the first URL checkpoint. The server still validates every project, file, and search request independently.

Keep only navigable state in the URL. Search typing before submission, list filters, open cards, scroll positions, comment drafts, and preferences remain transient or in their current browser storage. Preserve the per-tab project selection: visiting an explicit project URL updates only that tab's `sessionStorage`; opening `/` may restore that tab's project. A link copied into a new tab or device opens the project named by the URL if that host allows it.

## History and responsive rules

- Push an entry when changing project, section, directory, submitted Search query, or selected file/diff. Do not push for each keystroke, wrap toggle, menu reveal, or drawer toggle.
- Back/Forward must parse the current URL and render it without writing another history entry. If results are still cached in the tab, reuse them; after reload, rerun the bounded Search query. Restore the prior list/content scroll position after asynchronous loading where practical.
- A direct link to a file must work without prior navigation in this tab. Its visible List control opens the route's parent list; browser Back follows the browser's actual previous entry. Never assume that the previous entry belongs to this app.
- The route describes the logical destination. Viewport width decides which panes are visible, so rotating a phone or resizing a browser does not rewrite history.
- On a phone, use explicit controls first. Add swipe between list and content only if real iOS and Android checks show no conflict with code horizontal scrolling, browser navigation, selecting text, or comment gestures. Use the same route transitions as the visible controls.
- The present continuous Changes page remains the default destination for the Changes tab. The Changes file list remains available without replacing its content on wide screens.

## Boundaries and failure cases

- Parse URL data as untrusted: reject unknown or duplicate state parameters, malformed encodings, invalid section/layer, out-of-range line numbers, oversized query/path, traversal, and impossible combinations. Normalize harmless omissions with `replaceState`; show a recoverable error and project picker for a route that cannot be opened. Do not silently substitute another project for an explicit broken link.
- Handle unusual filenames (spaces, Unicode, `?`, `#`, `%`, and newlines) through `URLSearchParams`; do not concatenate raw path strings. The URL exposes root-relative names and Search terms in browser history, so keep absolute host paths, comment text, and tokens out of it.
- A project can move, be deleted, become inaccessible, or leave the approved root; the existing open/read boundaries decide access on every reload. A file or matching line can change between Search and opening it; show the current file and a stale-result notice.
- Switching routes while a comment is open must preserve its draft. Back should never clear feedback or copy history. Two tabs can show different project URLs and retain separate active projects.
- Check installed PWA reload and deep links over the existing HTTPS origin. Query URLs use the already served `/` path, so no new HTML route fallback is needed for this first design.

## Smallest useful checkpoint and sequence

1. **URL history checkpoint:** add one typed route parser/serializer and a small navigation adapter in the Preact client. Derive Changes, Files, Search, project, selected file, and submitted query from it while keeping the current visual shell. Prove Search → result → browser Back → results → Forward → file, including reload/direct link and independent tabs. Do this before rearranging panes so the history behavior is reviewable on its own.
2. **Screen structure checkpoint:** separate the menu, list screens, and content screens. Keep current feedback and continuous diff behavior. Show all three levels on a wide display, make the tablet list toggleable, and give phone list/content full-width views with visible navigation. Check narrow widths and both tablet orientations at every change.
3. **Optional gesture checkpoint:** prototype list/content swipe on real phones, retain it only where it does not compete with native gestures and code reading. Keep visible navigation regardless of gesture support.

Behavior tests should cover URL parsing/serialization, invalid and unusual paths, explicit URL versus tab storage, Search result Back/Forward, reload/direct link, and draft retention. Browser QA should capture phone, tablet portrait, tablet landscape, and desktop; test real Android and iOS for swipe and installed-app Back behavior. The [QA workflow](qa-workflow.md) remains the checklist.

## Maintainer review

The maintainer confirmed that continuous review is the default Changes content and that the Changes / Files / Search tabs stay in the main project content area. The Search result flow keeps Search as its parent list. Implementation remains a later slice, before optional Git history browsing.
