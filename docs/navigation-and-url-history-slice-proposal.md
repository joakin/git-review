# URL history and navigation

## Navigation model

Navigation has three logical levels: the global menu chooses projects, recents, and Settings; the
contextual list shows Changes, Files, Search, or Git; content shows the selected diff, working-tree
file, or commit. Project tabs belong to the contextual list. Settings contains installation and
local-data controls. A content-heading arrow labelled **Open list** opens that destination's parent
list; it is distinct from history Back.

The URL owns navigable destinations. Menus, drawers, unsent Search typing, card expansion, feedback,
and preferences keep their own transient or persisted state. Opening or dismissing those controls
does not create a route. [Loading and screen transitions](loading-and-transition-polish.md) owns
request freshness, reading-position restoration, and one-time selected-card focus.

## Current user flow

1. An explicit agent/project URL takes precedence over tab storage. Bare `/` restores this tab's
   active project on the explicitly configured legacy agent when available, otherwise it opens that
   agent's project picker.
2. Choosing a project from the picker or recents opens the Changes list on phones. **Review all
   changes** opens continuous review; choosing a changed file opens and focuses its card. Clean Git
   folders retain tabs and access to Files. Non-Git folders open the Files list with Changes/Git
   disabled. Tablet and desktop implicit entry opens continuous review.
3. Files records the directory, selected file, and optional line. Search records the submitted
   query; opening a match keeps Search results as the parent list. Back returns to those results and
   Forward reopens the file.
4. Git records the branch and optional commit. Its comparisons, pagination, and reading-position
   behavior are defined in [Git inspection](git-history-slice-proposal.md).
5. The host folder picker and Settings are destinations. Opening Settings from work allows Back to
   return to that work. Project selection affects only this tab; local drafts and preferences follow
   their [storage lifetimes](independent-tabs-and-pwa-proposal.md).

Implicit phone entry chooses the list only when the project is selected or restored from bare `/`.
Explicit URLs, reloads, history traversal, and viewport changes retain the destination. In
particular, an explicit plain Changes URL means continuous review at every size. Root or
project-opening failures remain visible in the contextual list with **Choose another project**
recovery, so phone entry cannot hide an error in an invisible content pane.

## URL and state shape

Routes use the served `/` page, validated query parameters, and the browser History API. The
[route parser and serializer](../apps/web/src/navigation.ts) define accepted fields, route variants,
and input limits. Examples below show decoded values for readability; construct URLs with
`URLSearchParams`.

```text
/?agent=https://workspace.tailnet.ts.net&section=projects&dir=client-work
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=changes
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=changes&target=list
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=changes&layer=unstaged&file=apps/web/src/App.tsx
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=files&dir=apps/web/src&file=apps/web/src/App.tsx&line=170
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=search&q=selectedWord&file=apps/web/src/App.tsx&line=170
/?agent=https://workspace.tailnet.ts.net&project=/work/git-review&section=git&ref=refs/heads/main&commit=<full-object-id>
```

