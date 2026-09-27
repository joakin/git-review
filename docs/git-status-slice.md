# Git change inventory

Status: implemented in the first Git slice. [Diff cards](diff-slice.md) now build on this inventory; file previews remain planned.

## User flow

After choosing a folder, the main view lists staged, unstaged, and untracked files with counts. Conflicts get a separate group when present. A path with both staged and unstaged edits appears in both groups. The desktop and tablet sidebar shows the same inventory; on a phone, the sidebar opens from the project button in the top bar. The sidebar also has a Browse host folders control. Refresh changes rereads Git without changing the selected folder.

Sidebar rows show state and path and now open the corresponding diff card. The main inventory has become the continuous card list described in [the diff slice](diff-slice.md).

## Data and API

`GET /api/projects/:id/status` is available after `POST /api/projects/open` has registered the folder in the current server session. Reload restores the saved path by opening it again. A status request revalidates the folder against the approved root before invoking Git. Unknown or stale IDs return 404.

The response is one of:

```json
{ "kind": "not_git" }
```

```json
{
  "kind": "git",
  "revision": "20-character-status-hash",
  "entries": [
    { "layer": "unstaged", "kind": "modified", "path": "src/view.ts", "oldPath": null, "isSubmodule": false }
  ]
}
```

The revision is a digest of the raw status output, including branch information, so it changes when the displayed inventory changes. Entries are relative to the selected folder. Git's porcelain v2 `-z` output is parsed with NUL delimiters, preserving spaces and newlines in names. For a selected subfolder, `-- .` scopes changes to that subtree, and the repository prefix is removed from returned paths. Rename origins outside that subtree currently remain repository-relative in `oldPath`; the diff slice will define how to display those origins consistently.

Git runs with fixed argument arrays, a timeout, a bounded output buffer, and no shell. The parser validates record structure, modes, hashes, status codes, and paths before creating typed entries. The client validates the JSON response before rendering it.

## Edge cases

Non-Git folders show a clear message. A repository without a first commit shows untracked files. Staged and unstaged edits on one path are separate entries. Renames, deletions, conflicts, and submodule states remain visible. Binary classification needs a file diff or file read and is deferred to that slice. Status is refreshed by the visible button for now. Active-page polling can be added with the diff cards so it preserves card and scroll state.

## Verification

`src/server/git-status.test.ts` uses temporary Git repositories to cover layers, renames, deletion, unusual paths, subfolder scoping, non-Git folders, and a repository without commits. The mobile folder selection and reload flow still passes. [Inventory screenshots](../qa/screenshots/git-inventory-fixture/mobile.png) and [drawer screenshots](../qa/screenshots/git-inventory-fixture-drawer/mobile.png) were captured at phone, tablet portrait, tablet landscape, and desktop sizes using a stable ignored Git fixture. Real device touch behavior remains unverified.
