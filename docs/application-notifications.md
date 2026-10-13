# Application notifications

The notification system and visual refinements were reviewed and approved on 2026-10-08. This record
owns application-wide delivery; source and domain records own the conditions that produce notices.

## Inventory and migration

| Area                                         | Previous presentation                                                                                      | Current treatment                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App, project session and working-copy review | Dismissible notice above the content heading; root/project errors repeated in the sidebar and content      | Central notices, with one message per failure and the appropriate recovery action                             |
| Changes                                      | New-edits button/announcement in the heading; repeated-check error below it; inventory errors in two panes | Persistent new-edits notification with Update; persistent check/load errors with Refresh or Retry             |
| Files and Search                             | Changed search-result warning above file contents; directory/file/search load errors and Retry blocks      | Persistent notifications scoped to the current resource, retaining retry actions                              |
| Git                                          | Ref/history/detail/pagination errors in content or sidebar                                                 | Resource-scoped notifications with retry actions; preserve already loaded history                             |
| Diff cards and context                       | Load errors in cards; context errors beside gaps or above code                                             | Notifications naming the affected file, with Retry where supported; remove alerts from code layout            |
| Feedback                                     | Check, copy and Undo errors inside the dialog; copy-history and draft-limit notices above the main view    | Persistent failure notifications above the active dialog; temporary success confirmations                     |
| Install and local data                       | Backup/install errors and export confirmations inside the dialog                                           | Persistent errors and temporary export confirmations above the active dialog                                  |
| Voice                                        | Permission/recording/transcription errors in the composer footer                                           | Persistent notifications; retain the recorder's status and Retry/Cancel controls in the composer              |
| Media                                        | Failed preview and unsupported-format explanations in the preview                                          | Failed reads become notifications; the preview retains a compact unavailable-content placeholder and Open raw |

Empty/loading states, unavailable-content explanations (binary, symlink, size limit, missing Git
parent, unavailable diff context), result counts and recorder progress remain with their content.
These describe the resource or ongoing interaction. An outdated feedback item's state and Reattach
action also stay with that item so the affected comment remains identifiable after a toast is
dismissed. Error details and temporary announcements use the central system.

## User flow

Notifications appear in a fixed, bottom-centered stack without changing page or dialog layout. They
use the current app theme, wrap long messages and paths, and have touch-sized dismiss/action
controls. Messages, icons and controls are vertically centered. Recovery actions sit beside the
message with a compact visible outline and a full touch target. The scroll container leaves room
around the cards for their shadows. The stack respects safe-area insets and the visible viewport
when a virtual keyboard is open. Its height is bounded with scrolling so multiple persistent
messages remain reachable. Page notifications sit above the floating Feedback/history controls.
Modal placement also keeps footer, close, voice and backup controls reachable when they intersect
the notification stack.

Each notification has a severity, message, optional recovery action and explicit dismissal. Warnings
and errors remain until dismissed or their source resolves. Brief confirmations disappear after a
timeout; timeout is optional in the API and pauses during hover, keyboard focus and while the tab is
hidden. Arrival does not move focus. Screen readers receive polite notices and urgent error
announcements without repeated announcements from polling or ordinary rerenders.

New edits produce a persistent notification with Update. Dismissing it does not accept a new
snapshot; the existing Refresh control remains available. A successful refresh clears the condition,
and subsequent edits can notify again. Code, drafts, expansion and reading position retain their
existing ownership.

Notifications remain visible and interactive above native modal dialogs. The viewport belongs to the
active dialog while one is open and uses a manual popover in the browser top layer; it returns to
the page when the dialog closes. Clicking a notification must not trigger backdrop dismissal. There
is a fixed-position fallback for browsers without popover support, with the same active-dialog
ownership. The top-layer behavior is described in the
[Popover API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using).

## Data and API shape

Notifications live in tab memory, with one provider and viewport and no server API or additional
dependency. The [store](../apps/web/src/notification-store.ts) owns the typed push operation,
accepting a message, severity, optional deduplication key, optional action and timeout (a duration
or no timeout), and returns an identifier. Dismissal and replacement use that identifier/key.

The [notification hook and layer](../apps/web/src/Notifications.tsx) deliver notices derived from a
current condition. The hook creates a message only when that condition appears or meaningfully
changes, updates its action without reannouncing it, and removes it when the condition resolves or
the resource unmounts. A dismissed condition stays dismissed until it resolves or changes; failed
periodic checks cannot continually recreate it. Resource identity belongs in the key so late or old
errors cannot appear to describe another file, project, query or commit. Domain cancellation checks
remain authoritative for asynchronous results.

## Verification and device limits

[Lifetime tests](../apps/web/src/notification-store.test.ts) cover persistence, optional expiry,
overlapping pauses, hidden-tab arrivals, deduplication, replacement and timer cleanup.
[Browser QA](../qa/check-notifications.ts) owns responsive geometry, dismissal, resource cleanup,
native modal layering and timed-confirmation scenarios. The existing live-change, diff-context,
feedback and Git checks cover their migrated recovery actions.

Milestone captures show a
[stale-file notification](../qa/screenshots/notifications-stale-file/mobile.png), a
[compact Update action](../qa/screenshots/notifications-compact-update/mobile.png), a
[centered confirmation above local data](../qa/screenshots/notifications-centered-confirmation/mobile.png)
and initial [feedback modal layering](../qa/screenshots/notifications-feedback-copy/mobile.png).
Each folder includes phone, tablet portrait, tablet landscape, desktop and a manifest. The
[QA workflow](qa-workflow.md) owns commands and evidence limits. Physical iOS/Android keyboard,
safe-area and screen-reader behavior require separate verification.
