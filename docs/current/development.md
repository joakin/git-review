# Development conventions

## Toolchain and package boundaries

Use Bun for installation, application execution, builds, and tests. Run commands from the repository
root unless a guide says otherwise. The root [manifest](../../package.json),
[lockfile](../../bun.lock), and TypeScript configurations own the installed versions and compiler
settings. Use the project-local TypeScript 7 native compiler and keep the strict checks enabled.

Web and agent consume shared code through declared `@git-review/shared/<subpath>` exports; neither
application imports the other. Shared code has no host-runtime or third-party dependencies. Root
scripts, QA, and integration tests may compose the applications deliberately. The
[workspace map](workspace.md) identifies owners; the
[package check](../../qa/check-package-boundaries.ts) enforces production imports.

Organize modules around coherent responsibilities and lifetimes. Keep validation, freshness,
cancellation, persistence, and transactions with their owners. Expose operations and explicit view
models rather than internal state setters. Add an abstraction when it removes demonstrated
repetition or coordination; preserve meaningful differences between domains.

## Types and untrusted data

Treat HTTP, Git/subprocess output, filesystem data, browser storage, and imported state as
untrusted. Parse at the boundary and pass precise validated values inward. Reuse
[generic validation helpers](../../packages/shared/src/validation.ts), while keeping domain parsers
with their formats. Validate relationships and work budgets, not just field shapes. Report useful
failures rather than accepting partial data.

Use discriminated unions and purpose-built records for distinct states. Avoid `any`, non-null
assertions, pervasive optional fields, and casts that hide uncertainty. An assertion does not
validate a value. Keep coupled values in one contract; transformations must accurately type what
they change.

Use the agent's checked filesystem and Git access boundaries. Keep paths within approved roots and
pass subprocess arguments as arrays without a shell. The [agent README](../../apps/agent/README.md)
explains those guarantees and their limits. The
[web data owner](../../apps/web/README.md#local-data) defines supported persisted formats and
conversion.

## UI and asynchronous work

URLs own navigable destinations. Define each resource's identity, version, and lifetime before
choosing a cache. Start work promptly, reject superseded results, and retain loaded content only for
a refresh of the same resource. Abort alone is insufficient: completion must still belong to the
current operation.

Give side effects one owner through completion. Merge only results the operation is entitled to
change and preserve edits made while it was pending. Serialize effects when overlap can violate an
invariant. Cancellation revokes permission to apply a result even when the underlying action cannot
be stopped.

Use [design tokens](../../apps/web/src/design-tokens.css) for shared visual roles and keep
responsive rules with their components. Reuse [Icons](../../apps/web/src/Icons.tsx) and
[SelectControl](../../apps/web/src/SelectControl.tsx) for existing control patterns. Preserve touch
targets, keyboard focus, wrapping, contained horizontal scrolling, and narrow layouts. Rebuild
assets after frontend edits and restart the relevant server after backend edits; keep the
maintainer's review service available.

## Formatting and commit tools

Run `bun run format` after edits and `bun run format:check` before delivery. The
[Prettier configuration](../../.prettierrc.json), [ignore file](../../.prettierignore), and
[EditorConfig](../../.editorconfig) own whitespace and generated-file exclusions. Use normal
multiline formatting.

`bun install` activates [Husky](../../.husky/pre-commit); `bun run prepare` reactivates hooks in an
existing checkout. Before committing in a fresh checkout, run `bun run secrets:install` to install
the checksum-pinned local Gitleaks binary (network access and `tar` are needed). The hook downloads
nothing. It formats eligible staged files through lint-staged, preserving unstaged edits and partial
staging, then scans the index. A failed formatter or scanner blocks the commit.

`bun run secrets:check --staged` scans the index; `bun run secrets:check` scans all locally
available Git history. The [scanner](../../scripts/check-secrets.ts) owns versions and supported
platforms. Findings are redacted and stay local; [CI](../../.github/workflows/check-secrets.yml)
uses the same scanner. Sanitized dotenv examples still need inspection. A passing scan does not
prove arbitrary data is safe to publish.

See [testing](testing.md) for change-specific checks and [workflow](workflow.md) for approval and
staging. Tool hooks never authorize a commit.
