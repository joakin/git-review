# Testing and visual QA

This document records how we verify the app as it grows. The product plan is in [Initial Implementation Plan](initial-implementation-plan.md).

## Every small change

1. Run the project-local native TypeScript type checker with `bun run typecheck` and the CSS token check with `bun run qa:check`.
2. Exercise the behavior that changed. Add a lasting automated test when it protects an observable invariant or a bug that could recur.
3. For a UI change, capture the relevant state at four sizes and inspect the images for clipped controls, page-wide overflow, unreadable code, and obscured feedback actions.
4. Describe the behavior, checks, and any remaining device-specific uncertainty in the handoff to the maintainer.

Keep unit and integration tests focused on inputs and outputs. Prefer Git fixture repositories for status/diff behavior, bounded invalid-input cases for APIs, and browser interactions for comment, drawer, wrap, and copy flows. Avoid tests of private function call order, redundant getters, and snapshots of incidental DOM structure. Remove exploratory tests that would only create maintenance noise.

## Screenshot command

Start the local app, then run:

```sh
bun run qa:capture --url http://127.0.0.1:3000/ --label foundation
```

The command launches the installed Google Chrome through Playwright and writes `desktop.png`, `tablet-landscape.png`, `tablet-portrait.png`, `mobile.png`, and `manifest.json` to `qa/screenshots/foundation/`. Use a new, descriptive label for each reviewable milestone. The default is a viewport screenshot. Add `--full-page` when the entire continuous diff needs review, `--ready '.selector'` if a screen must finish loading, and `--click '.selector'` to open a control. Repeat `--click` for a sequence, such as the project switch then the install dialog. For a lazy diff, add `--after-click-ready '.diff-code'` so capture waits for its lines. `--help` lists options.

For the foundation picker, `bun run qa:foundation --url http://127.0.0.1:3000/ --folder <direct-child-name>` checks mobile folder selection and reload, then saves browser state under `qa/.artifacts/`. Browser state files omit per-tab `sessionStorage`; add `--active-path <folder-relative-path>` to capture a selected project at all four sizes. Combine it with `--storage-state` when the capture also needs saved drafts or preferences.

For inventory screenshots, run `bun run qa:fixture` once to create `qa/.artifacts/inventory-fixture` with staged, unstaged, and untracked changes. Start the app with `--root "$PWD/qa/.artifacts"`, run `qa:foundation` with `--folder inventory-fixture`, then pass its saved browser state to `qa:capture`. The fixture script refuses to overwrite an existing fixture; remove that ignored folder yourself when you need a fresh one.

Run `bun run qa:diff --url http://127.0.0.1:3000/ --folder inventory-fixture` against that fixture to check a phone flow through the file drawer, staged diff rows, wrap persistence, open-card persistence, contained horizontal scrolling, and the sticky heading of a long file. [Long-file screenshots](../qa/screenshots/sticky-file-header/mobile.png) show the header after scrolling at all four sizes.
The same command checks C syntax tokens and a language override saved across reload. [Syntax screenshots](../qa/screenshots/syntax-c-diff/mobile.png) show the expanded C card at all four capture sizes.

Run `bun run qa:feedback http://127.0.0.1:3000/` against the same fixture to check a phone flow through line comments, reload persistence, export, copy history, Undo, Clipboard API absence, and stale-line exclusion. It writes `qa/.artifacts/feedback-storage.json` for repeatable captures. [Feedback preview](../qa/screenshots/feedback-first-slice/mobile.png) and [comment editor](../qa/screenshots/comment-editor-first-slice/mobile.png) each have all four viewport captures.

Run `bun run qa:tabs http://127.0.0.1:3000/` to check that two tabs can keep different projects across reload while sharing recents, and that the old shared selection migrates once. Run `bun run qa:pwa http://127.0.0.1:3000/` to check manifest/icon delivery, service-worker offline fallback, that API responses stay out of its cache, and draft backup export/import with invalid-file rejection. The [install/data dialog](../qa/screenshots/tab-pwa-install-data/mobile.png) and [review view](../qa/screenshots/tab-pwa-review/mobile.png) have four-size captures. Browser QA does not prove actual Android or iOS installation; check that on real devices after HTTPS is enabled.

The current tailnet HTTPS deployment uses port 8443, leaving the machine domain's default HTTPS root free. The [live project view](../qa/screenshots/https-port-8443-review/mobile.png) has four-size captures from that address. A port change creates a new browser storage origin, so export and import local review data before leaving an origin that contains drafts.

The capture exits nonzero for page load failures or page-wide horizontal overflow. A horizontally scrolling **code pane** is allowed; the document itself should fit the viewport. Inspect the images rather than relying solely on the overflow check. Link useful screenshots in the human handoff. Generated test traces and temporary files belong in `qa/.artifacts/`; curated milestone screenshots remain under `qa/screenshots/`.

Use `--scroll-x-to-end '.diff-scroll'` to capture a code pane at its far-right edge. The [wrapped](../qa/screenshots/diff-marker-left-wrap/mobile.png) and [horizontal-scroll](../qa/screenshots/diff-marker-left-scroll/mobile.png) sets show compact rows, left-hand change markers, fixed gutters, and background coverage at all four sizes. The [tapped collapsed heading](../qa/screenshots/diff-header-tap-collapsed/mobile.png) set shows its rounded border and background.

For a long file header, use `--click` to expand its card, `--after-click-ready` to wait for diff lines, then `--scroll-to` the card and `--scroll-offset 360` to capture its header while the page is partway through the file.

The command uses desktop Chrome with emulated touch, viewport, and mobile settings for smaller screens. This does not reproduce mobile Safari or Android Chrome exactly. Use real devices for long press, double tap, keyboard/safe-area layout, clipboard, and voice recording before those features are called complete.

## Baseline matrix as features arrive

| Area | Behavior to verify |
| --- | --- |
| Host boundaries | Allowed root succeeds; traversal and symlink escapes fail; invalid API data is rejected. |
| Git layers | Staged, unstaged, and untracked changes stay separate, including two layers on one path; renames, deletion, binary files, and odd names are represented. |
| Review UI | Drawer opens and closes on mobile; files collapse; code wraps or scrolls inside its pane; no page-wide overflow. |
| Feedback | Old/new line anchors are clear; drafts survive reload; copy history records only successful copies; export includes path, layer, side, and line. |
| Search and files | Search result opens its file and line; older versions and unsupported previews fail safely. |
| Voice | Recording and cancellation, permission denial, transcript review, upload limits, Handy errors, and temporary-file cleanup. |

Run checks for the feature being built; do not create an exhaustive suite before the corresponding behavior exists.
