# Project

git-review supports reviewing code away from a desktop editor. A phone, tablet, or desktop browser
connects to a code host, reads its repository, collects feedback, and copies that feedback into the
session where changes will be made.

## Supported scope

- Choose folders within an agent's approved root, including non-Git folders.
- Review staged, unstaged, and untracked changes; inspect existing branches and commits without
  checking them out or fetching.
- Browse working files, run literal text searches, and preview supported media.
- Comment on source lines or selected ranges in working files and working-copy diffs. Check source
  freshness, explicitly reattach outdated comments, copy a review, and recover exact copied history.
- Optionally dictate comments through transcription tools on the code host.
- Save host connections and recent projects, use independent tabs, install the frontend as a web
  app, and export/import browser-local review data.

Repository access is read-only. The app has no account service, shared review database, or
cross-device sync. Two tabs editing the same review have no conflict resolution. Historical Git is
inspection-only; historical comments, complete old file trees, and whole-file/project notes are
outside the supported scope.

The hosted frontend and private agents are independently deployable. A device needs network access
to the selected agent for live source. Saved feedback can be read and copied when the agent
disappears, provided the frontend is loadable or already open. There is no offline repository copy
or offline app-shell startup.

Generic cloud bootstrap is experimental until a compatible provider's private network access and
workspace lifetime are verified. Codex Cloud is not a supported agent host. Phone/tablet layout
checks do not establish native clipboard, selection, recording, or installed-app behavior on every
device.

The [architecture](architecture.md) explains system boundaries; the [workspace map](workspace.md)
links implemented behavior to its package owner.
