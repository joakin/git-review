# Working-tree search

Current project access uses a canonical absolute `projectPath` query field on every project
resource, including batch and raw-media routes. No registration is required. See the
[stateless project contract](stateless-project-access-plan.md#project-contract-and-validation).
Dated implementation and compatibility checkpoints below remain historical evidence.

Status: working-tree Search and the
[selected-code Search shortcut](selected-code-search-slice-proposal.md) are implemented. The
maintainer confirmed the shortcut works on their phone; iOS selection behavior remains unverified.

## Search tool investigation

Use **ripgrep (`rg`) for both Git and non-Git projects**. This machine has Homebrew ripgrep 15.2.0
at `/opt/homebrew/bin/rg`. Its `--json` output supplies a path, positive line number, matching line,
and match offsets without parsing colon-delimited text. A local non-Git fixture confirmed that
`--hidden -g '!.git/'` includes a hidden source file while excluding `.git`, an `.ignore`d file, and
a symlink target. Ripgrep searches working-tree contents, including ordinary untracked files; its
default ignore rules skip ignored paths.
[Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)

The running HTTPS LaunchAgent has `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so `spawn("rg")` would not
find the Homebrew binary there. The server accepts an absolute `GIT_REVIEW_RG_PATH` override, then
checks `/opt/homebrew/bin/rg`, `/usr/local/bin/rg`, and `PATH`. It shows a clear Search error if
none is executable. It does not rely on the copy bundled inside the Codex app.

## Why this follows Files

The Files viewer supplies the current-file reading surface. Bounded Search finds uses of text within
the selected project and opens that same viewer in the Search route, retaining results as its parent
list. It does not add Git history or index browsing.

## Current user flow

1. Choose **Search** beside Changes and Files in the contextual list's tabs. On a phone, the query
   and result list fill the screen. A project without Git gets the same Search view.
2. Submit a literal query. Keep the last query and results in this tab while switching views. Show
   grouped file paths with line numbers and short matching excerpts, plus a clear empty, loading,
   error, or truncated state. Do not search on every keystroke.
3. Tap a result to open its **current working-tree file** in the Search content pane and scroll to
   the matching line with a highlight. On a phone, this opens the full-width content screen. The
   Search URL keeps the query, file, and line; browser Back or the content-heading back arrow
   returns to the results. Refresh repeats the query when files change.
4. The [selected-code Search action](selected-code-search-slice-proposal.md) uses native selection,
   with a **Search selected text** tooltip beside a bounded selection inside one code line. Touch
   placement is below the selection to clear Android's native menu; desktop placement prefers above.
   The action follows page and code-pane scrolling. Android review confirmed it is usable; iOS
   interaction remains for device checks.
   [MDN selectionchange](https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event)

## API and data shape

- `GET /api/project/search?query=<literal>` returns `{ query, matches, truncated }`, where each
  match is `{ path, line, excerpt }` with a project-relative path and a positive working-tree line
  number. No repository-wide file contents are sent to the browser.
- Resolve the supplied absolute project path under the approved root on every request. Accept a
  trimmed, nonempty query of at most 128 characters without NUL or line breaks. Search is case
  sensitive fixed text in this checkpoint; a later control could add case or whole-word options.
- Run `rg --json --no-config --hidden -g '!.git/' -F -n --max-filesize 1M -e <query> .` with an
  argument array, no shell, and the validated project directory as `cwd`. `-e` keeps queries
  beginning with `-` safe. Do not add `--follow` or `--no-ignore`. This covers Git and non-Git
  folders with one subprocess and no TypeScript search walker. It searches hidden source files but
  excludes `.git`; project ignore files and binary filtering still apply.
  [Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)
- Stream JSON Lines, accept only validated `match` records, and normalize `./` paths to
  project-relative paths. Reject malformed records and apply the existing project path containment
  rules before returning a result. Handle ripgrep's `bytes` variant for non-UTF-8 data by skipping
  results Files cannot represent. Keep excerpts short. In JSON mode `--max-columns` does not bound
  output, so cap raw output/record size in the server rather than relying on that flag.
- Cap results at 100 matches, raw output at 8 MiB, a JSON record at 2 MiB, excerpts at 240
  characters, and execution at 10 seconds. Kill the child when a limit is reached.
  `--max-filesize 1M` excludes oversized individual files. Ripgrep has no exact total-files or
  total-bytes-scanned cap. Return `truncated: true` for early result/output limits; surface a
  timeout or process failure as an error, not as an empty search. Exit 1 means no matches, while
  other nonzero exits need an error. Cancel stale client requests when the query or project changes,
  and parse the API response at the client boundary.

## Edge cases and QA

- Cover tracked and untracked matches, ignored and hidden files, a non-Git folder, nested project
  folders, unusual paths, no matches, a changed or deleted result, a binary file, link escape, a
  huge file, output that reaches a limit, and missing `rg` in the HTTPS service. Ripgrep's no-match
  exit is a normal empty result; other failures are errors.
- On result navigation, the file reader remains the source of truth. If the file or line has
  changed, show the latest file and a small stale-result notice rather than inventing an anchor.
- Check phone and tablet search entry, keyboard use, result taps, list/content navigation, wrap and
  page overflow, and return to results. Capture and inspect the four standard viewports. Native
  selected-text interactions also need real-device checks.

## Review checkpoint

From this repository on a phone, search for a symbol, open its current file at the matched line, and
return to the same results. The same path works in a non-Git folder. Search is bounded and
read-only. Its full-file viewer also supports
[U03 working-tree line feedback](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files),
accepted and committed as `7632b4d`. Files and Search share file-anchor identity and markers; the
Search query is not part of that identity.

Search is an explicit project tab. Its URL records the submitted query and optional result
file/line; the latest matching response stays in tab memory during section switches. Back/Forward
and reload rerun a query when its data is not loaded. The file location bar stays visible during
deep line jumps, and changed or deleted results show a stale notice. The selected-code tooltip is
implemented and reviewed on the maintainer's phone; iOS selection remains unverified.

The [selected-code feedback follow-up](selected-code-feedback-proposal.md), accepted on 2026-10-05,
adds Comment beside Search for fragments within one logical code line. Files and Search resolve the
same working-tree anchor and preserve exact selected offsets.
