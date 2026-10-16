# Working workflow

Keep the maintainer's understanding central. Work in small, reviewable steps, surface uncertainty
early, and explain significant behavior and design decisions. Existing authorization remains
sufficient within its agreed scope.

## Research and implementation

Inspect the working tree and index first. Preserve unrelated changes, including anything already
staged by the maintainer. Read relevant current guidance, code, and checks before changing behavior.

Before a new feature, explain the user flow, affected data/API boundaries, edge cases, verification,
and smallest useful slice. Obtain agreement before implementing; routine fixes and already-agreed
work can proceed. Return to the maintainer when a material decision changes or missing information
blocks the agreed work.

Use a dated draft only when research or work in progress benefits from a durable record. Keep task
status, unresolved questions, verification, and review outcomes there or in the conversation.
Current guides and package READMEs describe the implemented project. Follow the
[documentation lifecycle](../README.md) at completion.

Implement the agreed scope, update its documentation owner, and run appropriate
[checks](testing.md). Keep the maintainer's app available and use isolated QA fixtures and ports.
Stop only QA processes started for the task.

## Independent review

After implementation, use one fresh independent review agent without the author's conversation or
rationale. Give it the requirements, repository guidance, and access to the actual changes and
surrounding code. The reviewer reports actionable findings with locations and impact; it does not
edit the implementation.

Review correctness and failures, simplicity, readability, boundaries, useful test coverage, and
documentation accuracy. For documentation work, also inspect duplication, navigation, and whether
each fact belongs in its location.

Assess findings, fix warranted issues, and explain any declined finding. Re-run affected checks.
Obtain another focused pass when material fixes or unresolved concerns justify it. Report if
independent review is unavailable. Review does not authorize a commit.

## Maintainer feedback, staging, and commits

By default, leave implementation and independent-review fixes unstaged and uncommitted. Present the
result with checks, findings, limitations, and useful links. Agreement to implement does not itself
authorize a commit.

When the maintainer gives feedback, stage the preceding task iteration as the review baseline, then
leave the new edits unstaged. Repeat for later feedback rounds. Use path- or hunk-specific staging
and preserve unrelated work. Ask only if task and unrelated changes cannot be safely separated.
Internal reviewer feedback does not trigger this baseline rule.

Commit only with explicit maintainer authorization. An explicit instruction to finish autonomously
and commit logical steps authorizes commits within that task; it does not authorize unrelated work
or later tasks. Otherwise obtain final staging/commit approval after maintainer review. Never infer
approval from a historical record.

On task acceptance, reconcile lasting decisions into their owner, archive useful drafts, and repair
links. Include completion edits within the approved scope. Report the final result, commit/staging
state, checks, and material limitations.
