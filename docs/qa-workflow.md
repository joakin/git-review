# Testing and visual QA

This guide owns runnable checks and their setup. Behavior records in the
[documentation map](README.md#behavior-records) own current contracts and selected milestone
evidence; scripts own detailed assertions. The closed implementation and maintenance stages do not
create a new acceptance gate. Further device/performance work stays in the
[optional backlog](initial-implementation-plan.md#remaining-roadmap) until requested.

## Checks for a change

- After any edit, run `bun run format` and `bun run format:check`. For documentation-only changes,
  also check local links, anchors, and referenced commands.
- For code changes, run `bun run typecheck` and `bun run qa:check`, plus tests that exercise the
  affected behavior. Add lasting tests for observable invariants and important failures, rather than
  private call order or incidental markup.
- For visible UI changes, run the relevant focused checks, capture and inspect phone, tablet
  portrait, tablet landscape, and desktop states, and report remaining device uncertainty.
- Keep completed work uncommitted until the maintainer approves it under [AGENTS.md](../AGENTS.md).

`qa:check` checks QA TypeScript, CSS tokens, and repository formatting; it does not run browser
scenarios. `bun run test` runs the unit/integration suite. Package commands are defined in
[package.json](../package.json); staged formatting and its isolated hook check are explained in the
[formatting workflow](formatting-workflow.md).

## Fixture setup and isolation

Run QA from the repository root with Bun and installed Google Chrome. Ensure the ignored artifacts
parent exists with `mkdir -p qa/.artifacts` before preparing individual fixtures. Browser checks
target an isolated fixture server; never use the maintainer's working repository as a mutation
fixture. Choose unused ports and stop only QA processes you started. The app's run/HTTPS setup
belongs in the [root README](../README.md#run-the-app).

| Fixture             | Preparation                              | Used by                                                                                   |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Inventory           | `bun qa/prepare-inventory-fixture.ts`    | Most working-copy, navigation, feedback, and settings checks                              |
| Git history         | `bun qa/prepare-git-fixture.ts`          | Git and loading checks; object IDs are saved in `qa/.artifacts/history-fixture-info.json` |
| Line counts         | `bun qa/prepare-change-stats-fixture.ts` | Changes statistics                                                                        |
| Diff context        | `bun qa/prepare-diff-context-fixture.ts` | Directional Changes context expansion                                                     |
| Multi-line feedback | `bun qa/prepare-multi-line-fixture.ts`   | Files/Search and Old/New/mixed diff ranges                                                |
| Images              | `bun qa/prepare-media-fixture.ts`        | Image/SVG previews                                                                        |
| Audio/video         | `bun qa/prepare-media-av-fixture.ts`     | Playback/ranges; preparation requires FFmpeg with H.264 encoding                          |

Preparation scripts create their named directories under ignored `qa/.artifacts/` and refuse to
overwrite existing fixtures. Reuse a fixture only while it matches its preparation script; remove
and recreate only an owned QA fixture when it needs resetting. Some checks temporarily edit fixture
files and restore them in `finally`; run these sequentially on a shared fixture server.

For the common inventory/history checks, prepare both fixtures and an empty second project:

```sh
bun qa/prepare-inventory-fixture.ts
bun qa/prepare-git-fixture.ts
mkdir -p qa/.artifacts/other-project
bun run dev --root "$PWD/qa/.artifacts" --port 39911
```

`<URL>` in the catalog below means this server's printed HTTP(S) address, for example
`http://127.0.0.1:39911/`. The second folder supports cross-project navigation; tab and transaction
checks also create it when absent. Line-action and live-change checks create and remove their own
Git fixtures beneath this approved root. Stateless-project and formatting-hook checks own their
entire temporary setup and need no manually started fixture server.

Project-entry and file-feedback checks additionally need a separate approved root **outside any Git
worktree**, with a non-Git `plain-folder/readme.txt` and a clean Git `clean-git/readme.txt`. One way
to prepare it is:

```sh
qa_plain_root="$(mktemp -d "${TMPDIR:-/tmp}/git-review-qa-plain.XXXXXX")"
mkdir "$qa_plain_root/plain-folder" "$qa_plain_root/clean-git"
printf 'QA readme\n' > "$qa_plain_root/plain-folder/readme.txt"
printf 'QA readme\n' > "$qa_plain_root/clean-git/readme.txt"
git -C "$qa_plain_root/clean-git" init -q
git -C "$qa_plain_root/clean-git" add readme.txt
git -C "$qa_plain_root/clean-git" -c user.name=QA -c user.email=qa@example.invalid commit -qm baseline
bun run dev --root "$qa_plain_root" --port 39912
```

Use the second server's address as `<PLAIN_URL>`. Keep the temporary root path for cleanup after
stopping that QA server; an old machine-specific artifact file is not a setup prerequisite. Client
assets under `dist/` are shared by servers: build the current client before browser QA, rebuild
after frontend edits, and restart the relevant backend after backend edits. Keep the maintainer's
review service available.

## Focused checks

### Split-host feasibility probe

Step 1 of the
[split-host plan](split-host-architecture-proposal.md#1-prove-the-target-cloud-and-browser-path)
uses disposable code/media and an experimental CORS wrapper around the existing read-only API. It
does not change production origin policy, app storage, or project identity. The harness only exposes
the route families required by this experiment. Its source, configuration validation, and checks
live in [the agent](../qa/feasibility-agent.ts), [HTTP boundary/tests](../qa/feasibility-http.ts),
[browser probe](../qa/feasibility/browser.ts), and
[fixture creator](../qa/prepare-feasibility-fixture.ts).

The static probe checks root/project lookup, a Git inventory and small source read, a JSON POST
checking one freshly read anchor, a rejected traversal with readable error headers, native image
loading, and audio/video HEAD/range/metadata/seek behavior. Play media additionally exercises
user-triggered playback requests; an accepted request does not prove audible output. Reports record
the frontend/agent origins, browser, project, secure-context state, UTC observations, and agent
start/sample times. The start time is a restart diagnostic, not a project identity. Data stays in
page memory until downloaded, and includes paths/device details. Download before reloading.

#### Local simulation

Requirements are the normal installed Bun/Git/dependencies and Chrome for optional captures. The
fixture includes a generated WAV, SVG, and a tiny generated H.264 MP4; FFmpeg is not needed to
prepare or serve it. `qa/feasibility/clip.mp4` was created with FFmpeg's solid-color source, four
seconds at 320 × 180, H.264/yuv420p, GOP 12 and faststart. No user media is included.

From the repository root:

```sh
mkdir -p qa/.artifacts
bun run qa:probe:fixture
```

The creator refuses existing directories. Reuse the already-prepared fixture while it still matches
the script; use `--root <new-directory>` for a separate experiment. In two separate terminals:

```sh
bun run qa:probe:agent --root qa/.artifacts/feasibility-fixture --origin http://127.0.0.1:39962 --port 39961
```

```sh
bun run qa:probe --port 39962
```

Open `http://127.0.0.1:39962/`, enter `http://127.0.0.1:39961` as Agent URL, leave the project empty
to use the fixture root, and Run checks. These are separate origins and processes. Only HTTPS
targets or explicit HTTP localhost origins are accepted; same-origin targets fail configuration. The
normal app remains on its own port and its assets are not rebuilt by this experiment.

Use Play media and Seek media, then enter a phase and Check reachability. Stop only the probe agent,
sample again to record failure, restart it on the same port, and sample to record the new start
time. A fresh page pointed at an unused port tests initial unreachability; correcting its URL and
running again tests retry. Serving the page through `http://localhost:39962/` deliberately changes
Origin, so the agent configured for `127.0.0.1` rejects it. This demonstrates rejection without
broadening the allowlist. Download report saves the accumulated observations as JSON.

Loopback HTTP qualifies as a browser secure context but does not exercise public HTTPS to Tailscale,
DNS/certificates, Local Network Access prompts, provider networking, or cloud process lifetime. It
cannot demonstrate laptop-closed operation: both simulated processes are on this laptop. No Docker
runtime was available in the preparation session, so this is a process/transport simulation, not a
Linux VM test or a reproduction of OpenAI's network policy.

#### Prepare the static and cloud source artifacts

```sh
bun run qa:probe --build-only
```

Publish only the three files in `dist/feasibility/` to the chosen static HTTPS host. Relative assets
allow a project subpath. The page has no dynamic backend, service worker, registry, or enrollment
credential. Set the agent's allowed origin to the site's scheme/hostname/port without its path. For
example, a probe at `https://example.github.io/review-probe/` uses `https://example.github.io`. This
experiment does not yet test app installation or offline startup.

`dist/feasibility-cloud.tar.gz` contains an explicit list of server/shared source, probe harness,
fixture tooling/media, and the dependency manifest/lockfile. It excludes the review app frontend,
local fixtures/repositories, reports, node_modules, and `.git`. It permits cloud testing of this
uncommitted slice. It is an experimental source bundle requiring Bun and dependency installation,
not the independently packaged production agent from step 4. Transfer it through the chosen cloud
workspace's normal file mechanism; it has not been uploaded in this session.

In a new cloud test directory, extract the bundle and install its locked dependencies:

```sh
tar -xzf /path/to/feasibility-cloud.tar.gz
bun install --frozen-lockfile --ignore-scripts
mkdir -p qa/.artifacts
bun run qa:probe:fixture
```

The ignored install hooks are unnecessary for this source-only probe. The generated Git repository
is the only approved read root in the following command. Substitute the actual static origin:

```sh
PROBE_FRONTEND_ORIGIN=https://example.github.io
nohup bun run qa:probe:agent --root qa/.artifacts/feasibility-fixture --origin "$PROBE_FRONTEND_ORIGIN" --port 39961 > qa/.artifacts/probe-agent.log 2>&1 < /dev/null &
probe_agent_pid=$!
printf '%s\n' "$probe_agent_pid" > qa/.artifacts/probe-agent.pid
curl --fail http://127.0.0.1:39961/probe/health
```

Wait for the health check to succeed after startup; a first immediate request can race the process.
`nohup` avoids terminal hangup, but does not make a provider keep the VM/process alive. Start the
agent in the actual task VM, not in a reusable prepared/cached image.

#### Private HTTPS in a cloud workspace

Provision a disposable ephemeral Tailscale node through the cloud provider's supported networking
mechanism. Permit the testing device/user to reach that node, enable tailnet HTTPS/Serve, and use a
unique task-specific hostname. Do not bake an enrolled node or a shared hostname into a cached
environment. Enrollment credentials belong in the provider's secret configuration, never the page or
connection URL. Use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) for
private HTTPS and its actual returned hostname; the agent remains loopback-bound.

When the VM has a usable enrolled Tailscale CLI, on that disposable node:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:39961
tailscale serve status
```

Enter the resulting `https://<actual-node>.<tailnet>.ts.net` URL in the static page. Check from a
different tailnet device, not merely by curling localhost inside the VM. Do not use Funnel or
disable certificate validation. A Serve-enable/admin prompt is a prerequisite to resolve in the
tailnet; do not treat it as successful automatic startup.

For a Linux container without TUN, Tailscale documents
[userspace networking](https://tailscale.com/docs/concepts/userspace-networking). If the provider
allows running your own daemon and has no existing managed node, a per-task experiment can start:

```sh
probe_ts_dir="$(mktemp -d "${TMPDIR:-/tmp}/git-review-probe-ts.XXXXXX")"
probe_hostname="review-probe-$(bun -e 'console.log(crypto.randomUUID())')"
tailscaled --tun=userspace-networking --state=mem: --socket="$probe_ts_dir/tailscaled.sock" > "$probe_ts_dir/daemon.log" 2>&1 < /dev/null &
probe_ts_pid=$!
tailscale --socket="$probe_ts_dir/tailscaled.sock" up --auth-key="${TS_AUTHKEY:?Supply an ephemeral auth key through provider secrets}" --hostname="$probe_hostname" --accept-dns=false
tailscale --socket="$probe_ts_dir/tailscaled.sock" serve --bg --https=443 http://127.0.0.1:39961
tailscale --socket="$probe_ts_dir/tailscaled.sock" serve status
```

Supply `TS_AUTHKEY` as an ephemeral enrollment secret and keep command tracing disabled. Wait for
the daemon socket to be ready before `up`. The CLI inherits that secret rather than printing it.
This userspace/inbound-Serve recipe has not been run here: outbound VPN connectivity alone is not
proof of inbound HTTPS reachability. Verify it in the target VM. On completion, stop only the owned
agent PID and log out the owned disposable node; for the separate userspace daemon, use its socket
for logout and terminate only `probe_ts_pid`. Keep reports before workspace deletion. Do not reset
Serve or log out a shared pre-existing node as probe cleanup.

#### Codex / OpenAI cloud target

The current
[OpenAI cloud-environment guide](https://learn.chatgpt.com/docs/environments/cloud-environments)
documents prepared environments, per-task working state, startup configuration, internet policy, and
a native Tailscale VPN setting using reusable ephemeral keys. It describes that VPN for access from
cloud tasks to private services. It does not establish inbound Serve/daemon control or an idle
process-lifetime guarantee. Its network-secret placeholders also differ from raw values required by
a standalone Tailscale process. Inspect the actual account's supported setup first; avoid starting a
duplicate daemon on a managed connection. The legacy setup-script guide is not the current cloud
environment workflow.

For the real Codex experiment, sign in, select a disposable private environment, make this source
bundle available, and have its startup/task hook launch the fixture agent. Check whether the managed
VPN exposes a usable inbound endpoint; if not, determine whether a separate per-task daemon/Serve
process is supported. Test package/control/relay connectivity during the task as well as setup. Do
not claim native VPN settings alone solve inbound serving.

The preparation session's in-app browser was signed out of OpenAI; the available task projects
provided no cloud execution environment, and the local Tailscale CLI could not load preferences. No
OpenAI environment, account/network settings, keys, or public static deployment were changed. Local
simulation can proceed without these inputs. A real cloud pass needs account/environment access, the
static HTTPS URL, tailnet enrollment/Serve permission, and a physical testing device.

#### Lifecycle gate and recorded evidence

Run the page's checks during the live task. Record manual reachability phases after setup, after
task completion, after the desired idle interval, and on an iPad/phone with the laptop closed. Keep
each observation's phase, elapsed interval, actual browser/OS, agent start time, and any permission
prompts. Backgrounded browsers can stop executing, so a silent timer or saved filesystem does not
establish a continuously running daemon. If the VM is suspended, source reads should fail; sample
again after resume to determine whether the agent persisted or restarted.

On 2026-10-13, the in-app browser passed all ten transport/source/media checks between
`127.0.0.1:39962` and `127.0.0.1:39961`, plus user-triggered playback requests/seeking, initial
failure and retry, a deliberately rejected frontend origin, and stop/restart reachability
observations. The downloaded local report is retained under ignored QA artifacts. Five HTTP boundary
tests cover preflight/no repository work, origin rejection, allowed-origin errors/containment, and
media headers. The four Chrome-emulation captures were inspected with no page-wide overflow:
[phone](../qa/screenshots/feasibility-probe-ready/mobile.png),
[tablet portrait](../qa/screenshots/feasibility-probe-ready/tablet-portrait.png),
[tablet landscape](../qa/screenshots/feasibility-probe-ready/tablet-landscape.png), and
[desktop](../qa/screenshots/feasibility-probe-ready/desktop.png).

The source bundle was extracted into a separate temporary directory, its frozen dependencies were
installed with hooks disabled, and its fixture/agent were started with no frontend files present.
All ten browser checks passed against that extracted copy as well. Strict type checks, the QA/format
gate, and all 302 unit/integration tests passed. This extraction test ran on macOS, not a cloud
Linux VM; no cloud networking or lifetime inference follows from it.

These results establish local browser transport and probe readiness. They do not close the plan's
cloud/Tailscale/physical-device/laptop-closed gate. Later feature steps remain unstarted.

### Existing focused scenarios

Run these scripts directly with Bun. The command column supplies required arguments; links to the
scripts expose exact scenarios and any optional arguments. Catalog coverage is a selection guide,
not a second assertion list.

| Check                                                               | Command                                                             | Fixture/setup                                           | Coverage and behavior record                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Foundation](../qa/check-foundation.ts)                             | `bun qa/check-foundation.ts --url <URL> --folder inventory-fixture` | Inventory or another direct Git child                   | [Picker](foundation-slice.md), reload, saved browser state                                                                                                         |
| [Inventory/diffs](../qa/check-diff.ts)                              | `bun qa/check-diff.ts --url <URL> --folder inventory-fixture`       | Inventory; folder name may differ if contents match     | [Diff cards](diff-slice.md), compact rows, wrapping                                                                                                                |
| [Diff context](../qa/check-diff-context.ts)                         | `bun qa/check-diff-context.ts <URL> context-fixture`                | Diff context fixture                                    | [Context expansion](diff-slice.md#revealing-unchanged-context), direction/retry, exhaustion, position/focus, language replay, cancellation and fresh feedback      |
| [Files](../qa/check-files.ts)                                       | `bun qa/check-files.ts <URL>`                                       | Inventory                                               | [Tree and viewer](file-browser-slice-proposal.md), syntax, wrapping and return to Changes                                                                          |
| [Blank source lines](../qa/check-blank-lines.ts)                    | `bun qa/check-blank-lines.ts <URL>`                                 | Creates its own fixture under `qa/.artifacts/`          | [Source-row height](diff-slice.md), empty/whitespace lines, exact text, CRLF, font sizes and wrapping in Changes, Git and Files                                    |
| [Multi-line feedback](../qa/check-multi-line-feedback.ts)           | `bun qa/check-multi-line-feedback.ts <URL>`                         | Multi-line feedback                                     | [Range feedback](feedback-slice-proposal.md), Files/Search selection, checking, archival, reattachment and limits                                                  |
| [Multi-line diff feedback](../qa/check-multi-line-diff-feedback.ts) | `bun qa/check-multi-line-diff-feedback.ts <URL>`                    | Multi-line feedback and diff context                    | [Range feedback](feedback-slice-proposal.md), Old/New/mixed ranges, revealed context, source identity, markers, copy and reattachment                              |
| [Code rendering](../qa/check-code-rendering.ts)                     | `bun qa/check-code-rendering.ts <URL>`                              | Creates its own fixture under `qa/.artifacts/`          | Unchanged-code isolation and affected feedback markers in large Changes and Files                                                                                  |
| [Code containment](../qa/check-code-containment.ts)                 | `bun qa/check-code-containment.ts <URL>`                            | Creates its own fixture under `qa/.artifacts/`          | [Rendering geometry](long-diff-performance-investigation.md), skipped content, Back, responsive/font/wrap changes, horizontal extent, line navigation and fallback |
| [Search](../qa/check-search.ts)                                     | `bun qa/check-search.ts <URL>`                                      | Inventory; host ripgrep                                 | [Literal Search](search-slice-proposal.md), result navigation and source freshness                                                                                 |
| [Selected Search](../qa/check-selected-search.ts)                   | `bun qa/check-selected-search.ts <URL>`                             | Inventory; host ripgrep                                 | [Selection action](search-slice-proposal.md#selected-code-search), native ranges and scrolling                                                                     |
| [Navigation](../qa/check-navigation.ts)                             | `bun qa/check-navigation.ts <URL>`                                  | Inventory and `other-project`                           | [URLs and responsive views](navigation-and-url-history-slice-proposal.md), card focus and Back/Forward                                                             |
| [History controls](../qa/check-history-controls.ts)                 | `bun qa/check-history-controls.ts <URL>`                            | Inventory                                               | [Visible browser history](navigation-and-url-history-slice-proposal.md#visible-browser-history), branching, reload and overlays                                    |
| [Project entry](../qa/check-project-entry.ts)                       | `bun qa/check-project-entry.ts <URL> <PLAIN_URL>`                   | Inventory plus separate plain/clean root                | [Phone entry](navigation-and-url-history-slice-proposal.md#current-user-flow), explicit URLs and project failures                                                  |
| [Loading](../qa/check-loading.ts)                                   | `bun qa/check-loading.ts <URL>`                                     | Inventory, history and `other-project`                  | [Ownership, caches and focus](loading-and-transition-polish.md), delayed responses, cancellation and bulk controls                                                 |
| [Live changes](../qa/check-live-changes.ts)                         | `bun qa/check-live-changes.ts <URL>`                                | Creates its own fixture under `qa/.artifacts/`          | [Freshness and Update](live-change-detection-slice-proposal.md), drafts and reading position                                                                       |
| [Changes totals](../qa/check-change-stats.ts)                       | `bun qa/check-change-stats.ts <URL>`                                | Line counts                                             | [Counts](changes-line-counts-proposal.md), layers, exceptional summaries, Update and wrapping                                                                      |
| [Git](../qa/check-git.ts)                                           | `bun qa/check-git.ts <URL>`                                         | Git history and its generated info file                 | [Historical inspection](git-history-slice-proposal.md), paging, sources, metadata and cache navigation                                                             |
| [Line actions](../qa/check-line-action.ts)                          | `bun qa/check-line-action.ts <URL>`                                 | Creates its own fixture under `qa/.artifacts/`          | [Compact rows and Old/New actions](feedback-slice-proposal.md#line-actions-and-diff-sides)                                                                         |
| [Feedback](../qa/check-feedback.ts)                                 | `bun qa/check-feedback.ts <URL>`                                    | Inventory                                               | [Draft/check/copy/history/Undo](feedback-slice-proposal.md)                                                                                                        |
| [File feedback](../qa/check-file-feedback.ts)                       | `bun qa/check-file-feedback.ts <URL> <PLAIN_URL>`                   | Inventory plus separate plain/clean root                | [File anchors and reattachment](feedback-slice-proposal.md#anchor-identity-and-checking), failed reads and copy                                                    |
| [Selected feedback](../qa/check-selected-feedback.ts)               | `bun qa/check-selected-feedback.ts <URL>`                           | Inventory                                               | [Exact fragments](feedback-slice-proposal.md#selected-fragments), Unicode, wrapped ranges, persistence and reattachment                                            |
| [Feedback transactions](../qa/check-feedback-transactions.ts)       | `bun qa/check-feedback-transactions.ts <URL>`                       | Inventory; creates `other-project` when absent          | [Pending copy/check ownership](feedback-slice-proposal.md#copy-transactions-and-recovery), concurrent edits and navigation                                         |
| [Modals](../qa/check-modals.ts)                                     | `bun qa/check-modals.ts <URL>`                                      | Inventory                                               | Feedback/settings modal scrolling and contained controls                                                                                                           |
| [Voice](../qa/check-voice.ts)                                       | `bun qa/check-voice.ts <URL>`                                       | Inventory; mocked recorder/transcription                | [Dictation lifecycle](local-voice-comment-slice-proposal.md), caret, Retry/Cancel and late results                                                                 |
| [Typography](../qa/check-typography.ts)                             | `bun qa/check-typography.ts <URL>`                                  | Inventory; Google Fonts network access                  | [Code typography](code-typography-slice-proposal.md), persistence, fallback and contained large text                                                               |
| [Themes](../qa/check-themes.ts)                                     | `bun qa/check-themes.ts <URL>`                                      | Inventory                                               | [Independent appearance](theme-settings-slice-proposal.md), System mode and cross-tab updates                                                                      |
| [Tabs](../qa/check-tabs.ts)                                         | `bun qa/check-tabs.ts <URL>`                                        | Inventory; creates `other-project` when absent          | [Per-tab selection](independent-tabs-and-pwa-proposal.md#independent-tabs), explicit URLs and obsolete-key deletion                                                |
| [PWA/backups](../qa/check-pwa.ts)                                   | `bun qa/check-pwa.ts <URL>`                                         | Inventory                                               | [Installation/local data](independent-tabs-and-pwa-proposal.md), current-format import, offline fallback and storage limits                                        |
| [Images](../qa/check-media.ts)                                      | `bun qa/check-media.ts <URL> media-fixture`                         | Images                                                  | [Source-correct media](media-preview-slice-proposal.md), SVG isolation and raw sources                                                                             |
| [Playback](../qa/check-media-playback.ts)                           | `bun qa/check-media-playback.ts <URL> media-av-fixture`             | Audio/video                                             | [Native media](media-preview-slice-proposal.md), loading, seeking and ranges                                                                                       |
| [Stateless projects](../qa/check-stateless-projects.ts)             | `bun qa/check-stateless-projects.ts`                                | Run `bun run build` first; owns temporary roots/servers | [Restart/root-change contract](stateless-project-access-plan.md), resource reads, drafts and recovery                                                              |
| [Formatting hook](../qa/check-format-hook.ts)                       | `bun qa/check-format-hook.ts`                                       | Owns isolated Git/index fixtures                        | [Staged formatting](formatting-workflow.md), partial edits, ignored files and rollback                                                                             |

Server/shared tests cover parsing, containment, exact source reads and invalid-input cases that
browser checks cannot exhaust. Source links in the relevant boundary record identify those tests. No
catalog entry claims physical-device verification.

The [Changes header check](../qa/check-changes-card-header.ts) runs with
`bun qa/check-changes-card-header.ts <URL>`. It creates and removes its own Git fixture beneath the
isolated server's approved root and covers the [header and Open flow](diff-slice.md) at all standard
viewports plus a narrow phone.

## Screenshot procedure

The [application notification check](../qa/check-notifications.ts) runs with
`bun qa/check-notifications.ts <URL>` and creates/removes its own Git fixture beneath the isolated
server's approved root. It covers standard sizes plus a narrow phone, dark appearance, simulated
keyboard geometry and a popover-disabled fallback. An optional profile name selects one scenario
group. [The notification record](application-notifications.md) owns the contract and milestone
links.

Capture a new, descriptive milestone after rebuilding the client:

```sh
bun run qa:capture --url http://127.0.0.1:39911/ --label <new-milestone>
```

[The capture script](../qa/capture.ts) writes phone, both tablet orientations, desktop, and a
manifest into `qa/screenshots/<new-milestone>/`. It refuses an existing label before opening Chrome
so prior evidence is preserved. Inspect all four images for clipped controls, unreadable code,
obscured feedback actions and page-wide overflow; horizontal scrolling inside an unwrapped code pane
is intentional. The command checks page-load failures and document overflow but cannot judge visual
quality.

Use a complete destination URL for Files, Search or Git. Saved browser state omits per-tab session
storage: use `--active-path <root-relative-folder>` when a capture needs a selected Changes project,
and combine `--storage-state <file>` when saved drafts or preferences are needed. Explicit URLs
remain authoritative. Focused checks save reusable state beneath ignored `qa/.artifacts/` where
appropriate.

`bun run qa:capture --help` is the full option reference. Useful controls are:

| Purpose                         | Options                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Wait for loaded content         | `--ready <selector>`, `--after-click-ready <selector>`                                                                    |
| Set up an interaction           | Repeat `--click <selector>` and `--fill <selector> <value>` in order                                                      |
| Show narrow contextual lists    | `--reveal-list`                                                                                                           |
| Inspect a long or scrolled view | `--full-page`, `--scroll-to <selector>`, `--scroll-offset <pixels>` (negative scrolls up), `--scroll-x-to-end <selector>` |
| Show a code selection           | `--select-text <code-selector> <text>`                                                                                    |
| Show a source range             | `--select-range <first-code-selector> <start-offset> <last-code-selector> <end-offset>`                                   |
| Show recording or ready media   | `--fake-microphone`, `--media-ready`                                                                                      |

Keep useful milestone images and manifests, and link them once from the owning behavior record or
current review handoff. Older captures show their recorded version, not the current UI. Ordinary
check output and temporary state belong in ignored artifacts; do not copy screenshot inventories
into this guide. Curate only with incoming links and useful evidence in mind.

## Shared QA support

[Browser support](../qa/browser-support.ts) owns installed-Chrome lifetime, scoped context cleanup,
standard profiles, page-error collection and document-overflow checks. Use its scopes for new checks
and pass scenario options explicitly. Keep feature interactions, storage seeds, response gates and
fixture restoration beside each check. Release held responses before cleanup. Capture and loading's
private delayed-response scenarios retain their own lifetime requirements.

[Server test support](../src/test-support.ts) owns Git calls with explicit working directories and
argument arrays, deterministic child author identities, and temporary-directory cleanup. It mutates
only owned test fixtures; production reads use the separate [Git boundary](git-read-boundaries.md).
It is a mechanism shared by scenarios, not a centralized repository fixture or test runner. Run the
affected callers when changing shared support.

## Real-device checks

Chrome emulation checks layouts and automated interactions. It does not establish native selection
menus/handles, gestures, virtual keyboards, clipboard permissions, microphone capture, installed-app
storage or OS codec support. Some clipboard checks use granted localhost permissions; pending-write
checks and voice scenarios use mocks. Synthetic recording screenshots establish only the visible UI.

When an affected feature changes, check it on real Android/iOS browsers and installed windows over
HTTPS as appropriate: selection and horizontal scrolling, line actions, keyboard layout, copy,
recording/permission denial, native media playback, installation/data transfer, and navigation after
reload or host restart. Record the actual device/browser, steps, result and remaining uncertainty.
Selected historical evidence and maintainer confirmations belong in each behavior record. Do not
turn an unperformed device check into a claim that the feature passed.
