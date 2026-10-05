# Files browser: first readable file slice

Status: original Files slice implemented and committed after maintainer review; U03 line-feedback
extension accepted and committed as `7632b4d`.

## Why this slice

Files provides a path from a selected project to a readable working-tree file on phone, tablet, and
desktop. Search results reuse the same file viewer, and
[media previews](media-preview-slice-proposal.md) extend its supported content.

## Current user flow

1. Choose **Files** from the contextual list's project tabs. A non-Git folder opens Files by
   default. Switching sections keeps the selected project and any draft comments.
2. Browse one directory at a time with a breadcrumb/back control and immediate child folders and
   files. At 900 px and above, the list sits beside content; narrower tablets use a drawer, and
   phones use a full-width list screen. Selecting a file opens content, where its path remains in a
   sticky location bar. The content-heading back arrow returns to or reveals the list.
3. Tap a text file to show its complete working-tree content with line numbers and the existing
   semantic syntax colors. Reuse the Wrap toggle; with wrapping off, only the code pane scrolls
   horizontally. Empty files show a clear empty state. Tap/click a text row, then Comment to add a
   working-tree line comment; keyboard users can activate its line-number button. Draft markers and
   counts belong to file anchors, independently of diff comments. The
   [U03 record](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files)
   owns this extension and its review.
4. Supported images, SVG, audio, and video show native previews and raw links. Other binary,
   symbolic-link, unsupported special-file, oversized, and unreadable content show a named state.
   Refresh rereads the current directory or file while retaining loaded same-file content during the
   request. The page remains usable when the file changes or disappears.

## API and state shape

- `GET /api/projects/:id/tree?path=<project-relative directory>` returns
  `{ path, parentPath, entries }`; each entry has `{ name, path, kind }` with `kind` equal to
  `directory`, `file`, `symlink`, or `other`. Entries are sorted and bounded. The root path is `""`.
- `GET /api/projects/:id/file?path=<project-relative file>&source=worktree` returns a discriminated
  result: `text` with `path`, byte length, `syntax`, and numbered `{ text, tokens }` lines; `media`
  with a version-checked raw resource; or `binary`, `too_large`, `symlink`, or `unsupported` with
  byte length. A language override uses the bundled-language list and project/path local preference.
  A missing file returns HTTP 404 with `file_not_found`; project-handle failures retain `not_found`,
  and denied or transient reads remain errors. Feedback can mark a deleted file outdated without
  treating an offline host as deleted content.
- Both routes require an opened project ID, revalidate that project under the approved root, parse
  each path at the [shared working-file boundary](working-file-boundaries.md), and confine reads to
  the selected project's real directory as well as the approved root. Do not follow symlinks in this
  first slice. Read only regular files. Use no shell for subprocesses. Bounded reads recheck file
  and parent identities before returning, and the shared scope closes descriptors on success or
  failure.
- Bound text reads to 1 MiB and 20,000 lines. Media has separate byte limits in its
  [behavior record](media-preview-slice-proposal.md). Detect NUL bytes and invalid UTF-8 before
  syntax highlighting. Return semantic token roles; the client applies its own theme. Parse every
  response at the client boundary.
