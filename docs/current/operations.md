# Operation and deployment

Run repository commands from the root. [package.json](../../package.json) owns the scripts; agent
`--help` and [configuration](../../apps/agent/src/config.ts) own accepted options. Bun and Git are
required; Search also needs ripgrep (`rg`).

## Local combined app

```sh
bun install
bun run dev --root /path/to/projects --port 3000
```

`dev` builds local client assets and starts the combined server. `bun run build` builds local assets
and both independent artifacts; `bun run start` serves already built local assets. After frontend
edits, rebuild assets or restart `dev`; there is no automatic watch/reload. Restart the relevant
server after backend edits.

The default approved root is the current directory and the default bind address is loopback. To
expose HTTP on this host's Tailscale IPv4 address, set `GIT_REVIEW_HOST=100.x.y.z`. This supports
basic reading; secure-context browser features need localhost or HTTPS. Prefer loopback behind
private HTTPS for normal remote use. Limit the approved root to intended projects.

## Independent agent and private HTTPS

```sh
bun run build:agent
bun run start:agent --root /path/to/projects --port 39879
```

Alternatively copy the entire generated `dist/agent/` to a code host and run
`bun /path/to/agent/agent.js --help`. The artifact contains the runtime, cloud launcher, installer,
operator README, and notices. It needs Bun/Git and optional tools on that host, but no frontend,
source checkout, or package installation.

For the hosted frontend, configure the agent's public HTTPS origin, permitted frontend origin, and
optional client link before starting:

```sh
GIT_REVIEW_PUBLIC_ORIGIN=https://your-host.your-tailnet.ts.net:8443 \
GIT_REVIEW_ALLOWED_ORIGINS='["https://chimeces.com"]' \
GIT_REVIEW_CLIENT_URL=https://chimeces.com/git-review/ \
bun /path/to/agent/agent.js --root /path/to/projects --port 39879
tailscale serve --https=8443 --bg 39879
```

Keep the agent process running in its terminal or an appropriate service manager; configure Serve
from another terminal. Use **Serve** to retain private tailnet access. The macOS app's CLI is also
available at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. Tailnet HTTPS/Serve may require
owner enablement. HTTPS certificates disclose the machine DNS name in public certificate logs. Port
8443 leaves the domain's default HTTPS root free.

The public origin is the agent's exact HTTPS scheme/host/port, without a trailing slash. The
allowed-origin JSON list contains exact frontend origins, without paths; a client deployed under
`/git-review/` still uses `https://chimeces.com`. The client URL includes its deployment path and
ends in `/`. A client link requires both a public agent origin and permission for its frontend
origin. Local HTTP loopback frontend origins are accepted for development; remote origins require
HTTPS.

Open the printed client link, or paste the private agent address in **Hosts & saved reviews**, then
**Check host** and **Add host**. A connection link prefills the form and still requires explicit
acceptance. The device needs its own tailnet access and network reachability. CORS is not
authentication: clients that can reach the agent directly can read accessible files.

To serve the combined app through the same private proxy, use `bun run dev` with the public-origin
setting and the chosen loopback port. A same-origin client needs no extra frontend-origin entry.

## Static frontend hosting

```sh
bun run build:web --base-path /git-review/
```

The default base path is `/`. Publish the **contents of `dist/web/`** at the configured path. It
includes versioned assets, manifest/icons, service worker, offline fallback, 404 page, header rules,
and dependency notices; no API server or Bun runtime is needed for serving it. Failed builds
preserve the previous output.

The packaged meta-CSP restricts page resources while allowing HTTPS agents and the optional Google
font services. `_headers` supplies additional framing, MIME/referrer, and cache policy on compatible
hosts. GitHub Pages controls its own HTTP headers. Serve unknown paths as 404; query-string deep
links need only the index page. Base path governs assets, navigation, installation, and worker
scope.

The public client is [chimeces.com/git-review](https://chimeces.com/git-review/); the
[GitHub Pages address](https://joakin.github.io/git-review/) redirects there and retains query
links. Agents allow `https://chimeces.com` as the frontend origin. The manually dispatched
[Pages workflow](../../.github/workflows/deploy-web.yml) builds at the configured Pages path and
publishes a committed default-branch revision. Repository Pages settings use GitHub Actions with
HTTPS enforced. Publishing is a separate external action and needs task authorization.

## Installation and data transfer

Open the HTTPS frontend on the device. Android supports the browser's install action or **Settings →
Install & local data**. On iPhone, use **Share → Add to Home Screen** and **Open as Web App**. A
live review still needs the agent and private network; an unreachable frontend shows an unavailable
fallback.

Storage belongs to the frontend's scheme/hostname/port. HTTP→HTTPS or a new domain uses different
storage; an iPhone installed window may also differ from Safari. Before moving, export through
**Settings → Install & local data**, keep the old address available, then import and preview
replacement at the destination. If the old page asks for host assignment, **Export assigned backup**
transfers data without saving a conversion. Supported path-only backups require explicit host
assignment; current backups retain associations. Reload older tabs afterward.

Backups stay on the device. Saved feedback remains recoverable without an agent; normal checked copy
requires fresh source. See [web data behavior](../../apps/web/README.md#local-data) for publication,
replacement, storage failure, and supported-format semantics.

## Optional host tools

`GIT_REVIEW_RG_PATH` can select an absolute ripgrep executable. Dictation needs FFmpeg, Handy's
headless file CLI, and an installed model. Standard macOS/Homebrew locations are checked, along with
absolute PATH entries for FFmpeg. Absolute `GIT_REVIEW_FFMPEG_PATH` and `GIT_REVIEW_HANDY_PATH`
overrides select tools; invalid explicit overrides fail instead of falling back. Cloud voice
requires compatible tools/model installed on that host. Missing voice tools do not prevent startup
or typed comments; startup output does not certify inference readiness.

## Experimental cloud bootstrap

Use only a provider that supports private inbound HTTPS to the task and keeps its checkout/process
alive for the required review period. Codex Cloud is not a supported target. A published frontend
cannot extend the agent workspace's uptime.

On Debian/Ubuntu-compatible Linux, install `ca-certificates`, `curl`, `unzip`, `tar`, `coreutils`,
Git, and ripgrep through the provider, then install bundled tool pins into a writable absolute
directory:

```sh
GIT_REVIEW_TOOL_DIR=/path/to/tools bash /path/to/agent/install-linux.sh
export PATH="/path/to/tools/bin:$PATH"
```

This does not enroll a node or start a system service. Configure `GIT_REVIEW_CLIENT_URL` to the
static HTTPS deployment, and supply `TS_AUTHKEY` through a private direct environment-variable
facility. It must be a raw, preauthorized ephemeral Tailscale enrollment key, not a proxy
placeholder. A reusable key permits separate task VMs. Enable tailnet HTTPS/Serve and intended
device access first. Keep keys and enrolled state out of reusable images.

Start inside each instantiated task after its checkout is ready:

```sh
bun /path/to/agent/cloud.js --root /path/to/task-checkout --port 3000
```

The foreground supervisor owns a separate node, prints its actual HTTPS address and client link, and
cleans up on orderly termination. Keep it running through the provider's task-service mechanism.
Fresh launches use unique identities; provider destruction or abrupt kill prevents local cleanup,
and old feedback stays associated with its original endpoint/path. Other options belong to
`bun /path/to/agent/cloud.js --help`.

The manual [Linux artifact workflow](../../.github/workflows/cloud-artifacts.yml) verifies and
packages the runtime. It does not establish private VPN routing, physical-device access, or provider
lifetime; use the [testing guide](testing.md#deployment-checks) to verify a deployment.
