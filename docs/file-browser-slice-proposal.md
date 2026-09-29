# Files browser: first readable file slice

Status: implemented and committed after maintainer review.

## Why this slice

The first Files slice adds a mobile-friendly path from a selected project to a readable working-tree file. Search results and richer previews can reuse it later.

## Proposed user flow

1. After opening a project, choose **Changes** or **Files** near the project heading. A non-Git folder opens **Files** by default. Switching modes keeps the selected project and any draft comments.
2. In Files, browse one directory at a time with a breadcrumb/back control and a list of immediate child folders and files. On desktop the list lives in the sidebar; on phone it lives in the existing drawer, which closes after selecting a file. The current file path remains visible in the main view.
3. Tap a text file to show its complete working-tree content with line numbers and the existing semantic syntax colors. Reuse the Wrap toggle; with wrapping off, only the code pane scrolls horizontally. Empty files show a clear empty state. Files mode does not add comment anchors yet: line feedback still belongs to Git diff rows.
4. Binary, symbolic-link, unsupported special-file, oversized, and unreadable content show a named state rather than a broken code viewer. A Refresh action rereads the current directory or file. The page remains usable when the file changes or disappears.

## API and state shape

- `GET /api/projects/:id/tree?path=<project-relative directory>` returns `{ path, parentPath, entries }`; each entry has `{ name, path, kind }` with `kind` equal to `directory`, `file`, `symlink`, or `other`. Entries are sorted and bounded. The root path is `""`.
- `GET /api/projects/:id/file?path=<project-relative file>&source=worktree` returns a discriminated result: `text` with `path`, byte length, `syntax`, and numbered `{ text, tokens }` lines; `binary`, `too_large`, `symlink`, or `unsupported` with byte length. A requested language override uses the existing bundled-language list and project/path local preference.
- Both routes require an opened project ID, revalidate that project under the approved root, parse each path once, and confine reads to the selected project's real directory as well as the approved root. Do not follow symlinks in this first slice. Read only regular files. Use no shell for subprocesses.
- Bound a file read to 1 MiB and 20,000 lines, matching current diff limits. Detect NUL bytes and invalid UTF-8 before syntax highlighting. Return semantic token roles; the client applies its own theme. Parse every response at the client boundary.
- Keep the current file and directory in this tab's UI state. A file link can later encode them in the URL for navigation from search results. Recent files can be added once the basic view is reviewed.

## Edge cases and QA

- Test nested paths, `..`, absolute paths, symlinks escaping the project, a file disappearing between listing and open, binary/invalid UTF-8, a file above the size limit, and a non-Git project.
- Check phone and tablet drawer navigation, breadcrumb/back behavior, wrapping and horizontal overflow, syntax colors, and returning to Changes without losing the open diff or feedback drafts. Capture and inspect the four standard viewports.
- Directory listings are immediate children only and bounded; a very large directory gives a clear limit state instead of overwhelming a phone. Hidden code files remain visible, while the repository's `.git` control directory is excluded from browsing.

## Deferred ideas

- Much later, optionally add repository and file commit history, with a commit list and files opened at a chosen revision. This is a larger Git browser and is not needed for agent code review now. Index and `HEAD` version selection can be considered with that work. [Git tree listing](https://git-scm.com/docs/git-ls-tree), [Git object reads](https://git-scm.com/docs/git-cat-file)
- Native images (including SVG), audio, and video are covered by the [media preview slice](media-preview-slice-proposal.md). PDF is deferred; HTML preview is not planned.
- Add bounded server-side search and the held-word/Search action, with results opening this file view at a line.

## Smallest reviewable result

A phone can open this repository, enter Files, browse into `src/client`, read a syntax-highlighted TypeScript file, toggle wrapping, and return to Changes. A non-Git folder can do the same. The file and tree APIs pass containment and content-boundary tests, and the four viewport captures show no page-wide overflow.

The maintainer chose the working-tree-only Files view. Git history is a distant optional slice.

## Verification for this slice

- `bun run typecheck`, `bun test`, and `bun run qa:check` pass. The boundary tests cover project confinement, traversal, links, binary and invalid UTF-8, large files, missing files, and non-Git file APIs.
- `bun run qa:files http://127.0.0.1:39991/` passes on an emulated phone, including the Files drawer, C highlighting, wrap and horizontal scroll, and return to an open diff.
- Four-size captures of a Git worktree: [phone](../qa/screenshots/files-working-tree-first/mobile.png), [tablet portrait](../qa/screenshots/files-working-tree-first/tablet-portrait.png), [tablet landscape](../qa/screenshots/files-working-tree-first/tablet-landscape.png), [desktop](../qa/screenshots/files-working-tree-first/desktop.png).
- Four-size captures of a non-Git folder: [phone](../qa/screenshots/files-nongit-first/mobile.png), [tablet portrait](../qa/screenshots/files-nongit-first/tablet-portrait.png), [tablet landscape](../qa/screenshots/files-nongit-first/tablet-landscape.png), [desktop](../qa/screenshots/files-nongit-first/desktop.png).
- [Horizontally scrolled phone capture](../qa/screenshots/files-horizontal-scroll-first/mobile.png) shows the line-number gutter staying visible while the long line moves inside the code pane; the other three viewport captures are in the same folder.
- The existing private HTTPS app was rebuilt and restarted. Its root page, project tree, and working-tree file endpoint respond successfully. [Live phone capture of this project's `App.tsx`](../qa/screenshots/files-live-project-first/mobile.png) and the matching tablet and desktop captures are in the same folder. Chrome reports a secure context, active service worker, and standalone manifest.
- Browser emulation does not verify physical-device touch or the installed Android/iOS app. File selection and directory position currently live only while this tab is open; recent-file history and file-line comment anchors remain future work.

After maintainer review, the redundant **Browse files** button was hidden at widths where the sidebar was already visible, and separators between code rows were removed to make continuous code easier to read. The [updated phone](../qa/screenshots/files-row-polish/mobile.png), [tablet portrait](../qa/screenshots/files-row-polish/tablet-portrait.png), [tablet landscape](../qa/screenshots/files-row-polish/tablet-landscape.png), and [desktop](../qa/screenshots/files-row-polish/desktop.png) captures record that stage. The later [URL navigation redesign](navigation-and-url-history-slice-proposal.md) replaced the remaining mobile button with the shared content-heading back arrow.
