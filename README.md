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
owns the toolchain, lockfile, QA, and current same-origin server composition. Run the commands below
from the repository root. `bun run build` builds the local app assets and both independent
artifacts; `bun run dev` builds only the local app before starting it. Direct frontend-to-agent
transport remains a later step in the [split host plan](docs/split-host-architecture-proposal.md).

## Run the app

Requires Bun and Git. Search also needs ripgrep (`rg`) on the host; set `GIT_REVIEW_RG_PATH` to an
absolute executable path if automatic discovery fails. Google Chrome is needed for optional browser
QA.

```sh
bun install
bun run dev --root /path/to/projects
```

Open the URL printed by the server on this host. To reach it through Tailscale, bind to this host's
Tailscale IPv4 address:

```sh
GIT_REVIEW_HOST=100.x.y.z bun run dev --root /path/to/projects --port 39878
```

Use the host's Tailscale hostname with that port on another connected device, for example
`http://your-host.your-tailnet.ts.net:39878/`. The default bind address is `127.0.0.1`; `--root`
defaults to the current working directory and `--port` to `3000`. After client edits, restart
`bun run dev` or run `bun run build` while the server is running.

Clipboard writes and microphone capture need HTTPS or localhost on most browsers. The HTTP Tailscale
page keeps a selectable feedback text box when Copy is unavailable; copied drafts are cleared only
after a successful Clipboard API write. Voice comments additionally require FFmpeg, Handy, and a
downloaded Handy model on the host. The server checks standard Homebrew FFmpeg locations and the
installed Handy app, and also checks `PATH` for FFmpeg; set `GIT_REVIEW_FFMPEG_PATH` or
`GIT_REVIEW_HANDY_PATH` to an absolute executable path if automatic discovery fails. Voice remains
optional; typed comments work without these tools.

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
Git data; offline navigation shows an app-unavailable page.

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

## Build and run the independent agent

```sh
bun run build:agent
bun run start:agent --root /path/to/projects --port 3000
```

The workspace commands `bun run build` and `bun run start --root /path/to/projects` from
`apps/agent` use the same artifact. Copy **`dist/agent/`** to the code host and run it there:

```sh
bun /path/to/agent/agent.js --root /path/to/projects --port 3000
```

The runtime serves only `/api/` routes. It needs Bun and Git on `PATH`; Search also needs ripgrep on
`PATH` or an absolute `GIT_REVIEW_RG_PATH`. It needs no frontend files, source checkout,
`node_modules`, package installation or network downloads to load syntax highlighting. The
Bun-targeted JavaScript bundle includes Shiki's
[full language bundle](https://shiki.style/guide/bundles) and inlined Oniguruma WebAssembly; the
directory includes an operator quick guide and upstream dependency notices. The bundle is about 10
MB with the current full language set. No OS-specific executable or public npm package is produced.
Packaging is verified with Bun 1.3.1 on macOS; actual Linux/provider execution remains a release
gate.

`--root`, `--port`, `GIT_REVIEW_HOST` and `GIT_REVIEW_PUBLIC_ORIGIN` share validation with the
current app. Defaults are the current working directory, port 3000 and loopback. Port 0 selects an
available port for testing. An invalid root or configuration fails before listening. Keep the cloud
agent on loopback behind private Tailscale Serve:

```sh
GIT_REVIEW_PUBLIC_ORIGIN=https://your-workspace.your-tailnet.ts.net bun /path/to/agent/agent.js --root /path/to/projects --port 3000
tailscale serve --bg 3000
```

Use the agent's exact HTTPS origin without a trailing slash. This setting allows the private
proxy-origin request check. Frontend origins are configured separately below; the static app's
endpoint-selection and transport changes remain later steps. Tailscale enrollment, unique ephemeral
hostnames, Serve, and process supervision stay outside the agent; provider setup and lifetime
verification are described in the
[feasibility workflow](docs/qa-workflow.md#private-https-in-a-cloud-workspace). The runtime does not
keep a host registry or enroll Tailscale nodes.

Voice tools are optional and checked only on transcription requests. An explicit
`GIT_REVIEW_FFMPEG_PATH` or `GIT_REVIEW_HANDY_PATH` must point to an absolute executable; invalid
overrides return an unavailable error instead of falling back. Automatic FFmpeg discovery retains
the local Homebrew locations and also checks absolute `PATH` entries. Handy retains the installed
macOS app location; cloud transcription requires an explicitly configured compatible Handy CLI and
model. Missing tools do not prevent startup or typed review. Startup output does not certify
tool/model availability; `bun /path/to/agent/agent.js --help` lists configuration.

## Agent information and frontend origins

Configure an explicit JSON list of frontend origins on the agent:

```sh
GIT_REVIEW_ALLOWED_ORIGINS='["https://your-name.github.io"]' GIT_REVIEW_PUBLIC_ORIGIN=https://your-workspace.your-tailnet.ts.net bun run start:agent --root /path/to/projects --port 3000
```

Use each site's scheme/hostname/port without a trailing slash or deployment path: a GitHub project
site under `/git-review/` still uses `https://your-name.github.io`. Origin access covers all paths
on that origin. The default list is empty. Configuration rejects malformed/duplicate/oversized
lists, wildcards, credentials, query/fragment fields and paths. Explicit `http://localhost:<port>`,
`http://127.0.0.1:<port>` or IPv6 loopback origins are permitted for local development; remote
frontend origins require HTTPS. The current same-origin app and configured private proxy continue to
work without an extra list entry.

`GET /api/info` reports the protocol/build identity and current optional capabilities. It takes no
project path. Packaged development builds include their Git base revision and dirty state; source
execution reports `development`. Transcription is unavailable without tools, unverified until a
successful validated transcript in this agent process, and verified after that success. A later
failure revokes verification. The [protocol record](docs/agent-http-protocol.md) owns handshake,
CORS, streaming and capability behavior, with exact types in shared source.

The agent permits the existing API's GET/POST and media HEAD/range requests from those origins. It
rejects invalid preflights without repository work and retains readable allowed-origin errors. It
sends no credential grant; direct browser clients use omitted credentials and anonymous native
media. Tailscale enrollment and access policy remain necessary for private network reachability. The
current frontend still uses the same-origin API until the transport step lands.

## Checks

The [agent artifact check](docs/qa-workflow.md#independent-agent-artifact) verifies packaging and
read-only API behavior from a disposable directory with no frontend or source dependencies. The
[agent HTTP check](docs/qa-workflow.md#agent-information-and-cross-origin-http) exercises the
production CORS boundary from a separate static-page origin in Chrome.

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
