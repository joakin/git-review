# Engineering conventions

## Runtime validation

Use [the shared validation helpers](../src/shared/validation.ts) for generic checks on unknown values, such as records and strings. Keep each wire format's parser near its domain: API response shapes in `src/shared/api.ts`, saved browser state in `src/client/storage.ts`, and filesystem path rules in `src/server/paths.ts`. Callers receive validated types or a clear failure; they do not cast raw data into app types.

## Browser navigation

Keep navigable destinations in the typed [route model](../src/client/navigation.ts). Parse the URL before rendering, serialize routes with `URLSearchParams`, and use History API entries for meaningful destinations. Do not add a second component-state source of truth for the selected project, section, directory, file, or submitted Search query. The [navigation record](navigation-and-url-history-slice-proposal.md) describes the menu/list/content hierarchy and the distinction between URL state and local drafts or preferences.

## Visual design values

[Design tokens](../src/client/design-tokens.css) define the light/dark app and code palettes, type scale, common spacing, corner radii, layout widths, and shadows. Component selectors in `src/client/styles.css` use those tokens. Keep app surfaces separate from code surfaces and use the on-accent role for text placed on accent buttons. Keep values reused across components or useful for global tuning in the token file; one-off component geometry can stay next to its selector. The CSS token check runs with `bun run qa:check` so an undefined variable fails before visual QA.

After changing a token or a layout selector, build the client and inspect desktop, tablet, and phone screenshots as described in [the QA workflow](qa-workflow.md).
