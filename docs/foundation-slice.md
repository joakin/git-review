# Host folder selection

## User flow

Choose a folder inside the configured approved host root. The picker has navigable directories and
can select the root itself. Selecting a folder validates its current location; Git folders enter
Changes and other folders enter Files. Explicit destinations take priority over saved tab selection.
See [navigation](navigation-and-url-history-slice-proposal.md) for the responsive flow and
[local data](independent-tabs-and-pwa-proposal.md) for restoration and shared recents.

## Boundaries

The approved root is canonicalized at startup. Picker paths are relative to that root; directory
requests reject traversal, absolute input, malformed segments, and escapes after realpath
resolution. Listings omit symbolic-link folders. The root-relative folder picker rejects backslash
folder names; literal POSIX filenames inside a selected project follow the working-file contract. A
folder that disappears or becomes disallowed produces an error and leaves another selection
available.

Project metadata lookup can canonicalize an allowed alias. All resource reads use the resulting
canonical identity under the [stateless project contract](stateless-project-access-plan.md). Browser
routes and recents retain their root-relative representation; they do not authorize access. The host
has no app-level account system. Binding, private HTTPS, and runtime setup belong in the
[root README](../README.md).

## Source and verification

[Root/directory resolution](../src/server/paths.ts) owns host containment;
[API handlers](../src/server/api.ts) and [wire parsers](../src/shared/api.ts) own request/response
formats. [Project sessions](../src/client/project-session.ts) own selection lifetime.
[Path tests](../src/server/paths.test.ts) and the [QA catalog](qa-workflow.md#focused-checks) cover
selection, invalid paths, navigation, cancellation, and reload. Picker captures are linked from the
[navigation evidence](navigation-and-url-history-slice-proposal.md).
