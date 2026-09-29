# App and code theme settings: next slice proposal

Status: implemented, reviewed, and committed on 2026-09-29.

## Why this is next

The existing Settings screen already owns code typography, and syntax highlighting arrives from the server as semantic roles. Theme choices can therefore stay in the browser and apply to the current review without another API or Git change. This also finishes the appearance controls requested alongside font size and family. Recent-file shortcuts and the larger navigation redesign can follow separately.

## Proposed user flow

1. Open **Settings → Appearance** from the current sidebar or phone menu, even before choosing a project. Keep Typography as its own section.
2. Choose an **App theme**: Light, Dark, or System. Light is the initial value so existing browsers keep today's appearance. System follows the device's light/dark preference as it changes.
3. Choose a **Code theme**: Match app, Light, or Dark. Match app is the initial value. A reader can therefore keep the interface dark and code light, or the reverse. The code choice applies to Changes, Files, code excerpts, feedback source excerpts, and the Settings preview.
4. Changes apply immediately without resetting the selected project, open cards, drafts, scroll position, font, or wrap setting. A separate **Reset appearance** control restores Light + Match app; Typography's Reset continues to affect only typography.

The Settings screen should show a small interface sample and the existing added/removed code sample under the chosen combination. The two selectors and previews stack at phone width, with touch-sized controls.

## State and rendering boundaries

Use one validated browser preference, independent of project and typography:

```ts
type Appearance = {
  version: 1;
  appTheme: "light" | "dark" | "system";
  codeTheme: "match" | "light" | "dark";
};
```

Save it in a versioned `localStorage` key. Reject malformed or future versions at the storage boundary and use Light + Match app as the fallback. Keep the in-memory choice working if storage is unavailable. Listen for changes from another tab and for `prefers-color-scheme` changes when System or Match app is in use. Resolve those choices to light/dark attributes on the app root; no theme name, CSS, or color travels through the server API. A version 3 local-data backup should include the validated appearance choice. Version 1 and 2 imports leave the current appearance alone; an invalid version 3 preference rejects the whole import before writing anything.

Put both palettes in `design-tokens.css`. First audit token use so a dark `--color-surface` cannot accidentally become dark text on an accent button; add explicit on-accent and code-surface roles where needed. Scope the code palette to code components instead of changing every app surface. The code palette must cover source text, syntax roles, gutters, added/removed backgrounds, changed-word marks, hunk headers, selection, and search/feedback excerpts. Form controls should use the resolved app `color-scheme`. The existing fixed PWA `theme-color` metadata should follow the app palette when the UI loads or changes.

## Edge cases and verification

- Dark app with light code, light app with dark code, and both matching must remain legible. Check syntax roles on normal, added, removed, and changed-word backgrounds, including selection and focused lines.
- Changing System preference while the page is open updates the app and, when selected, the matching code palette. Explicit Light/Dark choices stay fixed.
- A reload, a second tab, and a backup round trip preserve the choice. Existing backups remain importable without changing appearance.
- The phone drawer, dialogs, media cards, search, code wrapping, horizontal scrolling, and the installed PWA should retain readable controls and no page-wide overflow. Capture and inspect phone, tablet portrait, tablet landscape, and desktop in representative light/dark combinations.
- The saved palette loads through a small synchronous external script before the stylesheet, using the same validated storage model as the app. This avoids a light flash before the main app mounts while respecting the current CSP. Inspect the installed app on a real phone too.

## Small reviewable implementation

Start with the app palette, Appearance storage, and Settings control; capture all four viewport sizes and review the dark interface. Then add the independent code palette and its preview, followed by backup migration and cross-tab/system checks. Keep this as one feature with two visual checkpoints for maintainer review. Add tests for invalid stored values and backup migration, plus browser checks for actual palette application. Avoid tests that merely assert CSS variable names.

## Implementation and review record

The maintainer approved Light / Dark / System for the app and Match app / Light / Dark for code. Both palettes are implemented entirely in frontend CSS tokens. The app updates the browser theme color, and a prepaint script applies saved choices before the main UI loads. Local-data backups now use version 3 and keep version 1 and 2 imports compatible. Browser QA checks actual diff, Files, Settings, and feedback surfaces; system changes, cross-tab sync, 320 px width, the prepaint sequence, and backup export/import. The four-size captures are listed in the [QA workflow](qa-workflow.md#theme-settings).

The reviewer should judge comfort and contrast on a real phone, especially syntax over added/removed and changed-word backgrounds. Named color schemes remain a possible later extension. The installed PWA's manifest splash color remains static because one manifest serves all personal choices; the browser `theme-color` meta changes with the selected app palette.
