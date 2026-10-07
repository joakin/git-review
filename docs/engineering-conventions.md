# Engineering conventions

Use these principles when designing or changing code. Current user flows and domain contracts belong
in the [behavior records](README.md#behavior-records). Keep active work and unresolved decisions in
the record for that work; closed plans retain scope, acceptance, and stop boundaries. Use Git for
implementation and dated review history, and the [QA workflow](qa-workflow.md) for verification
procedures. Document a rule here when it guides future decisions across changes.

## Code organization and interfaces

Use the repository's pinned Prettier configuration for TypeScript/TSX, CSS, HTML, JSON, SVG, and
Markdown. Run `bun run format` after edits and `bun run format:check` before delivery; the latter
also runs in `qa:check`. Keep indentation, wrapping, and multiline layout under the formatter rather
than packing statements, JSX, or CSS rules by hand. The
[formatting workflow](formatting-workflow.md) describes automatic staged-file formatting and its
installation.

Group code by responsibility and data lifetime. A module should own a coherent policy—validation,
freshness, cancellation, persistence, or a transaction—and expose operations that let callers use it
without coordinating its internals. Split large files when that creates a clear owner, rather than
merely moving fragments elsewhere.

Give views explicit models and commands sized to their job. Keep domain decisions in their owner;
presentation should depend only on the data and commands it needs, without exposing its owner's
internals or setters. Keep implementation details private by default. Share mechanisms when their
rules are the same, while leaving identity, lifetime, and failure policy with each domain. Avoid
utility collections with unrelated responsibilities and abstractions that erase meaningful
differences between resources.

Use precise records and discriminated unions for distinct states. Internal functions should accept
and return only the states they support. Couple values whose consistency is required in one
contract. A transformation's type must allow the fields it changes to change; do not promise to
preserve arbitrary caller refinements. Prefer explicit contracts over casts, pervasive optional
fields, or interfaces inferred from another module's whole implementation.

## Runtime validation

Treat external data as unknown until it crosses a validating boundary. Keep domain parsers beside
their formats and reuse [shared validation helpers](../src/shared/validation.ts) for generic checks.
Once validated, pass precise domain values internally. Report a clear failure rather than silently
accepting partial or ambiguous data.

Validate relationships as well as field shapes. Bound input size and expensive work before
processing it. Keep paths within approved roots, avoid following untrusted links, and pass
subprocess arguments as arrays without a shell. This unreleased app accepts its current persisted
formats; it does not promise migrations or earlier-format import. Document an approved format break
and its effect on user work in the owning
[local-data record](independent-tabs-and-pwa-proposal.md#local-data-and-backups). Keep
current-format validation and useful runtime recovery separate from obsolete-format support.

Use the [shared Git read boundaries](git-read-boundaries.md) for subprocess execution, repository
context and bounded object access. Domain callers choose fixed read commands and interpret results;
the shared transport owns literal argument handling, environment overrides, limits and process
cleanup. Stream deadlines cover awaited reads, so consumer backpressure does not impose a total
playback deadline. Keep approved-root checks, domain parsers and unavailable/stale policies at their
existing boundaries.

Use [checked working-file access](working-file-boundaries.md) for shared path validation,
containment, no-follow opening and file/parent identity rechecks. Bounded readers use the scoped
operation so cleanup and post-read checks stay with that owner. Streaming transfers descriptor
ownership explicitly to its response owner. Domain callers retain byte limits, decoding, source
normalization and content-version policy; an unchanged inode alone does not establish unchanged
content.

## Browser navigation

URLs own navigable destinations. Local state owns transient interaction, unsaved work, and
preferences. Avoid a second source of truth for the same destination.

Apply navigation intent synchronously enough that pending work can check the latest destination.
Responses, focus, and scroll restoration must belong to that destination and its current data. Save
user edits before navigation discards their editor. Tie focus and scrolling to explicit navigation
intent; expanding a card, refreshing data, or changing a preference must not repeat that intent.

## Loading, data lifetime, and scroll

Define each resource's identity, version, and lifetime before choosing its state or cache. Mutable
resources, pinned snapshots, and immutable objects need distinct freshness policies. Cache shared
mechanics behind a small interface; keep resource keys and invalidation with the domain owner.

Start requests promptly and delay transient loading indicators without delaying the work. Retain
usable content during a same-resource refresh, but never show one resource's data as another's.
Abort superseded work and reject late results before updating state or caches. Bound retained data
and exclude invalid or failed results from reusable caches. Restore reading position only when the
corresponding content is available.

Choose persistence deliberately. Preferences, user-authored data, and fetched payloads have
different retention and compatibility needs; they should not inherit a storage policy merely because
they share a component.

## Asynchronous transactions

Give each operation one owner for its snapshot, cancellation, and completion. On completion, read
current state and verify that the operation still owns the result. Merge only the fields or versions
that the operation is entitled to change, preserving edits made while it was pending. A captured
render or store is not a safe replacement for current state.

Serialize side effects when overlap could violate an invariant, retaining ownership until they
settle. Cancellation revokes permission to apply a result even when the underlying work cannot be
stopped. Failures should preserve user work and leave a clear recovery path. Keep these rules in the
operation owner, rather than requiring every caller to coordinate them.

## Visual design values

Use [design tokens](../src/client/design-tokens.css) for shared roles and values that need
consistent tuning. Keep application and code surfaces distinct. Give layout and component styles
clear owners; avoid competing declarations and duplicated responsive rules. Component-specific
geometry can stay beside its selector when it has no shared meaning.

Keep touch controls, keyboard focus, wrapping, and overflow usable on narrow screens. Rebuild assets
after visual changes and inspect phone, tablet, and desktop layouts through the
[QA workflow](qa-workflow.md). Browser emulation and real-device checks provide different evidence;
record which was performed.

## Documentation and verification

Document decisions, constraints, and stable contracts that a future change needs to respect. Give
each domain one behavior record and explain non-obvious reasons there. Source owns exact schemas,
supported values, constants, private function structure, and test assertions; link to those owners
instead of copying them. A measurement or product limit can remain when it explains a reviewed
tradeoff.

Start with the [documentation map](README.md#what-belongs-where). Keep operation in the root README,
shared principles here, current behavior in domain records, and runnable checks in the QA guide.
After an accepted proposal is implemented, fold its current contract into the domain owner; retain a
short pointer at an old path when useful links depend on it. Closed plans stay brief, and Git owns
superseded text and chronological delivery logs. Keep selected screenshot/measurement evidence once
with its domain and distinguish recorded evidence from new verification. Update the owner directly
rather than adding correction banners or another summary of the same contract.

Test observable behavior and durable invariants, including important failure paths. Avoid tests that
mirror private structure or incidental markup. Scale checks to the change, keep review steps small,
and state both the evidence obtained and material gaps. The [collaboration rules](../AGENTS.md) and
[QA workflow](qa-workflow.md) govern delivery.
