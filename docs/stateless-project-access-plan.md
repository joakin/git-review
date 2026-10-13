# Stateless project access

Current contract; accepted and closed on 2026-10-06.

The browser can retain its project across a server restart because each resource request resolves
its project independently. This replaced registration-dependent project IDs, which failed when a
restart cleared the server registry.

## Project contract and validation

Within one agent, the canonical absolute folder path identifies the project used by resource
requests. The browser's runtime project identity combines that path with its explicitly chosen agent
endpoint; equal paths on two agents are separate projects. New URLs carry both values, while picker
paths and recents retain root-relative browsing metadata. That relative representation is not
another identity. The server remains the authority for canonicalization and containment. Legacy URL
resolution belongs in the
[navigation owner](navigation-and-url-history-slice-proposal.md#url-and-state-shape), and current
persisted formats remain with the
[local-data owner](independent-tabs-and-pwa-proposal.md#local-data-and-backups).

Every project resource supplies exactly one bounded `projectPath` query field. Selection lookup may
canonicalize an allowed alias; subsequent reads require that returned canonical location. The
resolver checks existence, directory kind, approved-root containment, and equality with the
requested canonical path on each request. Missing, changed, and disallowed projects have distinct
errors. File absence remains a separate error so a failed project cannot mark a feedback anchor
outdated.

Project-relative file paths then pass through the
[working-file boundary](working-file-boundaries.md) or the
[Git source boundary](git-read-boundaries.md). Repositories remain read-only. No earlier metadata
lookup, cached approval, or remembered registration is a prerequisite for reading a resource.
[Project types and parsers](../packages/shared/src/api.ts),
[path syntax](../packages/shared/src/project-path.ts),
[host resolution](../apps/agent/src/paths.ts), and [HTTP handlers](../apps/agent/src/api.ts) own
exact formats, route fields, and errors.

## State and lifecycle after cutover

The host filesystem supplies current files and Git objects. Server memory holds configuration,
optional bounded caches, and active subprocess/transcription work. Restarting clears that memory; a
subsequent request resolves the folder again. A request interrupted during downtime can fail
normally, then recover through Retry after the host returns, without reselecting the folder or
reloading the page.

The browser retains its current destination, drafts, and pending editor. Reload clears tab-memory
payloads and restores current local data. Another device shares host files but has separate review
storage.
[Local-data formats and backup policy](independent-tabs-and-pwa-proposal.md#local-data-and-backups)
are owned by that record; the accepted cutover discarded old project data without migration.

Moving a folder changes its canonical identity; replacing content at the same path retains the
identity but still requires content-version and anchor checks. Project disappearance, access denial,
or changed canonical location must preserve user work for recovery rather than silently substitute
another folder.

## Same folder after an approved-root change

Changing the approved root or relative URL retains drafts, exact copied history, open cards, and
language overrides when the canonical absolute folder and browser origin are unchanged. Recents and
tab restoration remain scoped to the configured root, so an old relative destination may need a new
selection. The same relative name under a different absolute folder must not inherit review data.

Backup export includes only projects under the current approved root; valid stored data outside it
stays untouched. Import requires matching root ownership. Narrowing the root to the project itself
and later broadening it must not change that project's review identity. Containment is still checked
against the current root for every read.

## Evidence and limits

[Stateless API tests](../apps/agent/src/stateless-project-api.test.ts) cover every resource on a
fresh handler, path validation, and changed/missing projects.
[Storage](../apps/web/src/storage.test.ts) and [backup tests](../apps/web/src/backup.test.ts) cover
absolute ownership and root-scoped export. [Restart QA](../qa/check-stateless-projects.ts) owns and
restarts its isolated backend while keeping drafts/editor state, resource reads, checked copy, and
retry available. Its same-origin root changes also verify review state follows the absolute folder.
Run procedures are in the [QA catalog](qa-workflow.md#focused-checks).

The accepted cutover and root-change regression passed desktop Chrome checks. Its local-data dialog
was captured and inspected at [phone](../qa/screenshots/stateless-project-data/mobile.png),
[tablet portrait](../qa/screenshots/stateless-project-data/tablet-portrait.png),
[tablet landscape](../qa/screenshots/stateless-project-data/tablet-landscape.png), and
[desktop](../qa/screenshots/stateless-project-data/desktop.png). Physical-device gestures, installed
app restart recovery, device clipboard permission, and microphone capture were not rechecked by that
cutover. Git preserves its development and review history.
