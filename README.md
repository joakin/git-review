# git-review

A local, browser-based code review app. Choose a host folder within an approved root to review
working-copy changes, browse and search files, or inspect branches and commits without changing the
repository. Add comments to a line or selected range of code, optionally dictate them, then check
their source and copy a review summary. Responsive views and direct URLs support phones, tablets,
desktop, and an installed window.

Drafts and preferences stay in the browser; Git and file contents are read from the host. The
[documentation map](docs/README.md) links current behavior, constraints, and engineering records.

## Project status

The [initial implementation](docs/initial-implementation-plan.md#stage-closure--2026-09-30), first
[maintenance pass](docs/maintenance-plan.md), and
[simplification pass](docs/simplification-review.md) are complete and closed. The
[remaining roadmap](docs/initial-implementation-plan.md#remaining-roadmap) is an optional product
backlog. Further changes follow the review and commit-approval rules in [AGENTS.md](AGENTS.md).

Source lives in three Bun workspaces: `apps/web` owns the frontend and Preact, `apps/agent` owns
host access and Shiki, and `packages/shared` owns runtime-neutral contracts and parsers. The root
owns the toolchain, lockfile, QA, and current same-origin build/server composition. Run the commands
below from the repository root. Independent static web and agent artifacts are later steps in the
[split host plan](docs/split-host-architecture-proposal.md).

## Run the app

Requires Bun and Git. Search also needs ripgrep (`rg`) on the host; set `GIT_REVIEW_RG_PATH` to an
absolute executable path if automatic discovery fails. Google Chrome is needed for optional browser
QA.

```sh
bun install
bun run dev --root /path/to/projects
```

Open the URL printed by the server from this Mac. To reach it through Tailscale, bind to this Mac's
Tailscale IPv4 address:

```sh
GIT_REVIEW_HOST=100.x.y.z bun run dev --root /path/to/projects --port 39878
```

Use the Mac's Tailscale hostname with that port on another connected device, for example
`http://your-mac.your-tailnet.ts.net:39878/`. The default bind address is `127.0.0.1`; `--root`
defaults to the current working directory and `--port` to `3000`. After client edits, restart
`bun run dev` or run `bun run build` while the server is running.

Clipboard writes and microphone capture need HTTPS or localhost on most browsers. The HTTP Tailscale
page keeps a selectable feedback text box when Copy is unavailable; copied drafts are cleared only
after a successful Clipboard API write. Voice comments additionally require FFmpeg, Handy, and a
downloaded Handy model on the host. The server checks standard Homebrew FFmpeg locations and the
installed Handy app; set `GIT_REVIEW_FFMPEG_PATH` or `GIT_REVIEW_HANDY_PATH` to an absolute
executable path if automatic discovery fails. Voice remains optional; typed comments work without
these tools.

## Install on a phone

An installable web app needs a private HTTPS address. Start a loopback backend with its exact public
origin, then proxy it through Tailscale Serve:

```sh
GIT_REVIEW_PUBLIC_ORIGIN=https://your-mac.your-tailnet.ts.net:8443 bun run dev --root /path/to/projects --port 39879
tailscale serve --https=8443 --bg 39879
```

The macOS Tailscale app includes a CLI in `/Applications/Tailscale.app/Contents/MacOS/Tailscale` if
`tailscale` is not on `PATH`. The first Serve command may ask the tailnet owner to enable Serve and
HTTPS. Tailscale's HTTPS certificate publishes the machine DNS name in Certificate Transparency. Use
**Serve**, not Funnel, to keep access limited to the tailnet. Port 8443 leaves the machine domain's
default HTTPS root free for another app. Keep the old HTTP address available until any local drafts
have been exported.

Open the HTTPS address on a connected phone. On Android, use **Install app** in the browser menu or
**Settings → Install & local data** in the app. On iPhone, use **Share → Add to Home Screen** and
enable **Open as Web App**. The installed app needs the host and Tailscale connection to read live
Git data; offline navigation shows a host-unavailable page.

Browser storage is separate between HTTP and HTTPS, and an iPhone Home Screen app may also have
separate storage from Safari. In the old address, open **Settings → Install & local data → Export
local review data**, then import the downloaded JSON file in the new address or installed app. The
file stays on the device. Import previews the record counts and requires an explicit replace action;
matching project records are replaced while other projects are kept.

## Build the static frontend

From the repository root:

```sh
bun run build:web
bun run build:web --base-path /git-review/
```

The default deployment path is `/`. Use the second form for a project site such as
`https://example.github.io/git-review/`. Paths contain plain URL segments and normalize to a
trailing slash. The workspace command `bun run build` from `apps/web` builds the same artifact.

Publish the **contents of `dist/web/`** at that path. The directory includes HTML, content-versioned
scripts/styles, icons, manifest, worker, offline fallback and a 404 page; it needs no checkout, Bun,
or application server to serve those files. Validation, bundling and asset-preparation failures
leave the previous output available; completed builds replace the generated directory. Navigation
and installation use the configured path. The
[installation record](docs/independent-tabs-and-pwa-proposal.md#installation-and-offline-behavior)
owns worker caching and browser-data behavior.

The generated HTML carries an early meta-CSP. It restricts scripts and assets, permits the existing
Google font services, and permits HTTPS agent requests/images/media for the upcoming transport
slice. The offline page permits only its hashed inline style. Meta-CSP cannot enforce
[framing restrictions](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
The generated `_headers` file adds framing protection, MIME/referrer policy, revalidation for
HTML/manifest/worker/fallback/icons, and immutable caching for versioned assets on
[Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/headers/) or a compatible
header-file host. GitHub Pages can use the packaged meta policy and `.nojekyll`; its HTTP delivery
policy remains platform-controlled. Serve unknown paths as 404 rather than rewriting them to the
app: query deep links need only the index page. The included 404 disables Cloudflare Pages'
[automatic SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/).

This is the packaging step of the [split host plan](docs/split-host-architecture-proposal.md). The
frontend still uses the current same-origin API until the explicit agent-transport step lands.
Continue using the normal `dev`, `build`, and `start` commands for live review in the meantime. No
public deployment has been performed.

## Checks

The experimental [split-host feasibility probe](docs/qa-workflow.md#split-host-feasibility-probe)
tests a static page against a separate read-only agent using a disposable Git/media fixture. It is
separate from the normal app and needs no client build. `bun run qa:probe --build-only` produces
`dist/feasibility/` for static hosting and `dist/feasibility-cloud.tar.gz` for cloud setup without a
commit. The QA guide owns local commands, cloud/Tailscale setup, and the limits of simulation.

`bun install` installs the pinned tools and activates the pre-commit hook. Run `bun run format`
after edits and `bun run format:check` to check without writing. The
[formatting workflow](docs/formatting-workflow.md) owns staged-file behavior and setup.

```sh
bun run typecheck
bun run test
bun run qa:check
bun run qa:capture --url http://127.0.0.1:3000/ --label <milestone>
```

Run focused browser checks directly with Bun, for example
`bun qa/check-files.ts http://127.0.0.1:3000/`. The scripts use the installed Chrome and an isolated
fixture server. See [the QA workflow](docs/qa-workflow.md) for fixture setup, scenario arguments,
screenshots, and device checks. The
[stateless project contract](docs/stateless-project-access-plan.md) owns project identity and
restart behavior; [read boundaries](docs/README.md#behavior-records) link the domain policies.
