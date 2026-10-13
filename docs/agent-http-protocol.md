# Agent protocol and browser connections

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

## Explicit browser connection

The [connection boundary](../apps/web/src/agent-connection.ts) captures one normalized agent origin
when it is created. HTTPS origins without credentials, a subpath, query or fragment are supported;
HTTP loopback needs an explicit development option. A separate page-origin adapter preserves the
current local composition, including its legacy HTTP entrypoint. It captures the actual page origin
and accepts no alternate address.

The connection accepts only validated agent-relative API routes. Scripted requests always omit
credentials and reject fetch redirects, while retaining the caller's signal, body and cache policy.
The response stream passes through without buffering. A redirected response or a response from a
different URL is rejected even if an injected fetch implementation returns one. This follows the
browser's
[request redirect policy](https://developer.mozilla.org/en-US/docs/Web/API/Request/redirect). There
is no mutable global agent address for delayed work to consult.

The [bound API](../apps/web/src/agent-api.ts) composes domain factories with this connection.
Changes and commit diff queues belong to that API instance, so equal paths and version keys on two
agents cannot group requests or redirect deferred single-file reads. Shared parsers, body budgets,
source echoes, version checks and cancellation remain at their existing boundaries. The
[root provider](../apps/web/src/AgentApiProvider.tsx) supplies that API to request owners:

| Request family                                                                               | Owner                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Information, root/picker, project, Files/Search, status/polling, languages and transcription | [Repository API](../apps/web/src/api.ts)                                                                                              |
| Working-copy and historical diff batches, deferred reads                                     | [Changes API](../apps/web/src/change-diff-api.ts), [Git API](../apps/web/src/git-api.ts)                                              |
| Git refs, history/pages and commit detail                                                    | [Git API](../apps/web/src/git-api.ts)                                                                                                 |
| Feedback source checks and diff context/anchor checks                                        | [Feedback API](../apps/web/src/feedback-check-api.ts), [context API](../apps/web/src/diff-context-api.ts)                             |
| Native previews and raw links                                                                | [Media binding](../apps/web/src/connected-media.ts), [media behavior](media-preview-slice-proposal.md#source-and-response-boundaries) |

After wire parsing, media binding verifies the requested project, file or comparison source, side
and content-version format. Only the expected relative raw route and its exact query fields are
accepted; alternate origins, repeated fields and wrong sources fail. The resulting absolute URL
retains the connection that loaded it, including delayed presentation. Native image/audio/video
elements use anonymous CORS, omitting cross-origin cookies; raw links use that same bound URL.
Native playback keeps browser streaming and redirect behavior. The agent's raw routes do not
redirect; the scripted-request redirect rejection is not a browser-element redirect control.

The production bootstrap still explicitly chooses the page-origin connection. Endpoint selection,
handshake presentation, endpoint-owned routes/caches and persisted reviews remain the subsequent
[split host slices](split-host-architecture-proposal.md). This transport foundation does not yet
enable switching hosts in the UI.

## Verification and remaining release work

The [QA workflow](qa-workflow.md#agent-information-and-cross-origin-http) owns handler/parser tests,
packaged capability checks, and real Chrome cross-origin scenarios. Local HTTP checks prove the
application boundary; cloud/private HTTPS lifecycle and physical-device proof remain release gates.
The [client transport check](qa-workflow.md#explicit-client-transport) exercises the actual bound
browser APIs and frontend against separate agents, alongside queue, cancellation and source-binding
unit tests. Endpoint-owned UI state and connection management remain separate review steps.
