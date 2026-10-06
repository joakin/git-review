# Maintenance plan

Status: M01–M15 accepted; maintenance pass complete and closed.

Updated: 2026-10-06

## Scope and stop boundary

This bounded pass fixes review defects, removes obsolete material, and gives repeated mechanisms and
state lifetimes clear owners. Stop after M15 is reviewed and closed; do not pick further work from
the [optional backlog](initial-implementation-plan.md#remaining-roadmap). The separately agreed
[stateless project access](stateless-project-access-plan.md) is now being implemented in its own
work plan.

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

The cost warrants a small optimization. Local fixtures contain 12 and 220 changed files, including
TypeScript, SVG and WAV. Requests cover commit detail, plain/highlighted text, raw images and audio
ranges, at the repository root and an approved subfolder. Git Trace2 counts subprocesses; separate
untraced runs time detail plus all file requests with three concurrent requests. Cold means a fresh
server, not a flushed OS cache. These are local API measurements, not device timings.

| Scope              | Files | Cold batch, before → after | Repeated batch, before → after | Repeated Git calls, before → after |
| ------------------ | ----: | -------------------------: | -----------------------------: | ---------------------------------: |
| Ordinary root      |    12 |            0.46 s → 0.41 s |                0.36 s → 0.29 s |                          148 → 109 |
| Ordinary subfolder |     6 |            0.30 s → 0.28 s |                0.20 s → 0.16 s |                            78 → 57 |
| Larger root        |   220 |            6.67 s → 5.84 s |                6.51 s → 5.72 s |                      2,468 → 1,805 |
| Larger subfolder   |   110 |            3.49 s → 3.03 s |                3.36 s → 2.89 s |                        1,238 → 905 |

Repeated detail reads fall from eight Git calls to five, with untraced median latency falling from
35–36 ms to 22–24 ms. The first detail read still performs the full lookup; subsequent cards and raw
image/audio requests reuse its validated metadata and inventory.

Implemented the approved 64-entry/4-MiB server cache using the shared bounded mechanism. Its
[data lifetime policy](git-history-slice-proposal.md#data-lifetime) owns keys, revalidation,
eviction and unavailable-result recovery. API shapes, blob reads, scope, limits and errors retain
their existing boundaries.

M15 reviewed and approved for commit on 2026-10-06. The maintenance pass is closed; stop here. No
further maintenance or optional backlog work follows this pass.
