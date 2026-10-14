# Independent tabs, installation, and local data

Each tab has its own active-project fallback, while recents and saved review data belong to the
browser origin. The app can run in an installed window, but live project reads still require the
host. [Navigation](navigation-and-url-history-slice-proposal.md) owns destinations;
[stateless access](stateless-project-access-plan.md) owns canonical project identity and restart
behavior.

## Independent tabs

An explicit URL takes precedence over tab storage. The bare deployment URL restores that tab's
validated agent/project reference or opens the picker. Canonical restoration can proceed without
root information; known root metadata is retained for the picker only when it agrees with the
resolved project. A failed selection or stale root cannot substitute another folder. The
[tab-state boundary](../apps/web/src/agent-tab-state.ts) owns validation and storage.

A duplicated tab may initially copy its selection, then diverges. Closing a tab ends that selection
subject to browser session restoration. Recents are shared per endpoint/root. Concurrent edits to
the same review still have no conflict resolution.

## Local data and backups

[Formats/parsers](../apps/web/src/agent-data-format.ts),
[the repository](../apps/web/src/agent-data.ts) and
[the browser owner](../apps/web/src/browser-data.ts) own current namespaces and persistence.
[Comments](../apps/web/src/comments.ts) own draft, anchor, quote and exact copied-history formats.
Persistent records use the
[project identity](stateless-project-access-plan.md#project-contract-and-validation). Appearance,
typography and wrapping remain global; project preferences and root recents are endpoint scoped. The
bootstrap accepts its page-origin agent and explicitly imported connection records; the
host-management UI remains a
[later slice](split-host-architecture-proposal.md#11-add-connection-management-and-saved-project-navigation).

The saved-project index is independent of recents. Reads reconcile missing or stale entries from
valid review metadata without contacting an agent or remembering its connection. Recovery metadata
grants no filesystem access. Metadata and preference writes preserve current stored feedback.
Ordinary saves write the review before its index entry. An indexing failure remains recoverable;
failed saves keep edits in this tab and report their owning project. Global export includes current
stored records and this tab's unsaved edits, without replacing other tabs' stored work with stale
read caches. Invalid active records stop export and retain the source.

Open **Settings → Install & local data** for global export/import, even when agent or root requests
fail. Export includes unavailable/removed hosts and old roots. New backups preserve endpoint
associations; supported path-only backups require an explicit host assignment. The preview shows
hosts, paths, incoming feedback and matching-data replacement. Matching reviews/preferences and
global choices are replaced; unrelated records and the current destination remain. Metadata-only
imports can update a saved project without discarding its feedback. Files stay on the device.

Bulk import stages and verifies a complete new generation before publishing one catalog. Failures
before publication leave prior data active. Cleanup follows publication; cleanup failure does not
undo success. If publication verification and restoration both fail, report uncertainty and retain
both generations. Staging needs temporary capacity for both copies. Reload other open tabs after
importing.

### Legacy conversion

When supported path-only project data exists, startup asks the user to assign its intended agent and
preview replacement before conversion. The [legacy boundary](../apps/web/src/legacy-data.ts) reads
supported records without upgrade writes or cleanup, preserving draft identity, timestamps,
anchors/quotes and exact history. It validates supported older backups against their recorded scope,
independently of a live agent.

Conversion publishes its completion marker with the verified data. A changed source or an already
completed conversion in another tab invalidates a stale preview. Original source keys are retained;
later saves from old tabs are never repeatedly imported. Reload older tabs before continuing. The
setup screen can export an assigned backup without saving the conversion, keeping old-origin
transfer available before frontend cutover. Unsupported retired formats are not revived.

Unreadable storage shows Retry or an explicit temporary-review option. Temporary mode leaves
existing records untouched and exports only this tab's work; import requires persistent storage. A
corrupt individual review is never replaced by an empty fallback. Storage failures do not make
temporary edits durable.

Installation at a different scheme/hostname/port uses a different browser origin. Installed iOS
storage can also differ from Safari. Transfer a backup before changing origin; tab selection,
navigation history and payload caches are outside it.
[Saved feedback recovery](feedback-slice-proposal.md#saved-feedback-recovery) owns viewing and
copying without a live project. Its project export uses the current backup format and retains the
selected review's endpoint, metadata, preferences, drafts and exact history without including other
projects or root recents. Global export remains available in Settings.

Install/backup failures and export confirmations use
[application notifications](application-notifications.md) in the dialog. Startup assignment errors
stay beside their form controls.

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

The [QA catalog](qa-workflow.md#endpoint-owned-data-foundation) owns runnable storage/cutover
checks. Chrome/macOS verifies conversion, backup transfer and failure recovery. Current four-size
[conversion](../qa/screenshots/agent-data-conversion/manifest.json) and
[import](../qa/screenshots/agent-data-import/manifest.json) captures cover the previews.
Physical-device storage and installed-app transfer remain unverified.

The static-web packaging pass verified root/subpath artifacts outside the checkout, actual worker
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
