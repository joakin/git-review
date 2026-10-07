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
  checkout.

Generated dependencies, build/QA output, raster assets, and the lockfile retain their generator's
format. Keep normal multiline source/Markdown layout and let the formatter own whitespace.

## Commit behavior

[The pre-commit hook](../.husky/pre-commit) runs the installed lint-staged task without downloading
tools. It formats and stages eligible staged files, preserves unstaged edits including partial
staging, and respects ignore rules. A formatter failure blocks the commit with backup/restoration
behavior enabled. The generated Husky wrapper is ignored; the hook source is tracked.

The hook does not authorize a commit. Completed work remains uncommitted until the maintainer
explicitly approves it under [AGENTS.md](../AGENTS.md).

## Verification

Run `bun qa/check-format-hook.ts` when changing formatter or hook setup. The
[script](../qa/check-format-hook.ts) uses an isolated Git fixture to exercise actual hook
installation, partial staging, unusual names, ignored/generated files, deletions, and failure
rollback. It does not modify this checkout's index. General delivery checks belong in the
[QA workflow](qa-workflow.md).

The accepted formatting setup was verified through Git's CLI on this Mac; another Git GUI and
physical devices were not separately checked. Git preserves the original formatting equivalence,
installation, and delivery record.