New destinations carry the normalized agent origin and canonical absolute project path; file paths
stay project-relative. Picker directories and recents retain root-relative browsing metadata. The
[destination envelope](../apps/web/src/agent-navigation.ts) validates ownership separately from the
[route details](../apps/web/src/navigation.ts). The configured connection must match the destination
before requests begin. An unknown host shows **Host connection needed** and makes no agent requests;
its saved review remains available under the
[feedback recovery contract](feedback-slice-proposal.md#saved-feedback-recovery). The
configured-host action opens that host's picker. Add-host configuration remains in the
[connection UI slice](split-host-architecture-proposal.md#11-add-connection-management-and-saved-project-navigation).

Links without an agent field are explicitly legacy root-relative destinations. They resolve only
against the configured legacy endpoint, then replace that entry with the returned canonical path and
endpoint while preserving section/file/line/ref and history identity. Failed legacy lookup keeps the
original destination and its error; it never guesses another host. The
[local-data owner](independent-tabs-and-pwa-proposal.md#local-data-and-backups) defines configured
connections and explicit legacy conversion.

Canonical project lookup does not require a successful root-information request. Resource access
still validates the canonical path against the agent's current approved root under the
[stateless project contract](stateless-project-access-plan.md). A restart needs no registration.
URLs expose host, project/file names and submitted Search text; feedback bodies and source payloads
stay outside them.

## History and responsive rules

Meaningful project, section, directory, query, branch, and file/diff/commit changes push history.
Canonical replacements, including default Git-ref resolution, preserve the current entry's identity.
Same-URL actions do not invent entries. Native Back/Forward parses the resulting URL without pushing
another destination. Navigation saves nonempty editor text and cancels its pending feedback
ownership before changing the route; [Feedback](feedback-slice-proposal.md) defines those
transaction rules.

Agent transitions save pending editor text into the old owner's store and revoke its request
lifetime synchronously, before replacing root/project/UI owners. Notifications and pending voice or
feedback work belong to that UI session. Canonicalization from a retired session cannot rewrite the
new destination. Rapid transitions that return to the same endpoint still create a fresh active
lifetime. Runtime reading positions and cached data include their endpoint under the
[loading owner](loading-and-transition-polish.md); temporary persistence isolation is described in
the [local-data owner](independent-tabs-and-pwa-proposal.md#local-data-and-backups).

| Width             | Visible panes and list action                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| 1200 px and above | Menu, contextual list, and content are adjacent.                                                       |
| 900–1199 px       | The menu is a drawer; the list remains beside content.                                                 |
| 601–899 px        | Menu and list are drawers; Open list reveals the contextual list. The picker is a static screen.       |
| Up to 600 px      | The URL selects a full-width list or content screen. Tabs stay on the list; Open list navigates to it. |

Resizing or rotating changes presentation without rewriting the route or history. The code pane
retains its contained horizontal scroll and native selection. List/content swipe is deferred until
real Android/iOS checks establish that it does not compete with code scrolling, selection, comment
gestures, or browser edge Back; all transitions have visible controls.

## Visible browser history

The floating Back/Forward pair serves installed windows and ordinary browser tabs at every size. It
appears at the bottom left with safe-area spacing, keyboard focus, accessible names, and 44 px
targets. When a known neighbor exists, both buttons retain their positions and the unavailable
direction is disabled; when neither is known, the pair is hidden. Menus, list drawers, dialogs, line
Comment actions, and selected-code actions hide it to keep the active controls reachable. Opening an
adjacent pane after resizing releases that overlay restriction.

History availability is conservative because `history.length` cannot establish where a neighboring
entry leads. App entries carry validated trail/position/entry metadata, checked against a bounded
per-tab journal and the current URL. The journal survives reload but supplies availability only; it
never replaces URL route ownership and is excluded from review backups. Storage denial leaves known
history usable during the page lifetime.

Pushes after Back discard the abandoned forward branch; replacements keep entry identity. Every
history write, including normalization and Git-ref resolution, preserves the same metadata. Fresh
direct links, unmarked entries, malformed or inconsistent metadata, and returns from another
document start conservatively. Entries outside the retained journal or evicted by the browser are
not advertised. Traversals are serialized, and ignored traversal recovers rather than leaving
controls permanently pending. The [history owner](../apps/web/src/navigation-history.ts) and
[browser adapter](../apps/web/src/use-navigation-history.ts) define validation and retention limits.

## Boundaries and failure cases

Treat URLs and browser history/session data as untrusted. Reject unknown/duplicate parameters,
malformed encoding, traversal, invalid sections or layers, invalid lines/refs/commit IDs, oversized
values, and impossible combinations. Normalize harmless omissions; invalid routes show a recoverable
error. Do not silently substitute another project for an explicit broken link.

Unusual filenames use URL encoding. A project may move, disappear, become inaccessible, or leave the
approved root; its read boundary decides access. Files or Search matches may change after selection;
show current content with the relevant stale-result notice. Two tabs can keep different project URLs
and active selections. Drafts and copy history survive navigation.

## Verification and evidence

The maintainer reviewed navigation on phone, tablet, and desktop, then accepted visible history and
phone list entry on 2026-10-04. Browser checks cover parser round trips and rejection, Search result
Back/Forward, direct links/reload, independent tabs, draft retention, responsive boundaries,
conservative history restoration, branching, rapid/ignored traversal, and project-entry failures.
The [QA workflow](qa-workflow.md) owns runnable checks and capture procedures.

The [two-agent browser check](qa-workflow.md#explicit-client-transport) also holds old file, diff,
feedback and media responses while traversing equal-path agents. Unknown-host gating is captured and
inspected at [phone](../qa/screenshots/agent-session-connection-required/mobile.png),
[tablet portrait](../qa/screenshots/agent-session-connection-required/tablet-portrait.png),
[tablet landscape](../qa/screenshots/agent-session-connection-required/tablet-landscape.png), and
[desktop](../qa/screenshots/agent-session-connection-required/desktop.png).

These inspected Chrome-emulation milestones report no page-wide overflow:

| State              | Phone                                                             | Tablet portrait                                                            | Tablet landscape                                                            | Desktop                                                            |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Visible history    | [Image](../qa/screenshots/usability-u01-history/mobile.png)       | [Image](../qa/screenshots/usability-u01-history/tablet-portrait.png)       | [Image](../qa/screenshots/usability-u01-history/tablet-landscape.png)       | [Image](../qa/screenshots/usability-u01-history/desktop.png)       |
| Project entry      | [Image](../qa/screenshots/usability-u02-project-entry/mobile.png) | [Image](../qa/screenshots/usability-u02-project-entry/tablet-portrait.png) | [Image](../qa/screenshots/usability-u02-project-entry/tablet-landscape.png) | [Image](../qa/screenshots/usability-u02-project-entry/desktop.png) |
| Review all changes | [Image](../qa/screenshots/usability-u02-review-all/mobile.png)    | [Image](../qa/screenshots/usability-u02-review-all/tablet-portrait.png)    | [Image](../qa/screenshots/usability-u02-review-all/tablet-landscape.png)    | [Image](../qa/screenshots/usability-u02-review-all/desktop.png)    |

Earlier shell-cleanup evidence remains in the
[picker](../qa/screenshots/maintenance-m05-obsolete-picker/),
[Changes](../qa/screenshots/maintenance-m05-obsolete-changes/),
[list](../qa/screenshots/maintenance-m05-obsolete-list/), and
[Settings](../qa/screenshots/maintenance-m05-obsolete-settings/) milestone folders. Cancellation and
focus captures are linked from the [loading record](loading-and-transition-polish.md#qa).

Maintainer acceptance does not establish every installed-PWA, safe-area, keyboard, clipboard, or
native gesture scenario. Dedicated real-device iOS/Android interruption and selection checks remain
unverified; browser emulation is distinct evidence.