- The validated URL owns the project, directory, selected file, and optional line. Direct links and
  browser Back/Forward use the [navigation model](navigation-and-url-history-slice-proposal.md).
  Recent-file history is [optional future work](initial-implementation-plan.md#remaining-roadmap).

The [Files sidebar](../src/client/FilesSidebar.tsx) consumes the current directory's scoped load
state, selection, and parent/select/retry commands. App owns directory request identity and URL
transitions; the file viewer retains its separate content lifetime.

## Edge cases and QA

- Test nested paths, `..`, absolute paths, symlinks escaping the project, a file disappearing
  between listing and open, binary/invalid UTF-8, a file above the size limit, and a non-Git
  project.
- Check phone and tablet drawer navigation, breadcrumb/back behavior, wrapping and horizontal
  overflow, syntax colors, and returning to Changes without losing the open diff or feedback drafts.
  Capture and inspect the four standard viewports.
- Directory listings are immediate children only and bounded; a very large directory gives a clear
  limit state instead of overwhelming a phone. Hidden code files remain visible, while the
  repository's `.git` control directory is excluded from browsing.

## Deferred ideas

- The focused [branch and commit browser](git-history-slice-proposal.md) is implemented, reviewed,
  and committed as `22de40e`. File-specific history and browsing a whole tree at a chosen revision
  remain optional later work; Files continues to read the working tree. Index and `HEAD` version
  selection can be considered with that later work.
  [Git tree listing](https://git-scm.com/docs/git-ls-tree),
  [Git object reads](https://git-scm.com/docs/git-cat-file)
- Native images (including SVG), audio, and video are covered by the
  [media preview slice](media-preview-slice-proposal.md). PDF is deferred; HTML preview is not
  planned.
- Bounded server-side Search and the selected-code action are implemented in their
  [Search](search-slice-proposal.md) and [selection](selected-code-search-slice-proposal.md)
  records.

## Smallest reviewable result

A phone can open this repository, enter Files, browse into `src/client`, read a syntax-highlighted
TypeScript file, toggle wrapping, and return to Changes. A non-Git folder can do the same. The file
and tree APIs pass containment and content-boundary tests, and the four viewport captures show no
page-wide overflow.

The maintainer chose the working-tree-only Files view.
[Git inspection](git-history-slice-proposal.md) now uses a separate Git tab for branches and commit
comparisons; it keeps Files on the working tree. File-specific history and browsing an entire old
tree remain later work.

## Verification for this slice

- `bun run typecheck`, `bun test`, and `bun run qa:check` pass. The boundary tests cover project
  confinement, traversal, links, binary and invalid UTF-8, large files, missing files, and non-Git
  file APIs.
- `bun run qa:files http://127.0.0.1:39991/` passes on an emulated phone, including the Files
  drawer, C highlighting, wrap and horizontal scroll, and return to an open diff.
- Four-size captures of a Git worktree:
  [phone](../qa/screenshots/files-working-tree-first/mobile.png),
  [tablet portrait](../qa/screenshots/files-working-tree-first/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/files-working-tree-first/tablet-landscape.png),
  [desktop](../qa/screenshots/files-working-tree-first/desktop.png).
- Four-size captures of a non-Git folder: [phone](../qa/screenshots/files-nongit-first/mobile.png),
  [tablet portrait](../qa/screenshots/files-nongit-first/tablet-portrait.png),
  [tablet landscape](../qa/screenshots/files-nongit-first/tablet-landscape.png),
  [desktop](../qa/screenshots/files-nongit-first/desktop.png).
- [Horizontally scrolled phone capture](../qa/screenshots/files-horizontal-scroll-first/mobile.png)
  shows the line-number gutter staying visible while the long line moves inside the code pane; the
  other three viewport captures are in the same folder.
- The existing private HTTPS app was rebuilt and restarted. Its root page, project tree, and
  working-tree file endpoint respond successfully.
  [Live phone capture of this project's `App.tsx`](../qa/screenshots/files-live-project-first/mobile.png)
  and the matching tablet and desktop captures are in the same folder. Chrome reports a secure
  context, active service worker, and standalone manifest.
- Browser emulation does not verify physical-device touch or the installed Android/iOS app. File
  selection and directory position survive reload through the URL. Recent-file history remains
  optional; file-line feedback was added later in the
  [U03 follow-up](pwa-navigation-and-file-feedback-proposal.md#u03--line-feedback-while-reading-files),
  whose own review and device limits apply.

After maintainer review, the redundant **Browse files** button was hidden at widths where the
sidebar was already visible, and separators between code rows were removed to make continuous code
easier to read. The [updated phone](../qa/screenshots/files-row-polish/mobile.png),
[tablet portrait](../qa/screenshots/files-row-polish/tablet-portrait.png),
[tablet landscape](../qa/screenshots/files-row-polish/tablet-landscape.png), and
[desktop](../qa/screenshots/files-row-polish/desktop.png) captures record that stage. The later
[URL navigation redesign](navigation-and-url-history-slice-proposal.md) replaced the remaining
mobile button with the shared content-heading back arrow.

The [selected-code feedback follow-up](selected-code-feedback-proposal.md), accepted on 2026-10-05,
adds Comment beside Search for fragments within one logical code line. Files and Search resolve the
same working-tree anchor and preserve exact selected offsets.
