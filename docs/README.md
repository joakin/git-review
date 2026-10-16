# Documentation guide

Documentation has three roles:

- [`current/`](current/): concise, authoritative information about the project today. Keep plans,
  delivery logs, approvals, and links to drafts or history out of these guides and package READMEs.
- [`drafts/`](drafts/): research, proposals, and work in progress, including work awaiting
  maintainer review. State the scope, status, decisions, and open questions.
- [`history/`](history/): useful completed or superseded records. They provide historical context
  and do not instruct current work. Git retains deleted text and the detailed development history.

Give each fact one owner. Code and executable configuration own exact types, schemas, supported
values, limits, dependencies, and command options. Explain purpose, important behavior, and
non-obvious decisions in docs; link to their definitions instead of transcribing them. Package
READMEs describe implemented responsibilities. Record task-specific checks, measurements, and review
outcomes in the handoff or a draft, rather than appending them to current guides.

## Current guides

- [Project purpose, scope, and limitations](current/project.md)
- [Development conventions and tool setup](current/development.md)
- [Research, implementation, review, and commit workflow](current/workflow.md)
- [Workspace map and package documentation](current/workspace.md)
- [Architecture, trust boundaries, and state lifetimes](current/architecture.md)
- [Operation, installation, and deployment](current/operations.md)
- [Testing, fixtures, and visual QA](current/testing.md)

## Drafts and completion

- [Cloud deployment verification](drafts/2026-10-16-cloud-verification.md): deferred pending a
  compatible provider and physical-device evidence; no implementation is scheduled by this record.

Create a dated draft only when a durable record helps; small tasks do not need one. On maintainer
acceptance, reconcile lasting decisions into their current owner and move a useful draft to history.
Record the disposition of abandoned or replaced proposals too. Delete redundant records and repair
links instead of keeping pointer-only files. Historical screenshot sets remain under
[`qa/screenshots/`](../qa/screenshots/), with their capture manifests.
