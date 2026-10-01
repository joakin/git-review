# Engineering conventions

## Runtime validation

Use [the shared validation helpers](../src/shared/validation.ts) for generic checks on unknown values, such as records and strings. Keep each wire format's parser near its domain: API response shapes in `src/shared/api.ts`, saved browser state in `src/client/storage.ts`, and filesystem path rules in `src/server/paths.ts`. Callers receive validated types or a clear failure; they do not cast raw data into app types.

Files and diff response parsers share private syntax-state and syntax-token validators in [api.ts](../src/shared/api.ts). They validate supported variants/roles, bounded language strings, at most 20,000 tokens per line, and exact token-text reconstruction. Each response parser owns its 100,000-token aggregate budget; diff rejects overflow before parsing another batch. Keep diff side, newline, word-span, and hunk invariants in the diff parser. [Boundary tests](../src/shared/api.test.ts) exercise the public response parsers; the browser TypeScript project excludes test roots, and the dedicated test project checks them with Bun types.

## Browser navigation

Keep navigable destinations in the typed [route model](../src/client/navigation.ts). Parse the URL before rendering, serialize routes with `URLSearchParams`, and use History API entries for meaningful destinations. Do not add a second component-state source of truth for the selected project, section, directory, file, submitted Search query, Git branch, or commit. The [navigation record](navigation-and-url-history-slice-proposal.md) describes the menu/list/content hierarchy and the distinction between URL state and local drafts or preferences.

Update the active route reference synchronously when navigating or handling `popstate`, so rapid Back/Forward records scroll against the correct route. An asynchronous response or scheduled scroll must not act on a destination the user has left. Save an open comment draft before closing its editor for navigation.

Focus a URL-selected diff once for that navigation, after its inventory and card exist. Expanding or collapsing a card, refreshing status, or updating preferences must not repeat the route's scroll or force that card open. Selecting the same file again is a new navigation intent and can focus it again.

## Loading, data lifetime, and scroll

Start requests immediately. Use [DelayedLoading](../src/client/DelayedLoading.tsx) for a status message only after 300 ms; avoid changing control labels or clearing loaded content during short waits. Errors remain visible when known. Keep same-resource content while refreshing, but key loaded state by its project/path/query so a new destination never paints the previous destination's data. Abort superseded requests and ignore aborted results. Project-opening completion also checks the latest synchronous route reference: route ownership can change before effect cleanup aborts its controller. Clear the opening flag when a route no longer needs the request, and never let an abandoned callback clear a replacement operation or save its selection.

The open project handle, Git inventory, latest directory/tree, and latest Search results live in app state. The [diff cache](../src/client/diff-cache.ts) retains validated diff payloads in tab memory, bounded to 128 entries and roughly 32 MiB. Its identity includes project, layer, path, revision, change token, refresh generation, and language. Do not cache errors or stale responses. A manual Refresh or accepted change token must fetch fresh diffs.

[ResourceCache](../src/client/resource-cache.ts) owns the common storage mechanism used by the diff adapter and Git browser: hit promotion, replacement/removal byte accounting, oversized-write rejection, and oldest-entry eviction. Domain modules choose keys, budgets, and freshness; the diff adapter excludes stale results before they can replace or promote an entry. Byte accounting estimates serialized UTF-16 size, rather than total browser heap usage. An oversized replacement preserves the existing value and its eviction position.

Return cached expanded diffs on the first render before restoring scroll, so their height is already present. Card-open preferences persist in browser storage; diff payloads do not survive reload or enter backups. Working-tree file payloads currently refetch on viewer remount. Expanding caching beyond this scope needs an explicit freshness policy. The [loading record](loading-and-transition-polish.md) documents the behavior and regression checks.

Git inspection uses a separate lifetime: branch/history caches represent a snapshot until Refresh or reload, and paging carries its immutable tip. Commit metadata and diffs are keyed by exact object IDs, so working-copy change tokens cannot invalidate them. Historical collapsed cards are bounded tab-memory state. The [Git record](git-history-slice-proposal.md#data-lifetime) gives cache limits and the three-request diff queue. The shared diff presentation distinguishes working-copy review from historical inspection; never label historical anchors as Staged or Unstaged, or fall back to disk content for a missing Git side.

## Feedback transactions

[FeedbackTransactions](../src/client/feedback-transactions.ts) owns line-check cancellation, operation generations, and the shared clipboard lease for draft and history copies. Store reads and writes use the latest synchronous comment reference; a render's captured store is not a transaction commit target. The [comment model](../src/client/comments.ts) owns full-anchor matching, checked export snapshots, exact-version removal, bounded copy history, and Undo restoration. Keep those merge rules at this boundary rather than coordinating them in callers.

Validated comment anchors use the explicit `ReviewLayer` union: staged, unstaged, or untracked. Keep `ChangeLayer` broad at the status-entry boundary, where `anchorForLine` rejects conflict input before constructing an anchor. Storage and backup parsers validate both drafts and copy-history anchors; their types, checking, export, and Undo carry the precise domain contract. Introducing a new Git layer requires an explicit decision about whether it supports line feedback.

A completed check changes validity only for existing drafts whose anchors still match its snapshot. Both manual preview and automatic copy use the successful check's ID/anchor set. A successful copy archives the exact exported batch into current history and removes only unchanged copied versions. Navigation or opening an existing draft editor cancels the active operation; an already issued browser clipboard write retains its lease until settlement, and a canceled result cannot clear drafts or change history, Undo, notices, or check errors. The [feedback record](feedback-slice-proposal.md) describes the user-visible contract and limits.

## Visual design values

[Design tokens](../src/client/design-tokens.css) define the light/dark app and code palettes, type scale, common spacing, corner radii, layout widths, and shadows. [navigation.css](../src/client/navigation.css) owns header, menu/list/content geometry, route visibility, drawer breakpoints, and reduced motion; [styles.css](../src/client/styles.css) imports it and owns component presentation, including welcome/error screens. Both use those tokens. The active menu/list widths use `--workspace-menu-width` (216 px) and `--project-list-width` (300 px). Keep app surfaces separate from code surfaces and use the on-accent role for text placed on accent buttons. Keep values reused across components or useful for global tuning in the token file; one-off component geometry can stay next to its selector. The CSS token check scans every `src/client/**/*.css` file and runs with `bun run qa:check` so an undefined variable in any owner fails before visual QA. Bun bundles the imported styles into the existing client CSS asset.

After changing a token or a layout selector, build the client and inspect desktop, tablet, and phone screenshots as described in [the QA workflow](qa-workflow.md).
