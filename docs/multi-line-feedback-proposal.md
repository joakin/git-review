# Multi-line selected-code feedback — closed

Status: completed and closed on 2026-10-10. The maintainer approved the approach and authorized
autonomous implementation, an independent review, QA and a commit after each stage, followed by a
cleanup pass. Git preserves the original investigation, proposal and implementation sequence.

The [Feedback record](feedback-slice-proposal.md) owns selection, mixed Old/New ranges, markers,
checking, reattachment, export, exact history and Undo. Its
[verification record](feedback-slice-proposal.md#verification-and-evidence) retains the browser and
screenshot evidence. The
[local-data record](independent-tabs-and-pwa-proposal.md#local-data-and-backups) owns the protected
conversion of the immediately preceding store and backup formats. The [QA workflow](qa-workflow.md)
owns fixture setup and runnable checks.

1. Model, persistence and checking: `54eb347`. Added bounded range subjects, all-component checking,
   exact export/snapshots and deliberate predecessor conversion. Independent review's short-viewport
   source-quote issue was repaired and verified before commit.
2. Files and Search: `e97ebd1`. Added native multi-line capture, exact endpoints, complete source
   snapshot invalidation, covered-line markers and selection reattachment. Independent review found
   no remaining blockers and checked actual desktop dragging and keyboard invocation.
3. Working-copy diffs: `c5f3004`. Added Old/New/mixed ranges, revealed-context support and
   hidden-gap rejection. Independent review found no blockers; the rendering check's stale observer
   was repaired so it now verifies mounted code and visible marker updates.
4. Final cleanup: replaced the nested side-choice logic with an explicit helper and preserved Old
   context preference when its first anchor is unavailable. The regression test and independent
   correctness/simplification review passed. Folded the completed contract and evidence into their
   owners instead of retaining a second specification.

All stages received independent review and own testing. Historical Git comments, whole-file/project
notes and a separate gutter range picker remain outside the accepted slice. Physical iOS/Android
selection handles, gestures, keyboard and clipboard permissions remain unverified.
