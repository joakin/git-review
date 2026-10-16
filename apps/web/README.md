# Web application

Preact frontend for the static client and local combined app. It owns navigation, reading surfaces,
feedback, and browser-local data. Run/build instructions belong in
[operations](../../docs/current/operations.md); cross-application ownership is described in
[architecture](../../docs/current/architecture.md).

## Connections and navigation

**Hosts & saved reviews** lets users check an agent before adding it, rename its label, remove its
connection, and recover saved reviews. An endpoint is immutable; a new address is a new host. Recent
projects combine endpoint/path identities across hosts. Selecting one navigates through the normal
compatibility and project checks. The local combined app also has its built-in page-origin agent.

[AgentApplication](src/AgentApplication.tsx) owns each active UI session;
[agent lifetime](src/agent-lifetime.ts), [connection](src/agent-connection.ts), and
[bound APIs](src/agent-api.ts) prevent late work from crossing host switches. Scripted requests omit
credentials and reject redirects. Native media uses source-validated URLs from
[media binding](src/connected-media.ts) and anonymous CORS.

Explicit URLs take precedence over tab restoration. Unknown hosts require an explicit connection
check and acceptance before live reads; a prefilled connection link does not activate itself. Legacy
root-relative links resolve only against the combined app's built-in host.
[Destination ownership](src/agent-navigation.ts), [route parsing](src/navigation.ts), and
[history](src/navigation-history.ts) own the accepted formats and known navigation trail.

Meaningful destination changes push history; canonical replacements preserve it. Back/Forward
replays destinations without adding entries. Responsive layout changes do not rewrite routes.
Implicit project entry on a phone opens the list; explicit destinations retain their intent. Card
toggles, refreshes, and preferences do not repeat route focus. Restore reading positions only after
matching content is ready.

## Reading and updates

Changes presents staged, unstaged, and untracked cards. Section disclosures are independent of file
expansion and route selection. Card open choices are saved; expanded text loads on demand through
bounded [diff queues](src/diff-batch-queue.ts). Selecting a card navigates and focuses it once. Open
reads its current working file in Files, including when the displayed comparison is staged.

[Working-copy review](src/working-copy-review.ts) retains the accepted snapshot. Background checks
pause outside visible Changes and during relevant dialogs. Detected edits offer Update instead of
replacing code under the reader. Refresh reloads expanded bodies even if Git porcelain is unchanged,
retaining drafts and applicable reading position. Files and Search use manual refresh.

[Files](src/FileViewer.tsx) reads the working tree, including non-Git folders;
[Search](src/SearchView.tsx) submits literal queries and opens working files. Single-line source
selections can offer Search; consecutive selections can offer Comment. Only an invoked action
changes the destination or creates feedback.

[Git browsing](src/git-browser.ts) pins history to full commit IDs. Commit diffs and media read
their comparison objects, never substitute working-tree files, and offer no comment creation.
[MediaPreview](src/MediaPreview.tsx) uses native controls and version-bound raw links, with
unavailable/codec fallbacks.

[Diff loading](src/diff-loading.ts) and [cache](src/diff-cache.ts) reject stale completion and
retain only bounded, identity/version-matching results in tab memory.
[Code containment](src/code-rendering.ts) defers browser rendering while retaining source rows in
the DOM. Sticky headings and fixed actions stay outside containment; geometry caches must track
source and layout changes. This is not DOM virtualization. Appearance uses shared design tokens and
semantic syntax roles; optional Google fonts fall back to local monospace.

## Feedback

[Comments](src/comments.ts) owns validated line/range subjects and exact captured source. Files and
Search share working-file anchors. Diff anchors also identify layer and Old/New side: staged is
HEAD→index, unstaged index→working tree, and untracked empty→working tree. Unchanged context
defaults to New; Old reattachment retains Old. A mixed removed/added selection stores both sides
under one comment.

Selections must belong to one current displayed source, with consecutive source lines and no hidden
gaps. Capture exact offsets from the native range, not a search for matching text. Stored fragments
use UTF-16 positions without splitting surrogate pairs. Source replacement invalidates pending
selection actions. Source registration and capture belong to
[code selection](src/code-selection.tsx).

Opening Feedback and copying check a deduplicated anchor batch against fresh source; only anchors
leave the browser. Every component of a range must match. Changed/missing/non-text files mark
comments outdated. Project, permission, network, and other read failures preserve drafts and block
normal export for Retry. Reattachment is explicit and preserves the comment body and identity.

[Feedback transactions](src/feedback-transactions.ts) merge check results only into still-matching
subjects. Confirmed, uncanceled clipboard success archives the exact exported text and removes only
unchanged copied drafts. Edits made during pending work survive. Navigation or editing cancels
ownership; closing Feedback alone permits a pending copy to finish. The
[clipboard writer](src/clipboard-writer.ts) serializes writes across UI activations. Manual
selectable-text copy never clears drafts. Undo restores missing IDs while preserving newer work and
enforcing capacity.

If the host or project disappears, saved quotes and exact history remain accessible. **Copy saved
feedback** explicitly labels freshness as unverified, does no source reads, and neither archives nor
clears drafts. Recovery is owned by [DisconnectedReview](src/DisconnectedReview.tsx) and
[agent feedback](src/agent-feedback.ts).

[VoiceComment](src/VoiceComment.tsx) records for host transcription and inserts at the captured
caret/selection. Pending clips make the textarea read-only; failure retains the clip for Retry or
Cancel. Closing the editor saves typed text, stops recording, cancels requests, and discards audio.
Late results cannot enter a new editor. [Notifications](src/Notifications.tsx) share modal-aware
placement and session ownership; persistent source-update notices remain reader controlled.

## Local data

[Browser data](src/browser-data.ts) coordinates the [repository](src/agent-data.ts) and
[formats](src/agent-data-format.ts). Reviews are endpoint/canonical-path scoped; the saved-review
index is independent of recents and can recover from missing index entries. Host removal retains
review records. A corrupt review is never replaced by an empty fallback. Storage failure preserves
in-memory edits and reports the affected owner; temporary mode does not make them durable.

Global export includes stored reviews plus this tab's unsaved edits. Imports preview matching
replacements, preserve unrelated records and the active destination, and publish a verified staged
generation before cleanup. Failures before publication retain prior data; uncertain
publication/restoration retains both generations and reports the uncertainty. Reload other tabs
after import.

[Legacy conversion](src/legacy-data.ts) supports specific path-only records and backups through
explicit host assignment. It retains original source keys and publishes completion with the
converted data. Changed sources or another tab's completed conversion invalidate an old preview.
This is bounded format support, not a promise to read every historical version. The assignment
screen can export a backup without converting, enabling origin transfer.

[Tab state](src/agent-tab-state.ts) retains each tab's destination separately.
[Service worker](src/sw.ts) caches only a deployment-scoped offline fallback; it does not cache the
live app shell, API, raw media, or repository data. Different deployment paths share review storage
when their browser origin is the same. Installation and origin-transfer instructions belong in
[operations](../../docs/current/operations.md#installation-and-data-transfer).
