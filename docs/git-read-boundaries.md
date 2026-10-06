# Git read boundaries

Status: M11 accepted and committed as `e9da16a` on 2026-10-05

The server shares subprocess execution, repository context and object access across working-copy
review, historical inspection and media. The public APIs and domain source/version policies retain
their existing contracts.

## Shared ownership

[git-execution.ts](../src/server/git-execution.ts) owns buffered and streamed Git processes. Both
use argument arrays, literal pathspecs, `core.fsmonitor=false`, `LC_ALL=C` and
`GIT_OPTIONAL_LOCKS=0`. Buffered reads retain their caller-selected output budget (8 MiB by
default), ten-second command deadline, optional batch input and typed `GitCommandError`. Streamed
reads take an explicit byte budget, retain a bounded diagnostic message, and own
EOF/error/cancellation cleanup. A ten-second deadline applies only while a read is awaited; it does
not run while playback backpressure pauses the consumer. Closing a stream is idempotent and prevents
a pending read from supplying more bytes.

[git-context.ts](../src/server/git-context.ts) owns worktree detection, strict UTF-8 prefix parsing,
repository object format and complete object-ID validation against that format. It translates
project-relative source paths to repository paths. Rename origins can leave the selected subtree,
but translation cannot leave the repository; the diff caller still checks the approved root before
reading an origin. Context is read for the current validated project rather than globally cached.
Status uses worktree detection and prefix lookup without adding an object-format subprocess.

[git-objects.ts](../src/server/git-objects.ts) owns object-type checks, safe byte sizes, bounded
blob reads and HEAD/index/object lookup. It accepts complete SHA-1 or SHA-256 object IDs. HEAD media
lookup retains `HEAD:./path` from the selected project's working directory; this preserves subfolder
scope even when the repository root has an outside namesake. Index lookup retains literal pathspecs
and exact stage-zero path matching. Syntax source reads take a checked repository-relative path and
retain the existing no-textconv HEAD/index commands and byte budgets.

## Domain ownership

HTTP handlers still revalidate an opened project against its approved root before invoking Git.
Callers choose fixed read commands; there is no endpoint accepting arbitrary subprocess arguments.
The runner is a transport boundary, while each domain owns its command selection and parsing:

- [Status](../src/server/git-status.ts) parses porcelain and computes revision/change tokens.
- [Diffs](../src/server/git-diff.ts) parse patches and preserve source text, syntax fallback,
  containment and mutable stale/size-limit policy.
- [History](../src/server/git-history.ts) parses refs, metadata and raw file inventories, preserving
  exact immutable comparisons, unborn/detached/shallow states and missing-parent behavior.
- [Statistics](../src/server/git-stats.ts) owns batch-parent and numeric-diff parsing, limits and
  its immutable totals cache.
- [Media](../src/server/media.ts) owns format/header checks, source mapping and version matching;
  [media streaming](../src/server/media-stream.ts) owns range/HEAD responses and byte slicing.
  [Checked working-file access](working-file-boundaries.md) shares containment and descriptor
  identity/lifetime checks; media retains its content versions.

Generic unknown-value guards come from [shared validation](../src/shared/validation.ts).
Git-specific parsers stay at their domain boundaries. Filesystem `AppError` remains in
[paths.ts](../src/server/paths.ts). [M12](working-file-boundaries.md) owns shared checked
working-file opening separately from Git object access.
