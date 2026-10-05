# Repository formatting

Status: reviewed and accepted on 2026-10-04; committed as `fa927ac`

The maintainer requested consistent whitespace throughout the codebase and automatic formatting
before commits, with a separate review before continuing file feedback in U03. U02 is accepted and
committed as `b9aeee3`. The [usability record](pwa-navigation-and-file-feedback-proposal.md) owns
that feature sequence; maintenance remains on hold.

## Formatter and commands

The installed Bun 1.3.1 has no built-in formatter command. Use locally installed, exactly pinned
**Prettier 3.9.9**, **Husky 9.1.7**, and **lint-staged 17.6.0** through Bun. Prettier's
[installation guide](https://prettier.io/docs/install) documents this Bun setup; its
[pre-commit guide](https://prettier.io/docs/precommit) identifies lint-staged as an option for
partially staged files.

- `bun run format` formats the repository in place.
- `bun run format:check` checks formatting without writing. It also runs as part of
  `bun run qa:check`.
- `bun run format:staged` runs the staged-file formatter manually; the Git hook invokes it with
  Bun's runtime.
- `bun qa/check-format-hook.ts` exercises the actual installed hook in a temporary Git fixture.
- `bun install` activates hooks through the `prepare` script. `bun run prepare` can reactivate them
  in an existing checkout.

[.prettierrc.json](../.prettierrc.json) uses two-space indentation, a 100-column wrapping target,
double quotes and semicolons for TypeScript, trailing commas where supported, LF endings, and
wrapped Markdown prose. The two-space, quote, semicolon, and trailing-comma choices are Prettier
defaults. JSON parsing is explicitly selected for `.webmanifest`, and HTML parsing for SVG source.
[.editorconfig](../.editorconfig) gives editors the same indentation and line-ending conventions,
while retaining intentional Markdown hard breaks.

The formatter covers source and tests, QA/build scripts, CSS, HTML, JSON configuration, SVG source,
and Markdown documents, including fenced code examples. [.prettierignore](../.prettierignore)
excludes dependencies, generated build output, temporary QA data, capture manifests/images,
generated raster icons, and Bun's generated lockfile. Existing `.gitignore` exclusions also apply.

## Commit behavior

[.husky/pre-commit](../.husky/pre-commit) runs `bun run --bun format:staged`, using installed
package binaries rather than downloading tools during commits. Husky installs its wrapper under
`.husky/_` and sets the checkout's local `core.hooksPath` to that directory. The wrapper is
generated and ignored; the hook's source is tracked. Existing hooks were checked before
installation; this checkout had no active custom hook path or pre-commit hook.

The single lint-staged task applies `prettier --write --ignore-unknown` to staged files, respecting
the formatter's ignore rules. It stages the formatted result and preserves unstaged edits, including
partial staging. Unknown binary formats are skipped. A formatter failure blocks the commit;
lint-staged's default backup and restoration behavior remains enabled. Hooks enforce this local
workflow; formatting checks can also run independently in automated verification.

Formatting changes remain uncommitted until the maintainer reviews and approves them. The pre-commit
hook does not authorize committing a feature or unrelated edits.

## Verification and review

- **Scope:** all eligible source, tests, scripts, styles, configuration, SVG, HTML, and Markdown
  files are formatted. The 122 changed tracked files under `src/`, `qa/`, and `scripts/` match only
  Prettier formatting of committed U02, verified against `git show HEAD:<path>`. Tooling and focused
  documentation changes are the only additional work. Generated captures, raster icons, build
  output, and the lockfile remain under their existing generation rules; the lockfile changes only
  to record the new pinned development dependencies.
- **Commands and installation:** `bun run format:check`, strict TypeScript, CSS validation, and
  build pass. A frozen `bun install --frozen-lockfile` executes `prepare` and installs `.husky/_`
  successfully. Before review, the hook was exercised in its own fixture with the repository index
  empty; the approved `fa927ac` commit also ran the installed hook successfully.
- **Hook evidence:** `qa:format-hook` passes with the actual Git hook and copied repository
  configuration. It formats TypeScript/TSX, CSS, Markdown, JSON, SVG, and web manifests; handles
  spaces and Unicode filenames; preserves partial staged/unstaged edits, generated capture metadata,
  untracked files, and a staged deletion; and leaves no backup stash. An intentionally invalid
  TypeScript file blocks the hook and restores the prior staged tree and working files, including
  unstaged edits.
- **Regression evidence:** the full suite passes 138 tests with 1,540 assertions across 23 files.
  Navigation, loading/ownership, feedback transactions, diff touch behavior, Files, line actions,
  Git inspection at all four widths, and PWA/offline/backup checks pass. The rebuilt CSS, theme
  bootstrap, and service worker match the U02 build byte for byte. The client bundle reflects
  formatted source and equivalent JSX text segments; focused interaction checks and rendering
  comparisons cover those changes.
- **Visual evidence:** fresh `qa:capture` project-entry images were inspected at phone, tablet
  portrait, tablet landscape, and desktop sizes. All four PNGs match the accepted U02 captures byte
  for byte: [phone](../qa/screenshots/usability-u02-project-entry/mobile.png),
  [tablet portrait](../qa/screenshots/usability-u02-project-entry/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/usability-u02-project-entry/tablet-landscape.png), and
  [desktop](../qa/screenshots/usability-u02-project-entry/desktop.png). Their manifests report no
  page-wide overflow. Identical comparison copies and diagnostics stay in ignored
  `qa/.artifacts/formatting-project-entry-check/` and
  `qa/.artifacts/formatting-capture-comparison.json`, avoiding duplicate milestone assets.
- **Delivery:** rebuilt assets are available for the maintained app; both maintained backends have
  been restarted to load the formatted server sources. App and root API health checks return 200 on
  both backends and the private HTTPS origin, and all four served assets match the final build. The
  isolated QA server on port 39911 was stopped after checks.
- **Limits and review:** browser checks use Chrome emulation; this formatting pass adds no new
  real-device evidence. Hooks were verified through Git's CLI on this Mac, without separately
  testing another Git GUI. The maintainer accepted the formatting and tooling, explicitly approved
  the commit, and requested continuation with the agreed U03 file-feedback slice. Maintenance
  remains paused; U03 receives its own uncommitted review.
