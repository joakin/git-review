# Working-tree search

Status: working-tree Search is implemented. The [selected-code Search shortcut](selected-code-search-slice-proposal.md) is implemented for maintainer review; native selection behavior on real phones remains unverified.

## Search tool investigation

Use **ripgrep (`rg`) for both Git and non-Git projects**. This machine has Homebrew ripgrep 15.2.0 at `/opt/homebrew/bin/rg`. Its `--json` output supplies a path, positive line number, matching line, and match offsets without parsing colon-delimited text. A local non-Git fixture confirmed that `--hidden -g '!.git/'` includes a hidden source file while excluding `.git`, an `.ignore`d file, and a symlink target. Ripgrep searches working-tree contents, including ordinary untracked files; its default ignore rules skip ignored paths. [Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)

The running HTTPS LaunchAgent has `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so `spawn("rg")` would not find the Homebrew binary there. The server accepts an absolute `GIT_REVIEW_RG_PATH` override, then checks `/opt/homebrew/bin/rg`, `/usr/local/bin/rg`, and `PATH`. It shows a clear Search error if none is executable. It does not rely on the copy bundled inside the Codex app.

## Why this follows Files

The new Files view can show a current working-tree file but has no way to locate a use of a name elsewhere. A bounded search can now lead directly to that view. It stays within the selected project and does not add Git history or index browsing.

## Current user flow

1. Add **Search** beside Changes and Files. On a phone, it is a full-width view with one query field, a Search button, and a short explanation of the search scope. A project without Git gets the same Search view.
2. Submit a literal query. Keep the last query and results in this tab while switching views. Show grouped file paths with line numbers and short matching excerpts, plus a clear empty, loading, error, or truncated state. Do not search on every keystroke.
3. Tap a result to open its **current working-tree file** in Files and scroll the matching line into view with a temporary highlight. The Files drawer closes on a phone. Returning to Search preserves the result list; a Refresh action repeats the query when files change.
4. The [selected-code Search proposal](selected-code-search-slice-proposal.md) follows this first checkpoint. Use the browser's native text selection, then show a **Search selected text** tooltip above a bounded selection inside one code line. Reposition it as the page or code pane scrolls. Avoid intercepting long press or preventing text selection. Validate the interaction on real Android and iOS devices before calling it complete. [MDN selectionchange](https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event)

## API and data shape

- `GET /api/projects/:id/search?query=<literal>` returns `{ query, matches, truncated }`, where each match is `{ path, line, excerpt }` with a project-relative path and a positive working-tree line number. No repository-wide file contents are sent to the browser.
- Require an opened project ID and revalidate its approved root on every request. Accept a trimmed, nonempty query of at most 128 characters without NUL or line breaks. Search is case sensitive fixed text in this checkpoint; a later control could add case or whole-word options.
- Run `rg --json --no-config --hidden -g '!.git/' -F -n --max-filesize 1M -e <query> .` with an argument array, no shell, and the validated project directory as `cwd`. `-e` keeps queries beginning with `-` safe. Do not add `--follow` or `--no-ignore`. This covers Git and non-Git folders with one subprocess and no TypeScript search walker. It searches hidden source files but excludes `.git`; project ignore files and binary filtering still apply. [Ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)
- Stream JSON Lines, accept only validated `match` records, and normalize `./` paths to project-relative paths. Reject malformed records and apply the existing project path containment rules before returning a result. Handle ripgrep's `bytes` variant for non-UTF-8 data by skipping results Files cannot represent. Keep excerpts short. In JSON mode `--max-columns` does not bound output, so cap raw output/record size in the server rather than relying on that flag.
- Cap returned matches (for example, 100), subprocess output bytes, individual record size, and wall time; kill the child when a cap is reached. `--max-filesize 1M` excludes oversized individual files. Ripgrep has no simple exact total-files or total-bytes-scanned cap, so do not promise one. Return `truncated: true` for early result/output limits; surface a timeout or process failure as an error, not as an empty search. Exit 1 means no matches, while other nonzero exits need an error. Cancel stale client requests when the query or project changes, and parse the API response at the client boundary.

## Edge cases and QA

- Cover tracked and untracked matches, ignored and hidden files, a non-Git folder, nested project folders, unusual paths, no matches, a changed or deleted result, a binary file, link escape, a huge file, output that reaches a limit, and missing `rg` in the HTTPS service. Ripgrep's no-match exit is a normal empty result; other failures are errors.
- On result navigation, the file reader remains the source of truth. If the file or line has changed, show the latest file and a small stale-result notice rather than inventing an anchor.
- Check phone and tablet search entry, keyboard use, result taps, drawer closure, wrap and page overflow, and return to results. Capture and inspect the four standard viewports. Real devices are required for the later selected-word shortcut.

## Review checkpoint

From this repository on a phone, search for a symbol, open a result in Files at its line, and return to the same results. The same path works in a non-Git folder. Search is bounded and read-only; existing Changes and feedback are unaffected.

The first checkpoint is implemented: Search is an explicit project tab, results stay in the current tab while switching views, and a result opens the current file at its line. The Files location bar stays visible during deep line jumps so the path remains clear on a phone. A changed result shows a stale notice in Files. Search state is in memory for the current tab; it resets when a different project is opened. The selected-code tooltip is implemented; its native selection interaction still needs real-device review.
