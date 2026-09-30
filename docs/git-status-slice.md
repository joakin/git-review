# Git change inventory

Status: implemented and committed. [Diff cards](diff-slice.md), [media previews](media-preview-slice-proposal.md), and [live change detection](live-change-detection-slice-proposal.md) build on this inventory.

## User flow

The Changes contextual list groups staged, unstaged, and untracked files with counts. Conflicts get a separate group when present. A path with both staged and unstaged edits appears in both groups. The list stays beside content at widths of 900 px and above, uses a drawer on narrower tablets, and is a full-width screen on phones. The shared content-heading back arrow reveals or returns to it. Project choice belongs to the global menu. Refresh rereads Git without changing the selected folder.

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
  "changeToken": "20-character-metadata-hash",
  "entries": [
    { "layer": "unstaged", "kind": "modified", "path": "src/view.ts", "oldPath": null, "isSubmodule": false }
  ]
}
```

The revision is a digest of the raw status output, including branch information. The separate change token also includes metadata fingerprints for working-tree paths, so another edit can be detected even when its status code stays unchanged. It is not a content hash; see [live change detection](live-change-detection-slice-proposal.md). Git's porcelain v2 `-z` output is parsed with NUL delimiters, preserving spaces and newlines in names. For a selected subfolder, `-- .` scopes changes to that subtree, and returned paths are relative to that folder. Rename origins use the same relative basis and can include `../` when outside the selected subtree; the diff server checks containment before using them.

Git runs with fixed argument arrays, a timeout, a bounded output buffer, and no shell. The parser validates record structure, modes, hashes, status codes, and paths before creating typed entries. The client validates the JSON response before rendering it.

## Edge cases

Non-Git folders open Files. A repository without a first commit can show untracked files or staged additions. Staged and unstaged edits on one path are separate entries. Renames, deletions, conflicts, and submodule states remain visible. Binary/media classification belongs to the file/diff read. Active-page polling detects new edits and offers Update; it does not replace the reader's content until requested. Manual Refresh remains available.

## Verification

`src/server/git-status.test.ts` uses temporary Git repositories to cover layers, renames, deletion, unusual paths, subfolder scoping, non-Git folders, and a repository without commits. The mobile folder selection and reload flow still passes. [Inventory screenshots](../qa/screenshots/git-inventory-fixture/mobile.png) and [drawer screenshots](../qa/screenshots/git-inventory-fixture-drawer/mobile.png) were captured at phone, tablet portrait, tablet landscape, and desktop sizes using a stable ignored Git fixture. Real device touch behavior remains unverified.
