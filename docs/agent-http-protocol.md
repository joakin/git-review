# Agent information and HTTP boundary

The independently packaged agent exposes the existing read-only repository API and an information
handshake. Operation and origin configuration belong in the
[root README](../README.md#agent-information-and-frontend-origins); project authorization remains
with [stateless access](stateless-project-access-plan.md) and the filesystem/Git read owners.

## Handshake and optional capabilities

The information endpoint reports the application, protocol revision, build identity, read-only
contract and optional capabilities. It takes no project or query fields and does not resolve a
repository. It returns no root/path, executable location, allowed-origin list, workspace UUID or
Tailscale credential. Build identity describes the running code; it is not project or host identity.
Packaged development builds identify their Git base and dirty state, with a development fallback
when Git metadata is unavailable. Source execution reports development. Release versioning remains
with the
[split host release step](split-host-architecture-proposal.md#12-finish-cloud-bootstrap-and-verify-the-release).

[Shared information types and parsing](../packages/shared/src/agent-info.ts) own the wire shape and
compatibility revision. Parsing identifies an unsupported protocol before interpreting its possibly
different capability schema. Malformed data and a different application fail separately. Matching
build labels do not establish compatibility; the explicit protocol revision does.

Files are the baseline. Git and Search report current executable availability through their actual
resolution rules; this does not promise that every project is a Git repository or that a later
subprocess cannot fail. Transcription distinguishes missing tools from an unverified model. Only a
successful, validated transcript in this agent process verifies the current tool configuration.
Failures revoke that verification; restart loses it. Information requests check executable access
without inference or temporary audio. Request behavior belongs with the
[voice owner](local-voice-comment-slice-proposal.md#host-and-request-boundaries). An unverified
state does not block the transcription route: a client can offer a trial and refresh information
after success or failure.

## Origin, preflight and response ownership

[The HTTP boundary](../apps/agent/src/http.ts) checks the browser origin and route's methods before
delegating repository work. Exact configured frontend origins supplement the current local origin
and the private HTTPS proxy origin. An origin covers its entire scheme/hostname/port, including all
paths on a shared hosting origin. Wildcards and opaque origins are rejected. No-Origin CLI requests
and existing same-origin/native-media access remain supported. Tailscale policy supplies private
network access; this API has no cookie/account authentication, and CORS is not authentication.

Preflight validates bounded method/header lists for that route without resolving projects, reading
files or starting jobs. Invalid origins, methods and preflights receive no permissive CORS headers.
Allowed-origin responses retain CORS on success and repository/capability errors, including unknown
GET routes. The boundary preserves existing Vary values, adds the fields governing its responses,
and exposes the media range headers the browser needs. Successful preflight grants have a bounded
cache lifetime. Credentials remain disabled. These decisions follow the
[Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

Response decoration passes the existing body stream through without buffering; cancellation remains
with its source owner. HEAD preserves status/headers and has no body. Media keeps its MIME,
no-store, descriptor/version and raw-document policies. Cross-origin image/audio/video elements must
use anonymous CORS mode, preserving the existing restriction on
[no-CORS cross-origin embeds](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy).
The [media owner](media-preview-slice-proposal.md) retains those resource contracts.

## Verification and remaining client work

The [QA workflow](qa-workflow.md#agent-information-and-cross-origin-http) owns handler/parser tests,
packaged capability checks, and real Chrome cross-origin scenarios. Local HTTP checks prove the
application boundary; cloud/private HTTPS lifecycle and physical-device proof remain release gates.
The current app still uses its same-origin transport. Endpoint selection, handshake presentation,
native anonymous media and immutable direct-agent requests land in the next transport/UI slices.
