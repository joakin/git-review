# Independent tabs, installation, and local data

Each tab has its own active-project fallback, while recents and saved review data belong to the
browser origin. The app can run in an installed window, but live project reads still require the
host. [Navigation](navigation-and-url-history-slice-proposal.md) owns destinations;
[stateless access](stateless-project-access-plan.md) owns canonical project identity and restart
behavior.

## Independent tabs

An explicit URL takes precedence over tab storage. The bare deployment URL (`/` in local
development) restores a valid active folder for that tab or opens the picker. Selecting a folder
updates only that tab's fallback selection, while recents remain shared. A failed selection does not
replace the last accepted fallback or saved review work. Missing/malformed tab data or a different
approved root cannot silently select another folder.

Saved folder paths share the [navigation-path rules](../apps/web/src/navigation-path.ts), including
the empty path for the approved root. Invalid tab paths return to the picker; a malformed recents
record uses the empty-workspace fallback. Backup import rejects invalid recent paths before
replacement instead of importing folders that cannot be navigated.

The fallback uses root-relative navigation metadata in session storage. A duplicated tab may
initially copy it, then diverges; closing a tab ends its selection subject to browser session
restoration. Drafts and project preferences are keyed by canonical absolute folder path. Changing
the approved root retains that folder's review state when the absolute identity is unchanged; moving
the folder changes its identity. Two tabs editing the same project's drafts have no conflict
handling.

## Local data and backups

[Storage](../apps/web/src/storage.ts), [comments](../apps/web/src/comments.ts), and
[backups](../apps/web/src/backup.ts) define current formats, namespaces, and validation.
Project-keyed storage uses encoded canonical paths. Obsolete project data is deleted only from known
app keys, without preservation or migration; unrelated storage and global preferences remain. The
scoped cleanup also reclaims capacity that current saves may need; retain it while an origin may
still contain obsolete records. Formats retired during stateless project access have no readers or
imports.

During the [split host transition](split-host-architecture-proposal.md), only the explicitly
configured legacy endpoint can access these path-only project formats, recents and tab restoration.
The [project-state port](../apps/web/src/project-state.ts) keeps other configured connections in
separate tab-memory review, card/language, root and active-project stores; they cannot read or write
legacy project keys, and legacy backup controls are disabled for those owners. The current app
configures only its page-origin agent. The QA harness configures an additional agent to verify
isolation; its memory records do not survive reload. Endpoint-owned persistence and backups, legacy
conversion, and the user-facing host selector remain subsequent review steps. Global appearance,
typography and wrapping stay shared preferences.

The accepted [multi-line feedback extension](multi-line-feedback-proposal.md) adds a scoped
conversion of the immediately preceding comment store and backup formats. Validate before
converting, retain draft identity/body/timestamps and exact copied history text, and write converted
comments into a new namespace. Prefer that namespace once present so an older tab's save code cannot
overwrite it. Remove the preceding record only after confirmed persistence; failed persistence
preserves it, keeps the converted review usable in memory and reports the failure. Later writes by
an older tab are not repeatedly imported, and older tabs should reload before continuing review.
This conversion does not provide cross-tab conflict resolution or revive retired project formats.

Open **Settings → Install & local data** to export or import. Backups contain saved drafts, exact
copy history, recents, card/language preferences, wrapping, typography, and appearance. They stay on
the device and are never uploaded. Export includes projects within the current approved root,
leaving other roots' valid records in browser storage. Import requires the same root and valid
current formats, previews matching-data replacement, and writes only after the explicit import
action. Matching records and global choices are replaced; other projects and the active tab stay in
place. A failed write attempts rollback and reports when restoration may be incomplete.

Install/backup failures and export confirmations use the
[application notifications](application-notifications.md) above the open dialog. Import previews and
replacement decisions remain in the dialog.

Changing scheme, hostname, or port creates a different browser origin; review data does not sync or
move automatically. Installed iOS storage can also be separate from Safari. Use explicit backup
transfer between origins instead of assuming installation preserves drafts. Navigation history and
tab-memory payload caches are outside the backup.

## Installation and offline behavior

Open the HTTPS frontend, then use the browser install action or **Settings → Install & local data**.
The dialog offers a captured install prompt when available, browser-menu guidance otherwise, and
recognizes an already installed window. iPhone guidance uses **Share → Add to Home Screen** and
**Open as Web App**. Exact host services, origin, ports, and operating commands belong in the
[root README](../README.md#install-on-a-phone).

The manifest's identity, launch URL and scope use the configured deployment path. Local development
keeps `/`; static builds also support project subpaths. Query routes and known navigation history
stay under that path. [The worker](../apps/web/src/sw.ts) registers there without requesting broader
scope, caches only that deployment's content-versioned offline fallback, and removes only obsolete
fallback caches it owns. The root deployment also retires its preceding root-only cache. Workers for
other paths and unrelated caches are retained.

App-entry navigation uses the network without HTTP-cache fallback. API responses, raw media, diffs,
comments, and the live app shell remain outside worker caches. An unreachable app site shows **App
unavailable** with a retry link to its deployment path, without presenting stale review contents.
Worker updates claim open tabs without forcing a reload or touching saved review data. There is no
offline project copy or background sync. Same-origin subpath deployments still share browser-local
review data and preferences; separate installation/cache scope does not create a separate storage
origin.

Build commands, static policy, hosting configuration and delivery limits belong in the
[root README](../README.md#build-the-static-frontend). The current same-origin app still supplies
live reads during the split-host transition; direct agent configuration follows in later steps.
Private Tailscale Serve supplies the current app's secure access, and microphone/programmatic
clipboard use require a secure context.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies independent-tab, PWA/backup, and restart checks. The
static-web packaging pass verified root/subpath artifacts outside the checkout, actual worker
upgrades, preserved drafts and exact copy history, cache isolation and offline retry on Chrome.
Inspected its fallback at [phone](../qa/screenshots/static-web-offline/mobile.png),
[tablet portrait](../qa/screenshots/static-web-offline/tablet-portrait.png),
[tablet landscape](../qa/screenshots/static-web-offline/tablet-landscape.png), and
[desktop](../qa/screenshots/static-web-offline/desktop.png). Public-host header handling and
physical device installation remain unverified.

[Installed-app guidance](../qa/screenshots/tab-pwa-install-data/mobile.png),
[private HTTPS](../qa/screenshots/https-port-8443-review/mobile.png), and
[current local-data dialog evidence](stateless-project-access-plan.md#evidence-and-limits) are
inspected historical four-size milestones. The maintainer confirmed phone installation on
2026-09-28; its specific OS/browser and installed-app data transfer were not separately recorded.
Chrome emulation checks manifests, offline fallback, storage, and backup behavior, but does not
establish Android/iOS installation, recovery, clipboard permissions, or device gestures.
