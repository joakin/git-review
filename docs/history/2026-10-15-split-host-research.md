# Split-host research and deployment evidence

Historical findings through 2026-10-15. These are dated observations, not current instructions or
fresh verification. Current architecture and operation live in
[the current guides](../current/architecture.md); the remaining verification boundary is in
[the cloud draft](../drafts/2026-10-16-cloud-verification.md).

## Accepted architecture

The 2026-10-13 design selected a stable static HTTPS frontend connecting directly to private
read-only agents through the device's native Tailscale connection. Manual agent URLs and printed
client links provide bootstrap. This avoids an always-on application hub while requiring
endpoint-owned browser state, explicit CORS, and direct browser-to-agent networking. A frontend
cannot retain access to a workspace the provider destroys.

A hub, discovery, cross-device sync, automatic draft transfer, offline repository caching, and
no-internet app-shell startup were excluded from that release. Typed feedback was the baseline;
cloud voice needs configured compatible tools.

## Delivery and cloud investigation

The first [Pages deployment](https://github.com/joakin/git-review/actions/runs/38743233608) passed
on 2026-10-15. Checks recorded HTTPS delivery, alternate-domain redirect with query links,
manifest/worker MIME types, and a browser connection from the public client to a private agent.
Four-size entry-screen captures are retained in the
[deployment manifest](../../qa/screenshots/github-pages/manifest.json). This did not establish
physical-device installation or network-permission behavior.

A disposable Debian/x86_64 cloud probe passed Linux agent build/package checks, controlled Tailscale
simulation, loopback API/root/protocol/CORS checks, and a provider task service surviving its
launching parent. It did not enroll a real node: direct launcher inputs were absent and the proxy
denied download/control destinations. A subsequent managed-VPN task failed provisioning before
exposing a shell; no private HTTPS endpoint was started there.

The Codex Cloud investigation closed without a supported inbound deployment. The separately owned
userspace relay path remained unverified. The generic cloud launcher was retained as experimental.
Full Linux/Tailscale installation, artifact-workflow execution, actual device access, and provider
lifetime were not established. Historical setup prompts remain in Git.

## Deferred discovery findings

The native Tailscale app routes traffic and resolves known names; ordinary web pages were not given
a peer-enumeration API. An already connected agent could later use its local peer view, subject to
visibility policy, but cannot bootstrap when every known agent is unavailable.

Research considered the device-list control API with read-only inventory scope. Unauthenticated
OPTIONS probes on 2026-10-12, from an example frontend origin, received no cross-origin permission
headers for the tested inventory and token endpoints. Pasting a token therefore did not establish
browser-only inventory bootstrap. No credentials or private inventory were retrieved. These
observations are limited to the tested endpoints/origin and date.

A managed authenticated function holding an inventory credential could provide candidates without
proxying repository bytes, but adds a dynamic service and caller authentication. An existing agent
could also query inventory; neither option proves that candidate applications are running or
reachable from the phone. Tailscale node enrollment credentials are distinct from control API
credentials.

The [API credential reference](https://tailscale.com/docs/reference/trust-credentials),
[OAuth client documentation](https://tailscale.com/docs/features/oauth-clients),
[browser-node source](https://github.com/tailscale/tailscale/blob/main/cmd/tsconnect/README.md), and
[device visibility policy](https://tailscale.com/docs/concepts/device-visibility) were research
inputs. Any renewed discovery work needs fresh evidence.

## Browser and lifetime questions

The research identified HTTPS/mixed-content restrictions, public-to-private network permissions,
actual DNS/IP resolution, and installed iOS/Android behavior as deployment questions. HTTPS over a
VPN alone did not establish browser permission. Provider setup hooks, secret delivery, task-service
lifetime, checkout retention, suspend/resume, and node cleanup also needed actual testing. The
original feasibility harness remains under [`qa/feasibility/`](../../qa/feasibility/) and its
`qa:probe` scripts, for targeted experiments rather than production setup.
