# Directional diff context expansion — closed

The maintainer approved the Changes slice on 2026-10-08: twenty lines per click from either end of
an omitted interval, bar-and-arrow icons, bounded reads, and feedback on revealed code.
Implementation and independent review are complete. The original investigation and implementation
sequence remain in Git; this record retains the accepted scope and points to its owners.

[Diff cards](diff-slice.md#revealing-unchanged-context) own the flow, gaps, source capability and
expansion lifetime. [Feedback](feedback-slice-proposal.md#anchor-identity-and-checking) owns exact
source-side anchors and fresh checks after reload. [Syntax](syntax-highlighting-slice.md) owns
complete-source highlighting, and [loading](loading-and-transition-polish.md#diff-cache-scope) owns
resource/version boundaries. The [QA workflow](qa-workflow.md) provides the fixture and browser
check.

Historical expansion, whole-file expansion, context-size preferences, re-collapsing individual gaps
and bounded extraction from sources beyond the current read capability remain follow-ups. No source
cache or new dependency was required. Physical-device gestures remain unverified.
