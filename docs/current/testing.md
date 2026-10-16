# Testing and visual QA

Use checks that establish the changed behavior and important failure paths. Exact scenarios belong
to the executable checks, not a second prose specification. [package.json](../../package.json) owns
root commands.

## Checks for a change

- Run `bun run format` and `bun run format:check` after edits. For documentation, validate local
  links/anchors and referenced commands against their definitions.
- For every code change, run `bun run typecheck`, `bun run qa:check`, and affected tests. `qa:check`
  checks QA TypeScript, package boundaries, CSS tokens, and formatting; it does not run browser
  scenarios. `bun run test` runs unit/integration tests.
- Test observable behavior and durable invariants, including failure cases. Avoid tests that repeat
  private implementation or snapshot incidental markup.
- For visible UI changes, run relevant browser checks and capture/inspect phone, tablet portrait,
  tablet landscape, and desktop. Report actual coverage and gaps.

## Fixtures and browser checks

Browser tools use installed Google Chrome through [shared support](../../qa/browser-support.ts). Run
them against separate QA roots and unused ports. Never use the maintainer's working repository as a
mutation fixture, and stop only processes started for the task. Some checks mutate and restore
fixtures; run them sequentially when sharing a server. Rebuild frontend assets first; restart a
fixture backend after backend edits.

For common checks:

```sh
mkdir -p qa/.artifacts
bun qa/prepare-inventory-fixture.ts
bun qa/prepare-git-fixture.ts
mkdir -p qa/.artifacts/other-project
bun run dev --root "$PWD/qa/.artifacts" --port 39911
```

Preparation refuses existing named fixtures. Reuse only matching fixtures, or recreate an owned QA
fixture deliberately. `<URL>` below means that server's printed address, for example
`http://127.0.0.1:39911/`. Commands run in another terminal while the fixture server remains
available.

| Area                            | Check and setup                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files and Search                | `bun qa/check-files.ts <URL>`; `bun qa/check-search.ts <URL>`; inventory fixture.                                                                                                                                                                              |
| Navigation and loading          | `bun qa/check-navigation.ts <URL>`; `bun qa/check-loading.ts <URL>`; inventory/history and second project.                                                                                                                                                     |
| Changes and Git                 | `bun qa/check-diff.ts --url <URL> --folder inventory-fixture`; `bun qa/check-git.ts <URL>`; inventory/history.                                                                                                                                                 |
| Live edits                      | `bun qa/check-live-changes.ts <URL>`; owns its fixture beneath the server root.                                                                                                                                                                                |
| Line counts and sidebar         | Prepare with `bun qa/prepare-change-stats-fixture.ts`, then `bun qa/check-change-stats.ts <URL>` or `bun qa/check-sidebar-sections.ts <URL>`.                                                                                                                  |
| Context expansion               | `bun qa/prepare-diff-context-fixture.ts`, then `bun qa/check-diff-context.ts <URL> context-fixture`.                                                                                                                                                           |
| Feedback and selections         | `bun qa/check-feedback.ts <URL>`; `bun qa/check-selected-feedback.ts <URL>`; `bun qa/check-feedback-transactions.ts <URL>`; inventory.                                                                                                                         |
| Multi-line feedback             | `bun qa/prepare-multi-line-fixture.ts` plus `bun qa/prepare-diff-context-fixture.ts`, then `bun qa/check-multi-line-feedback.ts <URL>` and `bun qa/check-multi-line-diff-feedback.ts <URL>`.                                                                   |
| Images and playback             | Prepare with `bun qa/prepare-media-fixture.ts` or `bun qa/prepare-media-av-fixture.ts`; then `bun qa/check-media.ts <URL> media-fixture` or `bun qa/check-media-playback.ts <URL> media-av-fixture`. Audio/video preparation needs FFmpeg with H.264 encoding. |
| Appearance, voice, installation | `bun qa/check-themes.ts <URL>`; `bun qa/check-typography.ts <URL>`; `bun qa/check-voice.ts <URL>`; `bun qa/check-pwa.ts <URL>`; inventory. Voice checks use mocks; typography can need Google Fonts access.                                                    |
| Large code rendering            | `bun qa/check-code-rendering.ts <URL>`; `bun qa/check-code-containment.ts <URL>`; each owns large fixtures beneath the server root.                                                                                                                            |

