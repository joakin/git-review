# git-review

A local, browser-based code review app. Choose a host folder within an approved root, review staged,
unstaged, and untracked changes in expandable, syntax-highlighted diff cards, or browse and search
current files in the working tree. Select text in one code line for contextual Search and Comment
actions. Selection comments preserve the exact fragment in their source quote, export, and history.
Tap a text row in Files, a Search result, or a working-copy diff to reveal its Comment action,
dictate into the comment, check the source lines, and copy a line-numbered summary. The Git tab
browses local and already-present remote branches and opens full commit messages with historical
diff cards, without checking out a branch. Projects, directories, files, Search results, branches,
and commits have URLs for direct links and browser Back/Forward. With no explicit URL, the selected
folder is restored **in its own tab**; recent folders, code wrapping, working-copy open cards,
language overrides, comments, and copy history survive reload in this browser. The
[documentation map](docs/README.md) links current behavior and engineering records.

Expanded diffs stay cached in tab memory across section navigation, preserving their content and
height. The cache is bounded and is cleared by a page reload; preferences and drafts remain in
browser storage. See [loading and screen transitions](docs/loading-and-transition-polish.md).

Floating Back/Forward controls provide navigation in installed windows as well as browser tabs. They
appear at the bottom left when a neighboring app destination is known, preserve availability across
reload, and hide during menus and line actions. The heading arrow opens the parent list. See the
[usability follow-up and review record](docs/pwa-navigation-and-file-feedback-proposal.md).

On phones, choosing a project or restoring it from the bare app URL opens its contextual list and
project tabs. **Review all changes** opens continuous review in one tap; selecting a file opens its
diff. Non-Git folders open Files. Explicit links, reloads, history traversal, and resizing preserve
the destination being read.

Historical cards read exact commit/parent blobs, including media. Root commits compare with an empty
tree; merges compare with their first parent. The list and commit summary show date and time plus
added/deleted line totals for the same project scope and comparison. Git is an inspection view: line
information is available, while comments and Search retain their working-copy meaning. Historical
card state and loaded history pages stay in this tab's memory. See
[Git inspection behavior and limits](docs/git-history-slice-proposal.md).

## Project status

The initial implementation stage is **complete and closed as of 2026-09-30**. The maintainer
considers the app usable and useful; the final reviewed feature delivery is `22de40e`. The
subsequent [maintenance pass](docs/maintenance-plan.md) is on hold during the agreed
[usability follow-ups](docs/pwa-navigation-and-file-feedback-proposal.md); its plan owns maintenance
progress, review status, and verification evidence. The
[remaining roadmap](docs/initial-implementation-plan.md#remaining-roadmap) is an optional product
backlog. The [stage closure record](docs/initial-implementation-plan.md#stage-closure--2026-09-30)
preserves acceptance and verification context.

## Run the app

Requires Bun and Google Chrome (for optional visual QA).

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
downloaded Handy model on the host. The default paths are `/opt/homebrew/bin/ffmpeg` and
`/Applications/Handy.app/Contents/MacOS/handy`; set `GIT_REVIEW_FFMPEG_PATH` or
`GIT_REVIEW_HANDY_PATH` to an absolute executable path if yours differs. Voice remains optional;
typed comments work without these tools.

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

## Checks

`bun install` installs the pinned development tools and activates the Husky pre-commit hook. Run
`bun run format` to format source, styles, configuration, and Markdown, or `bun run format:check` to
check without writing. Each commit automatically formats staged files with Prettier through
lint-staged, preserving unstaged edits. Generated build output, QA artifacts/screenshots, raster
icons, and Bun's lockfile retain their own formats. See the
[formatting workflow](docs/formatting-workflow.md).

```sh
bun run typecheck
bun run test
bun run qa:check
bun run qa:foundation --url http://127.0.0.1:3000/ --folder <direct-child-name>
bun run qa:diff --url http://127.0.0.1:3000/ --folder inventory-fixture
bun run qa:files http://127.0.0.1:3000/
bun run qa:navigation http://127.0.0.1:3000/
bun run qa:loading http://127.0.0.1:3000/
bun run qa:git-fixture
bun run qa:git http://127.0.0.1:3000/
bun run qa:feedback http://127.0.0.1:3000/
bun run qa:selected-feedback http://127.0.0.1:39911/
bun run qa:file-feedback http://127.0.0.1:39911/ http://127.0.0.1:39912/
bun run qa:voice http://127.0.0.1:3000/
bun run qa:tabs http://127.0.0.1:3000/
bun run qa:pwa http://127.0.0.1:3000/
bun run qa:capture --url http://127.0.0.1:3000/ --label <milestone>
```

The browser QA commands use the installed Chrome. See [the QA workflow](docs/qa-workflow.md) for
screenshots and device checks, and [the foundation slice](docs/foundation-slice.md) for the current
API and boundaries.
