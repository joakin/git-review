# Repository formatting

Use the locally installed pinned formatter and staged-file tools from
[package.json](../package.json). Configuration lives in [.prettierrc.json](../.prettierrc.json),
[.editorconfig](../.editorconfig), and [.prettierignore](../.prettierignore); those files own exact
format choices and exclusions.

## Formatter and commands

- `bun run format` formats eligible source, styles, configuration, scripts, and documentation.
- `bun run format:check` verifies without writing; it also runs in `bun run qa:check`.
- `bun run format:staged` runs the same staged-file task used by the Git hook.
- `bun install` activates hooks through `prepare`; `bun run prepare` reactivates them in an existing
  checkout. Before committing in a fresh checkout, run `bun run secrets:install` once to install the
  pinned local scanner; this requires network access and `tar` on macOS or Linux.

Generated dependencies, build/QA output, raster assets, and the lockfile retain their generator's
format. Keep normal multiline source/Markdown layout and let the formatter own whitespace.

## Commit behavior

[The pre-commit hook](../.husky/pre-commit) runs the installed lint-staged task, then checks the
staged diff with the pinned local secret scanner. The hook downloads nothing and fails with setup
instructions if the scanner is missing. It formats and stages eligible staged files, preserves
unstaged edits including partial staging, and respects ignore rules. A formatter failure blocks the
commit with backup/restoration behavior enabled. The generated Husky wrapper is ignored; the hook
source is tracked.

`bun run secrets:check --staged` checks the index; `bun run secrets:check` checks all locally
available Git history, including deleted files. The [scanner script](../scripts/check-secrets.ts)
owns the pinned Gitleaks release, supported platforms and verified download hashes. Scans stay
local, redact findings in output and do not create report files. Dotenv files are ignored, with
explicit exceptions for sanitized example/template files. Review those examples before committing
them. The [CI workflow](../.github/workflows/check-secrets.yml) fetches full history and runs the
same scanner on pushes, pull requests and manual dispatch, with read-only repository permissions and
no security-report upload. Pattern detection is a safeguard, not proof that arbitrary data is
public.

The hook does not authorize a commit. Completed work remains uncommitted until the maintainer
explicitly approves it under [AGENTS.md](../AGENTS.md).

## Verification

Run `bun qa/check-format-hook.ts` when changing formatter or hook setup. The
[script](../qa/check-format-hook.ts) uses an isolated Git fixture to exercise actual hook
installation, partial staging, unusual names, ignored/generated files, deletions, and failure
rollback. It does not modify this checkout's index. `bun qa/check-secrets.ts` uses synthetic
credentials in an isolated repository to verify staged-only checks, redaction, dotenv ignores and
detection after a file is deleted from history's current tip. General delivery checks belong in the
[QA workflow](qa-workflow.md).

The accepted formatting setup was verified through Git's CLI on this Mac; another Git GUI and
physical devices were not separately checked. Git preserves the original formatting equivalence,
installation, and delivery record.
