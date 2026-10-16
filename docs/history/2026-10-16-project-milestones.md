# Project milestones

Historical context, not instructions or authorization for current work. Git retains the original
proposals, delivery records, and approvals.

- The initial implementation was accepted on 2026-09-30, with Git inspection included in baseline
  `22de40e`.
- The M01–M15 maintenance pass closed on 2026-10-06. Stateless project access replaced server
  registration and was accepted separately.
- The S01–S23 simplification pass closed on 2026-10-07. It clarified domain, validation, loading,
  transaction, and QA boundaries. Its autonomous commit authorization applied only to that queue.
- Subsequent work added rendering isolation/containment, context expansion, batched source checks,
  multi-line feedback, independent web/agent artifacts, endpoint-owned persistence, saved-feedback
  recovery, host management, and collapsible Changes sections. Their current behavior belongs in the
  [package documentation](../current/workspace.md).

## Prior ideas

The earlier optional roadmap included recent files, file-specific Git history, complete historical
trees and comments, PDF preview, moved-block indicators, and a phone list/content swipe. None is an
assigned task. HTML preview was not planned. New features still require an agreed useful slice.

The maintainer previously reported working phone installation, selected-code Search, and dictation.
The records did not establish exhaustive iOS/Android coverage. Further native selection, clipboard,
keyboard, recording-interruption, and performance checks remain device-specific work when relevant.

Detailed historical screenshots remain with their manifests under
[`qa/screenshots/`](../../qa/screenshots/). The
[performance investigation](2026-10-07-long-diff-performance.md) retains measured rendering results;
[feedback measurements](../../qa/measurements/feedback-check-performance.json) retain the
batch-check comparison data. Other dated assertions and superseded specifications can be recovered
from Git.
