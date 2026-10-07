# Checked working-file boundaries

[Working-file access](../src/server/working-files.ts) owns literal path validation, containment,
no-follow opening, identity rechecks, and descriptor lifetime. Callers retain decoding, limits,
source interpretation, and content freshness.

## Path and identity checks

Project-relative paths reject absolute input, traversal, malformed segments, NUL, and Git control
directories. The empty path represents the directory root. Literal backslashes are filename
characters on POSIX; platform-specific rejection remains at the host boundary.

Every component is inspected without following intermediate links, including links to another
location inside the project. Final symlinks and special files can be classified without opening
them. A regular-file descriptor must match the inspected leaf. Rechecking parent components catches
replacement even if a new parent contains a hard link to that leaf. Bounded reads repeat identity
checks before returning their result.

The access path intentionally avoids per-file Bun realpath resolution: the installed runtime can
reject literal backslash names or wait on a FIFO. Canonical project containment plus literal
component checks and a nonblocking, no-follow open preserve those names and avoid that wait.

These checks surround descriptor access; they are not an atomic directory-relative OS walk. Tests
exercise file/parent replacement, not every possible concurrent filesystem mutation. A descriptor
pins identity, not mutable contents.

## Descriptor ownership and domain policy

The scoped reader closes descriptors after success, caller failure, or validation failure. Streaming
transfers ownership explicitly: format/version rejection before transfer closes the descriptor, and
the response owner closes it on completion, cancellation, failure, HEAD, or an invalid range. Media
callers check content versions around bounded reads or streaming chunks, separately from shared
identity checks.

[Files](file-browser-slice-proposal.md) owns display normalization and file-level errors;
[diffs](diff-slice.md) preserve exact source/anchor text and stale states;
[media](media-preview-slice-proposal.md) owns format validation, versions, buffering, and streaming.
Their byte/line limits remain in the source owners rather than this boundary record. Only a
file-level HTTP 404 becomes `file_not_found` for feedback; identity replacement (HTTP 409) and
project failures preserve drafts for retry.

[Working-file tests](../src/server/working-files.test.ts) cover containment, literal names,
classification, replacement, and descriptor cleanup. Exact access flags and error mappings belong in
[the implementation](../src/server/working-files.ts); domain tests cover their result policies.
