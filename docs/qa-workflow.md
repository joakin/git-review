# Testing and visual QA

This document records how we verify the app as it grows. The product plan is in [Initial Implementation Plan](initial-implementation-plan.md).

## Every small change

1. Run the project-local native TypeScript type checker (`bun run qa:check` for the current QA tooling; the app scaffold will add its own client/server gates).
2. Exercise the behavior that changed. Add a lasting automated test when it protects an observable invariant or a bug that could recur.
3. For a UI change, capture the relevant state at four sizes and inspect the images for clipped controls, page-wide overflow, unreadable code, and obscured feedback actions.
4. Describe the behavior, checks, and any remaining device-specific uncertainty in the handoff to the maintainer.

Keep unit and integration tests focused on inputs and outputs. Prefer Git fixture repositories for status/diff behavior, bounded invalid-input cases for APIs, and browser interactions for comment, drawer, wrap, and copy flows. Avoid tests of private function call order, redundant getters, and snapshots of incidental DOM structure. Remove exploratory tests that would only create maintenance noise.

## Screenshot command

Start the local app, then run:

```sh
bun run qa:capture --url http://127.0.0.1:3000/ --label foundation
```

The command launches the installed Google Chrome through Playwright and writes `desktop.png`, `tablet-landscape.png`, `tablet-portrait.png`, `mobile.png`, and `manifest.json` to `qa/screenshots/foundation/`. Use a new, descriptive label for each reviewable milestone. The default is a viewport screenshot. Add `--full-page` when the entire continuous diff needs review, `--ready '.selector'` if a screen must finish loading, and `--click '.selector'` to capture a simple open state such as the mobile folder drawer. `--help` lists options.

For the foundation picker, `bun run qa:foundation --url http://127.0.0.1:3000/ --folder <direct-child-name>` checks mobile folder selection and reload, then saves browser state under `qa/.artifacts/`. Pass that state to `qa:capture --storage-state qa/.artifacts/foundation-storage.json` to capture the selected-project screen at all four sizes.

The capture exits nonzero for page load failures or page-wide horizontal overflow. A horizontally scrolling **code pane** is allowed; the document itself should fit the viewport. Inspect the images rather than relying solely on the overflow check. Link useful screenshots in the human handoff. Generated test traces and temporary files belong in `qa/.artifacts/`; curated milestone screenshots remain under `qa/screenshots/`.

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
