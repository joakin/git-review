# Local voice dictation in comments

Dictation records in the browser and transcribes on the host through FFmpeg and Handy's headless
file CLI. This meets the accepted requirement for local transcription without an OpenAI API key or
per-request API charge. Engine installation and overrides belong in the [root README](../README.md).

## Current user flow

Place the comment caret or select text, then tap the textarea-footer microphone. Capture asks for
browser permission and uses a supported recorder format. Permission denial or unavailable capture
leaves normal typing available. Start/stop cues accompany visual status; sound or the optional level
meter may be unavailable without preventing text entry.

During recording, the footer shows elapsed time, microphone level, and separate **Cancel** and
**Send** controls. Cancel stops capture and discards the clip. Send stops and uploads it; the
five-minute recording limit stops and submits automatically.

The textarea stays read-only while a clip is pending, including a retryable failure, so the saved
insertion range cannot drift. A successful transcript inserts at that caret or replaces only the
selected range, then returns to editable text. Failure preserves the body and in-memory clip for
**Retry**; Cancel restores typing. A transcript that would exceed the comment limit is rejected
without altering the body.

Permission, recording and transcription failures use
[application notifications](application-notifications.md). Recording progress and Retry/Cancel
remain in the composer; dismissing a notice does not discard the saved clip.

Closing the editor saves typed feedback through the [feedback owner](feedback-slice-proposal.md),
stops the microphone, cancels pending requests, and discards audio. Late results cannot enter a
reopened editor. Clips never enter browser storage or backups.

## Host and request boundaries

[The voice owner](../apps/web/src/VoiceComment.tsx) defines recorder formats, upload/recording
limits, cues, cleanup, and insertion.
[The transcription adapter](../apps/agent/src/transcription.ts) validates bounded audio, permits one
active host job, normalizes it to mono PCM WAV, and invokes Handy with fixed argument arrays.
Handy's selected installed model performs inference locally.

Tool resolution is lazy: typed-review startup does not require voice executables or a model. The
standalone agent packages the same adapter. Absolute executable overrides take precedence; FFmpeg
discovery retains standard local locations and also checks absolute PATH entries. Missing or invalid
tools return a request-local unavailable error. The
[agent information handshake](agent-http-protocol.md#handshake-and-optional-capabilities)
distinguishes absent tools, an unverified model and successful verification in this process. A
failed later attempt revokes verification; restart resets it. Uploads use the composer's explicitly
bound agent API, with the same cancellation and retry behavior. Capability presentation and host
selection remain subsequent [split host slices](split-host-architecture-proposal.md); the current
local composer retains its user flow.

The adapter bounds subprocess time and output, validates nonempty transcript JSON, removes temporary
audio in failure and cancellation paths, and releases the job slot. Unsupported or undecodable
audio, unavailable executables/model, silence, timeout, concurrent jobs, and cancellation return
useful errors through the shared JSON error boundary. Audio and transcript contents are not logged
by default. Mobile microphone capture requires the private secure origin described in the
[installation record](independent-tabs-and-pwa-proposal.md#installation-and-offline-behavior). A
separate hosted frontend requires its own secure page origin for microphone capture.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies recorder and transcription checks.
[Idle](../qa/screenshots/voice-comment-idle/mobile.png) and
[recording](../qa/screenshots/voice-comment-recording/mobile.png) are inspected historical four-size
milestones. A synthetic speech clip succeeded through Handy, the local endpoint, and private HTTPS
on 2026-09-28; the maintainer reported working phone dictation. Browser QA uses controlled recording
and responses for insertion, Retry, Cancel, automatic Send, and editor dismissal. It does not
establish actual microphone permission, recording cues, iOS capture, background interruptions, or
device keyboard behavior. Those additional device checks remain unverified.
