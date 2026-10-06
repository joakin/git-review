# Checked working-file boundaries

Status: M12 accepted and committed as `379d870` on 2026-10-05

[working-files.ts](../src/server/working-files.ts) owns path validation, approved/project
containment, no-follow inspection, regular-file opening, identity rechecks and bounded-reader
descriptor lifetime. HTTP handlers resolve the supplied canonical project path before calling its
readers.

## Path and identity checks

Project-relative paths reject absolute paths, empty interior segments, traversal, NUL bytes and Git
control directories. The empty path remains valid for the directory root. Literal backslashes remain
valid filename characters on POSIX; Windows paths retain their backslash rejection.

The reader checks the selected project's canonical location against both containment roots, then
inspects each relative component with `lstat`. Intermediate links are rejected, including links to
another directory inside the project. Final links and special files can be classified without
opening them. The Files tree uses this same inspection boundary.

Regular files open through the literal checked path with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. The
descriptor must still be a regular file with the original device/inode identity. A second inspection
compares every path component, including the project and parent directories, against the initial
snapshot and compares the current leaf to the descriptor. Replacing a parent is detected even when
the new directory contains a hard link to the original leaf. Bounded readers repeat these identity
checks after their read before returning its result.

The reader does not call Bun's `realpath` on individual files. In the installed runtime that call
rejects literal backslash filenames and can wait on a FIFO. Checking the canonical project,
validating literal relative components and rechecking their identities preserves those filenames and
avoids a FIFO wait before the nonblocking open.

These are portable checks around descriptor access, not an atomic walk using directory-relative OS
descriptors. The tests deliberately replace files and parents during a scoped read; they do not
establish protection against every possible concurrent filesystem mutation. An opened descriptor
pins a file's identity, not its mutable content version.

## Descriptor ownership and domain policy

`withCheckedWorkingFile` opens, checks, runs a bounded reader, rechecks and closes in `finally`.
Opening/checking failures also close any descriptor already acquired. Caller failures retain their
error while releasing the descriptor. The primitive translates ordinary absence, access denial and
link errors; detected identity replacement reports HTTP 409 with `not_found`.

`openCheckedWorkingFile` explicitly transfers a checked descriptor to the audio/video owner. Format,
size or version rejection before transfer to the response closes it. The existing stream owner then
closes on completion, cancellation or failure; HEAD and invalid ranges close before returning a
response. Streaming retains its before/after-chunk content-version checks.

| Caller             | Policy retained by that caller                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files text         | 1 MiB and 20,000 lines; fatal UTF-8/NUL classification; CRLF display normalization; syntax fallback; named unsupported/link/limit states. Only file-level HTTP 404 becomes `file_not_found` for feedback. |
| Working-copy diffs | 1 MiB source reads; exact CRLF source and anchor text; binary/link/limit states; absence or identity replacement becomes a stale diff. Git patch parsing and historical object reads remain separate.     |
| Images             | 25 MiB limit; format/header validation; metadata version, byte-count and post-read version checks; raw response headers.                                                                                  |
| Audio/video        | 200 MiB limit; format/header validation; metadata version; descriptor streaming, range/HEAD behavior and per-chunk version checks.                                                                        |

Byte limits and content/version decisions remain in these callers. Sized text/diff buffers still
read at most their limit plus one byte, detecting growth beyond the budget. The shared owner does
not decode, normalize, buffer media, or reinterpret domain result variants.
