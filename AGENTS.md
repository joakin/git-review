# Working on git-review

## Project status

The initial implementation stage is complete and closed as of 2026-09-30. The maintainer confirmed the app is usable and useful. The requested [maintenance pass](docs/maintenance-plan.md) is underway: M01–M08a are accepted and committed; the latest is reviewable comment layers, `acf06ca`. M08b couples diff card source and interaction and is accepted with explicit approval to commit. M08c parser/decorator return types are next authorized. Keep maintenance work in small reviewed steps and preserve the commit-approval rule below. The [remaining roadmap](docs/initial-implementation-plan.md#remaining-roadmap) is an optional product backlog; start further features only when the maintainer requests them.

## Collaboration

- Work in small, reviewable steps. Explain the intended behavior and the result of each step so the maintainer can course-correct early.
- Before implementing a **new feature**, write down the proposed user flow, data/API shape, edge cases, and the smallest useful slice. Ask the maintainer for feedback on that approach, then implement the agreed slice. Routine fixes and already-agreed work can proceed directly.
- Keep completed changes uncommitted for maintainer review. Commit when the maintainer explicitly approves the reviewed work; approval to implement a slice does not by itself approve committing it.
- Keep the app usable on phones and tablets throughout development. Check touch behavior, narrow layouts, wrapping, and horizontal overflow as features are added.
- Maintain `docs/` as the project record. Start with [the documentation map](docs/README.md), then read the relevant behavior record and [optional backlog](docs/initial-implementation-plan.md#remaining-roadmap). Update stale descriptions and review status when implementation decisions change; add focused documents when they clarify a real design decision.
- Reuse [shared validation helpers](src/shared/validation.ts) for generic unknown-value checks, while keeping domain parsers at their boundaries. Tune visual design through [CSS design tokens](src/client/design-tokens.css); see [engineering conventions](docs/engineering-conventions.md).
- Keep the running app available for the maintainer to review. Rebuild client assets after frontend edits; restart the relevant server after backend edits. Use a separate port and fixture root for local QA, and stop only QA processes you started when cleaning up. Run and HTTPS instructions are in [README.md](README.md).

## Type safety and boundaries

- Use project-local TypeScript 7 with the native `tsc` compiler and the strictest practical settings. Run the type-check gate for every code change.
- Treat HTTP input, Git output, filesystem data, browser storage, subprocess output, and imported state as untrusted. Parse and validate them at their boundaries; return a clear error or bail out early when invalid.
- Represent validated internal data with precise types and explicit variants. Use discriminated unions and purpose-built records for distinct states. Do not hide uncertain states behind pervasive optional properties, casts, non-null assertions, or `any`.
- Keep server paths confined to approved roots, pass subprocess arguments as arrays without a shell, and keep repository access read-only unless the maintainer explicitly changes that scope.
- Preserve the [navigation and loading boundaries](docs/engineering-conventions.md): URLs own navigable destinations, card toggles do not repeat route focus, and cached data must belong to the current resource and version.

## Tests and visual QA

- Add tests for observable behavior and durable invariants: Git status/diff parsing, path containment, comment anchoring, export text, persistence migrations, and key touch flows where appropriate. Cover important failure cases.
- Do not add tests that merely repeat the implementation or snapshot incidental markup. A temporary test used to develop a feature may be removed if it does not guard a future regression.
- For visible UI changes, capture and inspect phone, tablet portrait, tablet landscape, and desktop screenshots with `bun run qa:capture`. Keep useful milestone images under `qa/screenshots/` and link them in the handoff. The command and review checklist are in [docs/qa-workflow.md](docs/qa-workflow.md).
- Browser emulation is an early check. Verify gesture behavior, clipboard access, and microphone capture on real iOS/Android devices when those features are implemented.
- State what was checked and what remains unverified in each handoff. Do not claim a screenshot or device check that was not actually performed.
