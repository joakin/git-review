# Foundation slice: local project picker

Status: implemented; Tailscale IP binding added for remote access to this slice.

## User flow

Run the Bun server with an approved host root (`--root /path/to/projects`; default: the current working directory). The browser starts at a local page with a folder drawer. Open folders inside that root, select the current folder, and see it as the active project. The last selection and a short recent-path list survive reloads in this browser. Selecting a recent path asks the server to validate it again.

This slice stops at project selection. Git status, diff cards, file browsing, comments, search, LAN access, and speech input remain subsequent reviewable slices.

## Wire shape

- `GET /api/roots` returns the one canonical allowed root path and label.
- `GET /api/directories?path=<root-relative path>` returns a canonical relative path, its parent, and child directory entries. Entries are directory names and relative paths only.
- `POST /api/projects/open` accepts `{ "path": "root/relative/path" }` and returns a stable project ID, name, and canonical path. The root itself is represented by the empty string.
- Errors return `{ "error": { "code": string, "message": string } }` with an appropriate HTTP status. The client parses every response before treating it as app state.

## Boundaries and edge cases

The server listens on loopback by default and can bind to this Mac's Tailscale IPv4 address with `GIT_REVIEW_HOST`. It canonicalizes the approved root at startup, rejects absolute paths, `.`/`..`, empty path segments, oversized paths, and null bytes, then resolves requested directories and verifies their real paths stay under the root. Directory listings skip symlinks, so a symlink cannot appear as a folder choice. A previously selected path may disappear; the UI reports that and retains an option to choose another folder. Browser storage is untrusted, versioned, and scoped to the canonical approved root; malformed entries or entries from a different root are discarded. This slice does not add app-level authentication.

## Review checkpoint

Type-check server, client, and QA code; run path-containment tests; exercise selection and reload in a browser; inspect four viewport captures. Get maintainer feedback on the picker and layout before expanding it into the Git review interface.
