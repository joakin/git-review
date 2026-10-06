# Maintenance plan

Status: M01–M14 accepted and committed; M15 pending. Maintenance paused.

Updated: 2026-10-06

## Scope and stop boundary

This bounded pass fixes review defects, removes obsolete material, and gives repeated mechanisms and
state lifetimes clear owners. Stop after M15 is reviewed and closed; do not pick further work from
the [optional backlog](initial-implementation-plan.md#remaining-roadmap). The separately agreed
[stateless project access](stateless-project-access-plan.md) remains deferred.

Follow [AGENTS.md](../AGENTS.md), [engineering conventions](engineering-conventions.md), and the
[QA workflow](qa-workflow.md). Keep each new slice uncommitted until the maintainer approves it.

## Completed work

- M01–M05: corrected scoped media, transcription errors, feedback transactions, QA output placement,
  and obsolete UI/CSS, including canceled project opening.
- M06–M12: shared cache, validation, diff loading and server read boundaries; tightened contracts
  and gave client state cohesive owners.
- M13–M14: shared browser/test setup, reduced QA package commands to two, and curated screenshots.

Implementation details, dated checks, and approvals are recoverable from Git. Current contracts and
QA procedures belong in the [behavior records](README.md#behavior-records) and QA workflow. Keep
this plan limited to current status, unresolved decisions, and the next step; do not append
duplicate execution logs.

## M15 — Measure repeated historical commit work

Historical diff and raw-media requests reread commit detail/inventory; expanded cards repeat work
per file. User-visible cost has not been measured.

1. Measure subprocess counts and request latency for an ordinary commit and a larger commit with
   text and media, cold and repeated requests, and an approved repository subfolder.
2. If the cost is material, propose the smallest useful bounded project/commit cache or narrower
   comparison lookup. Agree freshness and invalidation before implementing caching. If the cost does
   not justify a change, close M15 with a brief measurement result and maintainer review.
3. Preserve project revalidation, scope, limits, process failures, and missing-parent recovery:
   unavailable shallow comparisons can become available later.

Next, when resumed: begin M15 measurement. No optimization has been selected.
