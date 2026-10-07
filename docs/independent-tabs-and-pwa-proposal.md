# Independent tabs, installation, and local data

Each tab has its own active-project fallback, while recents and saved review data belong to the
browser origin. The app can run in an installed window, but live project reads still require the
host. [Navigation](navigation-and-url-history-slice-proposal.md) owns destinations;
[stateless access](stateless-project-access-plan.md) owns canonical project identity and restart
behavior.

## Independent tabs

An explicit URL takes precedence over tab storage. Bare `/` restores a valid active folder for that
tab or opens the picker. Selecting a folder updates only that tab's fallback selection, while
recents remain shared. A failed selection does not replace the last accepted fallback or saved
review work. Missing/malformed tab data or a different approved root cannot silently select another
folder.

Saved folder paths share the [navigation-path rules](../src/client/navigation-path.ts), including
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

[Storage](../src/client/storage.ts), [comments](../src/client/comments.ts), and
[backups](../src/client/backup.ts) define current formats and validation. Current workspace and
comment records are version 4, active-project records are version 2, and backups accept only
version 6. Project-keyed storage namespaces use encoded canonical paths. Obsolete project data is
deleted only from known app keys, without preservation or migration; unrelated storage and global
preferences remain. No earlier-format readers or legacy backup imports are supported.

Open **Settings → Install & local data** to export or import. Backups contain saved drafts, exact
copy history, recents, card/language preferences, wrapping, typography, and appearance. They stay on
the device and are never uploaded. Export includes projects within the current approved root,
leaving other roots' valid records in browser storage. Import requires the same root and valid
current formats, previews matching-data replacement, and writes only after the explicit import
action. Matching records and global choices are replaced; other projects and the active tab stay in
place. A failed write attempts rollback and reports when restoration may be incomplete.

Changing scheme, hostname, or port creates a different browser origin; review data does not sync or
move automatically. Installed iOS storage can also be separate from Safari. Use explicit backup
transfer between origins instead of assuming installation preserves drafts. Navigation history and
tab-memory payload caches are outside the backup.

## Installation and offline behavior

Open the private HTTPS origin, then use the browser install action or **Settings → Install & local
data**. The dialog offers a captured install prompt when available, browser-menu guidance otherwise,
and recognizes an already installed window. iPhone guidance uses **Share → Add to Home Screen** and
**Open as Web App**. Exact host services, origin, ports, and operating commands belong in the
[root README](../README.md#install-on-a-phone).

The manifest launches at `/` in standalone mode. [The service worker](../src/client/sw.ts) caches
only the host-unavailable fallback, uses the network for navigation, and removes obsolete app
caches. It does not cache API responses, raw media, diffs, or comments. An unreachable host
therefore shows an offline message instead of stale review contents; there is no offline project
copy or background sync. Private Tailscale Serve and same-origin checks supply secure access;
microphone and programmatic clipboard use need that secure context.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies independent-tab, PWA/backup, and restart checks.
[Installed-app guidance](../qa/screenshots/tab-pwa-install-data/mobile.png),
[private HTTPS](../qa/screenshots/https-port-8443-review/mobile.png), and
[current local-data dialog evidence](stateless-project-access-plan.md#evidence-and-limits) are
inspected historical four-size milestones. The maintainer confirmed phone installation on
2026-09-28; its specific OS/browser and installed-app data transfer were not separately recorded.
Chrome emulation checks manifests, offline fallback, storage, and backup behavior, but does not
establish Android/iOS installation, recovery, clipboard permissions, or device gestures.
