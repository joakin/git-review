# git-review

A local, browser-based code review app in progress. Choose a host folder within an approved root, then review staged, unstaged, and untracked changes in expandable diff cards. The selected folder, code wrapping, and open cards survive reload. Syntax highlighting, browsing, comments, search, and voice transcription remain in the [Initial Implementation Plan](docs/initial-implementation-plan.md). See the [Git inventory](docs/git-status-slice.md) and [diff card](docs/diff-slice.md) documents for current behavior.

## Run the app

Requires Bun and Google Chrome (for optional visual QA).

```sh
bun install
bun run dev --root /path/to/projects
```

Open the URL printed by the server from this Mac. To reach it through Tailscale, bind to this Mac's Tailscale IPv4 address:

```sh
GIT_REVIEW_HOST=100.x.y.z bun run dev --root /path/to/projects --port 39878
```

Use the Mac's Tailscale hostname with that port on another connected device, for example `http://your-mac.your-tailnet.ts.net:39878/`. The default bind address is `127.0.0.1`; `--root` defaults to the current working directory and `--port` to `3000`. After client edits, restart `bun run dev` or run `bun run build` while the server is running.

## Checks

```sh
bun run typecheck
bun run test
bun run qa:check
bun run qa:foundation --url http://127.0.0.1:3000/ --folder <direct-child-name>
bun run qa:diff --url http://127.0.0.1:3000/ --folder inventory-fixture
bun run qa:capture --url http://127.0.0.1:3000/ --label <milestone>
```

The browser QA commands use the installed Chrome. See [the QA workflow](docs/qa-workflow.md) for screenshots and device checks, and [the foundation slice](docs/foundation-slice.md) for the current API and boundaries.