Other focused checks live under [`qa/`](../../qa/), named for their behavior; read their
argument/setup definitions before running. Project-entry and file-feedback checks additionally need
an approved root outside any Git worktree with `plain-folder/readme.txt` and a committed
`clean-git/readme.txt`; pass that second server as `<PLAIN_URL>` to the check. Keep both roots
disposable.

Self-contained checks own their servers, temporary copies, and fixtures:

- `bun qa/check-static-web.ts`: root/subpath static artifacts and service-worker behavior.
- `bun qa/check-agent-package.ts`: copied API artifact and read-only repository access.
- `bun qa/check-agent-http.ts`: packaged cross-origin HTTP and native media.
- `bun qa/check-agent-data.ts`: endpoint-owned storage and backup foundations.
- `bun qa/check-agent-transport.ts`: actual client API families against separate agents. Run
  `bun run build` first. Add `--state`, `--data`, `--recovery`, or `--hosts` for corresponding
  UI/state flows; `--capture <new-label>` captures that mode.
- `bun qa/check-stateless-projects.ts`: restart/root-change behavior; build first.
- `bun qa/check-cloud-agent.ts`: packaged launcher with controlled Tailscale tools.
- `bun qa/check-format-hook.ts` and `bun qa/check-secrets.ts`: hook/scanner behavior in isolated
  repositories, including partial staging and synthetic credentials.

Shared [test support](../../qa/test-support.ts) owns fixture Git execution and temporary cleanup.
Production access uses separate agent boundaries.

## Screenshots and physical devices

After rebuilding, capture an owned fixture or public entry screen:

```sh
bun run qa:capture --url http://127.0.0.1:39911/ --label <new-milestone>
```

The [capture tool](../../qa/capture.ts) writes all four sizes and a manifest to ignored
`qa/.artifacts/screenshots/`. Inspect every image for clipped controls, unreadable source, obscured
actions, wrapping, and document overflow. Horizontal scrolling inside an unwrapped code pane is
intentional. Automation checks page errors and overflow; it cannot establish visual quality.

Use `--publish` only for useful evidence intended for this public repository; it writes to
`qa/screenshots/`. Inspect pixels and the manifest URL for private source, credentials, paths, and
personal details before staging. The option changes destination and does not redact content.
Existing labels are never overwritten. Keep historical captures in place unless evidence curation is
part of the task; old images establish their recorded milestone, not the current UI.

Use explicit destination URLs for Files/Search/Git. Changes captures can use `--active-path` with
`--storage-state` for saved preferences/drafts; storage state does not contain per-tab session
storage. `bun run qa:capture --help` owns the full interaction, readiness, selection, scrolling, and
media options. Link useful milestone images from the handoff or task record rather than current
guides.

Browser emulation does not verify native selection handles, gestures, virtual keyboards, clipboard
permissions, microphone capture, OS codecs, or installed-app storage. Check affected flows on real
iOS/Android devices over HTTPS when available. Record device/browser, steps, results, and remaining
gaps. Granted localhost clipboard permissions and mocked recording do not establish physical-device
success.

## Deployment checks

Local artifact checks establish packaging and application boundaries. For a deployment, verify
public HTTPS/base-path assets, manifest/worker delivery, redirects, private agent reachability,
browser network permissions, and installation/data transfer on actual target devices.

Cloud acceptance additionally needs two agents, equal-path source isolation, saved-feedback recovery
after one disappears, and provider availability during the task, after completion, after
idle/suspend, after resume, and with the laptop closed. Loopback Linux checks or controlled
Tailscale executables do not establish VPN/certificate routing or provider lifetime. Runtime setup
belongs in [operations](operations.md). Record deployment-specific results in its task record.
