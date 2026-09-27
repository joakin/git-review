# Working on git-review

## Collaboration

- Work in small, reviewable steps. Explain the intended behavior and the result of each step so the maintainer can course-correct early.
- Before implementing a **new feature**, write down the proposed user flow, data/API shape, edge cases, and the smallest useful slice. Ask the maintainer for feedback on that approach, then implement the agreed slice. Routine fixes and already-agreed work can proceed directly.
- Keep the app usable on phones and tablets throughout development. Check touch behavior, narrow layouts, wrapping, and horizontal overflow as features are added.
- Maintain `docs/` as the project record. Update the relevant design or behavior document when implementation decisions change. Start with [the initial plan](docs/initial-implementation-plan.md) and [the QA workflow](docs/qa-workflow.md); add focused documents when they clarify a real design decision.
- Reuse [shared validation helpers](src/shared/validation.ts) for generic unknown-value checks, while keeping domain parsers at their boundaries. Tune visual design through [CSS design tokens](src/client/design-tokens.css); see [engineering conventions](docs/engineering-conventions.md).

## Type safety and boundaries

- Use project-local TypeScript 7 with the native `tsc` compiler and the strictest practical settings. Run the type-check gate for every code change.
- Treat HTTP input, Git output, filesystem data, browser storage, subprocess output, and imported state as untrusted. Parse and validate them at their boundaries; return a clear error or bail out early when invalid.
- Represent validated internal data with precise types and explicit variants. Use discriminated unions and purpose-built records for distinct states. Do not hide uncertain states behind pervasive optional properties, casts, non-null assertions, or `any`.
- Keep server paths confined to approved roots, pass subprocess arguments as arrays without a shell, and keep repository access read-only unless the maintainer explicitly changes that scope.

## Tests and visual QA

- Add tests for observable behavior and durable invariants: Git status/diff parsing, path containment, comment anchoring, export text, persistence migrations, and key touch flows where appropriate. Cover important failure cases.
- Do not add tests that merely repeat the implementation or snapshot incidental markup. A temporary test used to develop a feature may be removed if it does not guard a future regression.
- For visible UI changes, capture and inspect phone, tablet portrait, tablet landscape, and desktop screenshots with `bun run qa:capture`. Keep useful milestone images under `qa/screenshots/` and link them in the handoff. The command and review checklist are in [docs/qa-workflow.md](docs/qa-workflow.md).
- Browser emulation is an early check. Verify gesture behavior, clipboard access, and microphone capture on real iOS/Android devices when those features are implemented.
- State what was checked and what remains unverified in each handoff. Do not claim a screenshot or device check that was not actually performed.
