# Architecture

## Applications and trust

The static frontend runs in the user's browser and connects directly to agents on code hosts. The
local combined server serves the same frontend with a built-in page-origin agent. Independently
deployed web and agent artifacts need no shared runtime. [Package documentation](workspace.md)
identifies implementation owners.

An agent exposes files within an approved root and has no built-in user authentication. Private
network access must be enforced outside it. Its origin allowlist governs browser CORS requests, not
direct HTTP access. The frontend's hosting account is also trusted: its JavaScript can read
repositories through authorized connections. [Operations](operations.md) owns configuration and
deployment.

Each resource request revalidates canonical project access and containment. Earlier lookup or cached
metadata never authorizes a later read. Restart loses server memory but requires no project
registration; interrupted requests can retry. Moving a folder changes its identity. Replacing
contents at the same path does not create a new review identity, so feedback still needs source
checking.

## Identity and connection ownership

A browser project is identified by normalized agent endpoint plus canonical absolute folder path.
Equal paths on different agents are separate projects. Picker directories remain relative to the
approved root; that browsing metadata does not grant access. URLs identify navigable destinations,
including endpoint, project, section, and selected content. Feedback bodies stay outside URLs.

The browser binds its API, queues, and media URLs to an explicit connection. A compatible
information handshake precedes repository reads. Switching agents synchronously retires the old
UI/request lifetime; returning to the same endpoint creates a fresh activation. Late results cannot
update the replacement session. Removing a saved connection preserves saved feedback; recovery
metadata grants no source access. Details belong to [web](../../apps/web/README.md) and
[agent](../../apps/agent/README.md).

## State lifetimes

| Lifetime                | Owned state                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| URL                     | Navigable destination and submitted Search text.                                   |
| Per-tab session storage | Bare-URL project restoration and the known Back/Forward trail.                     |
| Browser-local storage   | Host catalog, recents, drafts, exact copied history, and preferences.              |
| Tab memory              | Loaded source, bounded caches, reading positions, transient UI, and pending audio. |
| Agent memory            | Configuration, bounded caches, and active subprocess/transcription work.           |
| Service worker          | Deployment-scoped offline fallback page only.                                      |

Browser storage belongs to an origin, not a device account or tailnet. Tabs share persistent records
while selecting destinations independently; simultaneous edits have no conflict resolution. Backups
contain review data and preferences, not loaded repository contents or navigation history. The
[web data owner](../../apps/web/README.md#local-data) explains recovery and publication.

## Source and operation lifetimes

Mutable working files, accepted working-copy review snapshots, and immutable Git objects require
different freshness policies. A cache key must identify its resource and version, including endpoint
ownership. Successful reads can be reused only for that identity; errors and superseded responses
cannot populate caches. Working-copy metadata detects ordinary edits but does not establish byte
equality or an atomic repository snapshot.

User-authored feedback outlives loaded source. Checking validates captured source; it must not
silently relocate a comment. Unavailable source requires Retry or an explicit saved-feedback copy.
File absence and project/network failures have different meanings. The
[web README](../../apps/web/README.md#feedback) owns these semantics and links transaction code.

Operations retain ownership through side-effect completion. An already-issued clipboard write may be
impossible to stop, but canceled completion cannot archive or clear drafts. An open descriptor pins
a filesystem object, not its mutable bytes. A Git object ID does not authorize filesystem access.
These guarantees must remain distinct when sharing mechanisms.
