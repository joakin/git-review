# Bonus slice proposal: independent project tabs and installable app

Status: implemented and served through private Tailscale HTTPS after maintainer agreement. The
maintainer confirmed installation on a phone and approved committing this slice on 2026-09-28.
Browser checks and four-size captures are ready.

## Why this slice

The former active project lived beside recent folders in one `localStorage` record, so a selection
affected what other tabs restored. The implementation moved that fallback to per-tab
`sessionStorage`; explicit URLs now take precedence through the
[navigation model](navigation-and-url-history-slice-proposal.md). The server resolves each absolute
project path independently and has no selected-project registry.

The original phone address used HTTP on port 39878. The installed app now uses private HTTPS on port
8443, leaving port 443 free for another app. The [run instructions](../README.md#install-on-a-phone)
describe that setup. Chrome's install promotion requires HTTPS and a manifest with a name, icons,
start URL, and standalone display mode.
[Chrome install criteria](https://web.dev/articles/install-criteria) Tailscale Serve supplies the
private HTTPS proxy to the loopback backend.
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

## Step 1: one active project per tab

### User flow

1. A fresh browser tab or new installed-app window opens the project picker with shared recent
   folders.
2. Selecting a folder makes it active only in that tab. Another tab can select a different folder
   without changing the first.
3. Reloading a tab restores that tab's active folder. Closing the tab ends its selection; a browser
   session restore may restore it according to browser behavior.
4. Draft comments and copy history remain saved per project in browser-local storage. Recent folders
   remain shared across tabs on the same origin.

### State and API shape

The [project/session owner](../src/client/project-session.ts) owns connection, restoration, and
accepted-selection persistence. URL changes stay with App, and the storage module owns current
formats and the deliberate old-project-data reset.

- `localStorage`: workspace v4 stores `{ rootPath, recentPaths }` using root-relative navigation
  paths. Comments v4, open cards and language overrides use new namespaces keyed by URI-encoded
  canonical absolute project paths. Global wrap, appearance and typography retain their formats.
- `sessionStorage`: active-project v2 stores `{ version: 2, rootPath, activePath }` for this tab;
  `activePath` is root-relative navigation metadata. Validate it against the current root.
- `GET /api/project?projectPath=…` resolves selection metadata. All resource requests independently
  validate the canonical path; a server restart needs no new lookup.
- Obsolete project/session/recents/comments/history/cards/languages are discarded without migration.
  Backup export/import accepts only v6. Dated compatibility evidence below describes earlier
  releases and is superseded by the [stateless cutover](stateless-project-access-plan.md). A
  duplicated tab may initially copy its source tab's session storage, then the copies diverge.
  [HTML session storage behavior](https://html.spec.whatwg.org/multipage/webstorage.html)

### Edge cases and checks

- Missing or malformed session data yields the picker. A changed approved root invalidates the
  stored selection. An explicit project URL still takes precedence and gets its own recoverable
  error if opening fails.
- A failed project open does not replace the last successful session selection, recent folders, or
  drafts. The explicit failed route remains visible with a Choose another project action.
- Two tabs reviewing the _same_ project can still edit the same project-keyed draft store; cross-tab
  edit conflict handling is a separate future issue. This slice verifies tabs on different projects
  do not switch each other or mix drafts.
- Browser QA: select A in tab 1 and B in tab 2; reload both; check independent restoration and
  shared recents. Include a fresh tab and a duplicated tab.

## Step 2: installable phone app

### User flow

1. Open the app at a tailnet-only `https://…ts.net/` URL. Android Chrome offers **Install app**; the
   installed icon opens a standalone window. On iPhone, **Add to Home Screen** opens a standalone
   web app when the manifest declares `display: standalone`.
   [Chrome install criteria](https://web.dev/articles/install-criteria),
   [WebKit Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
2. The installed app starts at `/`, shows recent folders, and requires the host and Tailscale
   connection for live Git data. If unreachable, show a plain offline/host-unavailable page rather
   than an old cached diff.
3. Open **Settings → Install & local data** for the browser install prompt when available or short
   platform instructions otherwise. The global menu keeps this control out of the code viewport.

### Assets, server, and hosting

- Add a root-scoped web manifest with stable `id`, `name`, `short_name`, `start_url: "/"`,
  `scope: "/"`, `display: "standalone"`, theme/background colors, and 192px/512px regular and
  maskable icons. Add an Apple touch icon. Derive the icon from the existing brand mark with
  repo-native SVG/PNG assets, without a new runtime library.
  [Web App Manifest](https://www.w3.org/TR/appmanifest/)
- Add a small TypeScript service worker built with Bun. Cache only the offline fallback, use the
  network for navigations when available, and never cache `/api/` responses, project diffs, or
  comments. Give caches a build version and discard old ones on activation. This supports a useful
  offline message and browser install flows without pretending that code review works offline.
  Chrome no longer requires a fetch-handling service worker for menu installation, but
  install-prompt behavior has varied; verify on an Android device.
  [Chrome install criteria update](https://developer.chrome.com/blog/update-install-criteria)
- Serve manifest, icons, service worker, and offline page with correct MIME types and cache headers.
  Update the restrictive CSP only for resources actually needed. Check that Project metadata GET
  passes the same-origin check behind HTTPS termination; trust only the configured local
  proxy/public origin, not arbitrary forwarded headers.
- Configure **Tailscale Serve**, not Funnel, to expose the Bun app only inside the tailnet over
  HTTPS. Serve proxies to loopback, so the host must provide a loopback listener. Keep the existing
  HTTP address available during the transition for data export, then decide whether to retire it.
  The Tailscale CLI is not currently on `PATH`; HTTPS may need enabling in the tailnet. Tailscale
  documents that HTTPS certificates publish the machine's DNS name in Certificate Transparency, so
  that setting should be reviewed before enabling it.
  [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve),
  [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)

### Browser data when moving to HTTPS or installing on iOS

Browser storage belongs to an origin, so the existing HTTP drafts and recents will not appear
automatically at the HTTPS address. WebKit also says that when an iOS Home Screen app is installed,
non-cookie local storage is not copied from Safari into that app.
[WebKit storage behavior](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)

Provide a small, explicit **Export local review data / Import local review data** flow for this
transition. The browser creates/reads a versioned JSON file containing known app state (drafts, copy
history, recents, and preferences); it never uploads the backup to the host. Parse every field with
limits before import, and do not overwrite existing non-empty drafts silently. This also gives the
maintainer a practical backup path for browser-local work. The existing HTTP address remains usable
until this is checked on the phone.

### Verification and limits

- Browser QA checks manifest fields, icon dimensions and MIME types, service-worker
  registration/cache behavior, no cached API responses, HTTPS API calls, and standalone display
  mode. Capture phone, tablet portrait, tablet landscape, and desktop states.
- Verify **Install app** and standalone launch on real Android Chrome, and Add to Home Screen on
  real iOS Safari. Emulation cannot establish those outcomes.
- Confirm drafts survive reload within each origin and that an exported backup imports into the
  HTTPS/installed origin. The app does not promise offline Git review or background sync.

## Smallest reviewable sequence

1. Split/migrate browser workspace state and demonstrate two independent tabs with a browser QA
   check.
2. Add the manifest, icons, service worker, offline message, server routes, and backup transfer.
   Check locally over HTTPS and with browser QA.
3. Configure private Tailscale HTTPS, validate the live API and installation on the phone, capture
   screenshots, then hand the result back for review before the next product slice.

No new package was added. The finished slice was held uncommitted for maintainer review, then
approved for commit on 2026-09-28.

## Implementation and QA record (2026-09-28)

- The active folder is a versioned `sessionStorage` record scoped to the approved host root; shared
  recents moved to `localStorage` v3. The v2 shared selection migrates once into the first tab that
  opens it. Drafts and copy history remain project keyed.
- The manifest, 192/512px icons, maskable icon, Apple touch icon, network-first navigation worker,
  and host-unavailable page are served with explicit routes and MIME types. Bun must build the
  worker as a separate entrypoint: a combined build emitted an empty worker in local QA.
- The **Install & local data** control in Settings opens a dialog with the browser install prompt
  when available, platform guidance, and a local JSON backup transfer. Import validates the root,
  version, project IDs, comments, open cards, language overrides, and bounded sizes before showing
  an explicit replacement action. No backup content is sent to the host.
- The loopback backend is running as `com.joakin.git-review-https` on `127.0.0.1:39879`, with
  `GIT_REVIEW_PUBLIC_ORIGIN` restricted to `https://joaquns-macbook-pro-2.churra-boga.ts.net:8443`.
  Tailscale Serve proxies that tailnet-only port to the backend. The default HTTPS port 443 is free
  for another app. A live HTTPS project-open POST succeeded; a different Origin returned 403. The
  existing Tailscale HTTP service remains available for export.
- `bun run typecheck`, 19 behavioral tests, `qa:check`, and browser checks `qa:foundation`,
  `qa:tabs`, `qa:diff`, `qa:feedback`, and `qa:pwa` passed against the local fixture. Four-size
  [review](../qa/screenshots/tab-pwa-review/mobile.png) and
  [install/data](../qa/screenshots/tab-pwa-install-data/mobile.png) captures were inspected; no
  page-wide overflow was reported.
- After Serve was enabled, HTTPS on port 8443 returned a trusted certificate and 200 for the page,
  manifest, service worker, root API, and project-open POST. Mobile Chrome browser QA selected this
  repository and restored it after reload. A live browser check confirmed a secure context, an
  active controlling worker after reload, and a standalone manifest.
  [Live HTTPS captures](../qa/screenshots/https-port-8443-review/mobile.png) were inspected at
  phone, tablet portrait, tablet landscape, and desktop widths without page-wide overflow.
- The maintainer confirmed that the HTTPS app installed on their phone without issues. The phone
  OS/browser and installed-app storage transfer were not separately checked in this handoff.

## U03 backup compatibility — 2026-10-04

The
[file-feedback follow-up](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files),
accepted and committed as `7632b4d`, introduced backup version 4 for mixed diff/file anchors.
Comment stores use version 2, retaining the original project-keyed storage location so valid
version-1 data migrates in place. Import still accepts backup versions 1–3 and their legacy diff
comments; v4 validates the expanded model. Root/project validation, import preview and explicit
replacement, typography/appearance choices, and rollback behavior retain their existing roles. Older
apps reject v4 as unsupported. Previously copied history text is never regenerated during migration
or import.

## Selection backup compatibility — 2026-10-04

The [selection-feedback extension](selected-code-feedback-proposal.md), accepted on 2026-10-05, uses
comment-store version 3 and exports backup version 5. It imports versions 1–4 using their original
store formats, migrating whole-line subjects without changing archived copied text. Version-5
imports validate exact fragment text, UTF-16 bounds and character boundaries. Typography,
appearance, root/project validation, replacement preview and storage rollback retain their existing
roles. Earlier app versions reject v5 as unsupported.
