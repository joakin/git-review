# Proposed next slice: Git change inventory

Status: awaiting maintainer feedback before implementation.

## User flow

After choosing a folder, the main view shows counts and lists for Staged, Unstaged, and Untracked changes. A path with both staged and unstaged changes appears in both groups. On desktop, the lists can live in the persistent file sidebar; on phone, a compact summary stays in the main view and the file list opens from the existing drawer control. This slice shows file state and paths, with diff cards following in a separate slice.

## Data and API

Add `GET /api/projects/:id/status`. Opening a folder registers its canonical path under the stable project ID for the server session; reload first reopens the saved path. The response contains a revision marker and entries with layer, path, change kind, and old path for renames. The server runs Git with a fixed argument array and parses porcelain v2 `-z` output into validated variants. A selected subfolder would show changes inside that subfolder only.

## Edge cases

Handle non-Git folders with a clear empty state, repositories without a first commit, staged and unstaged edits on one path, renames, deletions, conflicts, binary and submodule entries, and unusual filenames. Do not infer a diff from the status record; diff retrieval remains the next slice. Keep the current folder and recent paths working if the repository changes while the app is open.

## Smallest reviewable result

Deliver a working change inventory on desktop, tablet, and phone with fixture tests for the Git parser and screenshots for each layout. Before building it, confirm the proposed list placement and that choosing a subfolder should scope the changes to that subtree.
