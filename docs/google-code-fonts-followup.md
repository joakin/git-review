# Google code fonts and row separators

Status: implemented and committed.

## User flow and smallest slice

The font-family selector keeps System mono and Courier and offers 20 Google Fonts monospace choices.
Google's [public font metadata](https://fonts.google.com/metadata/fonts) lists Roboto Mono, IBM Plex
Mono, JetBrains Mono, Inconsolata, and Source Code Pro as its five most popular monospace families
on 29 September 2026; they appear first in that order. Fira Code follows, then 14 more families
selected for readable code and varied letterforms. Selecting one updates the live preview and all
code surfaces immediately. Diff rows no longer draw a horizontal rule between every source line;
hunk labels and added/removed backgrounds remain.

## Data and loading

The existing version 1 typography record stores a validated font ID; no storage or backup version
change is needed. Old `system` and `courier` choices remain valid. The frontend loads the selected
Google family through the [Google Fonts CSS v2 API](https://developers.google.com/fonts/docs/css2),
requesting regular and bold weights with `display=swap`. It adds no font request when a local option
is selected. The server's Content Security Policy permits the Google stylesheet and font-file
origins, while Git content and API traffic remain on this host. Every Google stack ends in the
existing system monospace fallback.

## Edge cases and QA

- A failed or offline font request leaves readable local monospace code; Google font selection needs
  an internet connection.
- Switching families, reloading, importing backups, and changing tabs still use the existing
  validated setting.
- Phone and tablet code stays inside its wrap or horizontal pane at the largest size.
- Browser QA verifies a real Google font loads through both local HTTP and the live HTTPS app, the
  no-font-request local default, the missing row border, and four viewport screenshots. Device font
  rendering may differ.
- Diff and Files `<code>` elements explicitly inherit their row's selected family. The browser's
  default `<code>` font otherwise overrides the row while its font size still appears correct;
  browser QA checks the computed family on the source text itself.

The original choices remain [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono),
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono),
[JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono),
[Inconsolata](https://fonts.google.com/specimen/Inconsolata),
[Source Code Pro](https://fonts.google.com/specimen/Source+Code+Pro), and
[Fira Code](https://fonts.google.com/specimen/Fira+Code). The additional choices are Martian Mono,
Geist Mono, Space Mono, Courier Prime, Ubuntu Sans Mono, Google Sans Code, Anonymous Pro, Azeret
Mono, Overpass Mono, Red Hat Mono, Spline Sans Mono, Victor Mono, Intel One Mono, and Iosevka Charon
Mono. All 20 are listed in Google's catalog with regular and bold styles; each CSS URL is checked
before handoff.
