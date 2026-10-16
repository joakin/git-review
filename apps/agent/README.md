# Read-only agent

Bun HTTP API for repository inspection. It owns approved-root resolution, working files, Git reads,
source checks, media, and optional local transcription. [Main](src/main.ts) serves API routes only;
the root [local composition](../../scripts/serve.ts) also serves frontend assets. Use
[operations](../../docs/current/operations.md) for startup and deployment.

## HTTP and project access

[Configuration](src/config.ts) validates startup options before listening. [HTTP](src/http.ts)
checks exact browser origins, route methods, and preflights before repository work. It preserves
streaming, error visibility for permitted origins, and media headers without buffering responses.
Credentials are disabled; private network access is enforced externally. No API accepts arbitrary
commands.

The information endpoint reports protocol compatibility, build identity, and optional capabilities
without resolving a project or invoking inference. [Agent information](src/agent-info.ts) and the
[shared parser](../../packages/shared/src/agent-info.ts) distinguish malformed,
unsupported-protocol, and wrong-application responses. Build identity is not project identity. Files
is the baseline; Git/Search depend on executable availability. Transcription remains unverified
until a successful transcript in this process; failures revoke that verification and restart resets
it.

[Paths](src/paths.ts) canonicalizes the approved root and project selection. Every resource request
revalidates its canonical project path against the root. Missing, changed, and forbidden projects
are distinct from a missing file, so project failure cannot incorrectly invalidate feedback. Picker
metadata and cached project information grant no later access.

## Working files and Git

[Working-file access](src/working-files.ts) owns literal path validation, containment, no-follow
opening, file/parent identity rechecks, and descriptor lifetime. It avoids following intermediate
links even within the project. Scoped reads close on every completion path; streaming explicitly
transfers descriptor ownership. These checks are not an atomic OS directory-relative walk, and
descriptor identity does not establish unchanged content.

[Files](src/project-files.ts) owns listing/display policy and CRLF normalization.
[Source text](src/source-text.ts) shares bounded decoding without normalizing exact diff source.
Invalid UTF-8 and NUL-containing data are not source text. Domains retain their own byte/line limits
and version/error policy.

[Git execution](src/git-execution.ts) uses fixed read commands, literal argument arrays/pathspecs, a
controlled environment, output budgets, deadlines, and cleanup. It disables optional writes and
fsmonitor hooks. [Git context](src/git-context.ts) preserves selected-subfolder scope and validates
full object IDs; the [object reader](src/git-objects.ts) validates kinds/sizes before bounded reads.
Rename origins can leave the selected subtree, but not the repository; working-copy reads also
enforce the approved root. Never substitute a namesake at repository root.

[Status](src/git-status.ts) owns working inventory and the metadata-based ordinary edit signal.
[Change statistics](src/change-stats.ts), [diffs](src/git-diff.ts), and
[history](src/git-history.ts) retain distinct source/freshness policies. History is pinned; merge
commits compare against first parent, root commits against an empty tree, and unavailable shallow
parents remain unavailable. No history operation fetches or checks out code. Word details augment
ordinary patch identity instead of replacing it. [Diff context](src/diff-context.ts) reveals bounded
exact source without rewriting ordinary hunk anchors.

## Search, feedback, and media

[Search](src/search.ts) invokes fixed ripgrep arguments without a shell. It honors ignore rules,
includes hidden files, excludes Git control directories, and does not follow symlinks. No match is
an empty result; truncation is explicit; malformed output, timeout, and execution failures are
errors. Shared [query validation](../../packages/shared/src/search-query.ts) is used across layers.

[Feedback checks](src/feedback-check.ts) batch and deduplicate exact anchors, sharing bounded source
work while preserving layer, side, rename, and context semantics. File-only checks require no Git.
Before/after inventories and relevant working versions detect intervening changes without claiming
an atomic snapshot. Missing/non-text sources differ from unavailable reads. Comment bodies and
copied history never need to reach the agent. The [web README](../web/README.md#feedback) owns copy
and recovery semantics.

[Media](src/media.ts) resolves exact working or Git comparison sides and validates versions on raw
reads. [Streaming](src/media-stream.ts) owns range/HEAD responses, descriptor/Git stream cleanup,
and mutable-version checks. Read deadlines apply while awaiting bytes, not to total playback time
under backpressure. Raw resources use allowlisted MIME types, no-store and no-sniff policies; raw
SVG documents also receive a sandboxed CSP. Native browser decoding can still fail.

[Transcription](src/transcription.ts) validates bounded audio, permits one active job, normalizes
through FFmpeg, and invokes Handy with fixed arguments. Tool resolution is lazy so missing voice
tools do not prevent typed review. Jobs bound time/output and clean temporary audio on failure or
cancellation. Audio and transcripts are not logged by default.

## Packaging and cloud supervision

[Build tooling](../../scripts/build-agent.ts) bundles the runtime, Shiki languages, and Oniguruma
WebAssembly with dependency/copyright notices and an operator guide. The artifact needs no source
checkout, frontend assets, or package installation.

The optional [cloud launcher](src/cloud-main.ts) supervises a separate userspace Tailscale node,
private Serve proxy, and agent. It owns its socket/state and processes; it does not alter an
existing managed VPN node. It prints the actual assigned address, handles orderly cleanup, and
cannot extend provider uptime or clean up after an abrupt VM kill.
[Cloud configuration](src/cloud-config.ts) and [the installer](../../deploy/install-linux.sh) own
supported inputs and tool pins. Generic cloud deployment remains experimental under the
[project limitations](../../docs/current/project.md).
