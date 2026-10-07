# Git read boundaries

The transport is shared across working-copy review, historical inspection, statistics, and media.
Each domain retains command selection, parsing, scope, and freshness policy.

## Transport and source scope

[Git execution](../src/server/git-execution.ts) uses fixed read commands with argument arrays and
literal pathspecs. Its environment disables optional Git writes and fsmonitor hooks and stabilizes
parsed output. Buffered reads enforce caller-selected output budgets and command deadlines; streamed
reads enforce byte budgets and own EOF, error, and cancellation cleanup. A stream deadline applies
while a read is awaited, so playback backpressure does not become a total playback deadline. Closing
a stream is idempotent and revokes pending reads.

[Repository context](../src/server/git-context.ts) validates worktree detection, UTF-8 prefixes,
object format, and complete object IDs. Project-relative source paths are translated within the
repository. Rename origins may leave the selected subtree; they may not leave the repository, and
working-copy callers also enforce the approved root. Context belongs to the current validated
project, not a cached authorization.

[Object access](../src/server/git-objects.ts) owns object-kind checks, safe-size inspection, and
bounded blob reads. HEAD lookup from a selected subfolder must preserve that scope even when an
outside file has the same name; index lookup must match the exact stage-zero literal path. Syntax
reads use exact source objects without text conversion.

## Domain policy

HTTP handlers first apply the [project contract](stateless-project-access-plan.md). No API accepts
arbitrary subprocess commands. [Status](git-status-slice.md) owns mutable inventory/version parsing;
[diffs](diff-slice.md) own patch/source results; [history](git-history-slice-proposal.md) owns
immutable comparisons and unavailable parents; [working counts](changes-line-counts-proposal.md) and
historical totals own their distinct failure and cache policies. They share
[numstat parsing](../src/server/git-numstat.ts), not their semantics.
[Media](media-preview-slice-proposal.md) owns source/version mapping and range responses.

Checked working-tree reads use the separate [file boundary](working-file-boundaries.md). Git object
identity, filesystem identity, and mutable content versions are different guarantees and must not
substitute for one another. Exact subprocess limits and environment settings belong in the linked
source; [execution tests](../src/server/git-execution.test.ts),
[object tests](../src/server/git-objects.test.ts), and domain tests protect the observable
boundaries.
