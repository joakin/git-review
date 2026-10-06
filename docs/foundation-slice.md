# Foundation slice: local project picker

Current project access uses a canonical absolute `projectPath` query field on every project
resource, including batch and raw-media routes. No registration is required. See the
[stateless project contract](stateless-project-access-plan.md#project-contract-and-validation).
Dated implementation and compatibility checkpoints below remain historical evidence.

Status: implemented and committed. Private HTTPS installation is covered by the
[PWA record](independent-tabs-and-pwa-proposal.md); current navigation is in the
[URL record](navigation-and-url-history-slice-proposal.md).

## User flow

Run the Bun server with an approved host root (`--root /path/to/projects`; default: the current
working directory). The folder picker is a navigable list screen. Open folders inside that root and
select one as the project for this tab. An explicit project URL takes precedence; `/` restores this
tab's active selection from session storage. Shared recent paths survive reloads in browser-local
storage. Selecting a path asks the server to validate it again.

The [project picker](../src/client/ProjectPicker.tsx) presents root and directory state with
browse/select commands. The [project/session owner](../src/client/project-session.ts) owns accepted
selection and persistence; App retains directory loading and URL transitions.

This slice established project selection and root containment. Git status, diff cards, file
browsing, comments, Search, voice input, and private HTTPS were completed in later slices; the
[documentation map](README.md) links their current behavior.

## Wire shape

- `GET /api/roots` returns the one canonical allowed root path and label.
- `GET /api/directories?path=<root-relative path>` returns a canonical relative path, its parent,
  and child directory entries. Entries are directory names and relative paths only.
- `GET /api/project?projectPath=<absolute path>` returns
  `{ project: { name, absolutePath, relativePath } }`. Selection may canonicalize an allowed alias.
  Resource reads require the returned canonical absolute path; no server registry is created. The
  root itself has `relativePath: ""`.
- Errors return `{ "error": { "code": string, "message": string } }` with an appropriate HTTP
  status. The client parses every response before treating it as app state.

## Boundaries and edge cases

The server listens on loopback by default and can bind to this Mac's Tailscale IPv4 address with
`GIT_REVIEW_HOST`. It canonicalizes the approved root at startup. Root-relative picker paths reject
absolute paths, `.`/`..`, empty path segments, oversized paths, and null bytes, then resolves
requested directories and verifies their real paths stay under the root. Directory listings skip
symlinks, so a symlink cannot appear as a folder choice. A previously selected path may disappear;
the UI reports that and retains an option to choose another folder. Browser storage is untrusted,
versioned, and scoped to the canonical approved root; malformed entries or entries from a different
root are discarded. Every project resource independently checks a canonical absolute path, directory
existence and root containment. Missing folders return `project_not_found`; changed canonical
locations return `project_changed`. Browser feedback remains local; see the
[state and lifecycle record](stateless-project-access-plan.md#state-and-lifecycle-after-cutover).
This slice does not add app-level authentication.

## Review checkpoint

Type-check server, client, and QA code; run path-containment tests; exercise selection and reload in
a browser; inspect four viewport captures. Get maintainer feedback on the picker and layout before
expanding it into the Git review interface.
