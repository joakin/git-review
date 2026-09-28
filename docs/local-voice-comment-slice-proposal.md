# Local voice dictation in comments: first slice proposal

Status: flow agreed with the maintainer; implement after review of the selected-code Search checkpoint. The [initial plan](initial-implementation-plan.md) records the earlier engine comparison and full voice scope.

## Verified host capability

The installed Handy 0.9.6 binary supports `--transcribe-file <WAV> --json` and uses the downloaded `parakeet-tdt-0.6b-v3` model by default. On 2026-09-28, a locally synthesized 1.8-second English WAV, normalized by FFmpeg to 16 kHz mono PCM, produced a JSON result whose `text` was `The code review comment is ready.` No OpenAI API call or subscription bridge was involved. Handy exited with code 134 inside this task's sandbox, but succeeded under ordinary host permissions. The actual HTTPS server process and phone microphone capture have not yet been tested.

## User flow and smallest checkpoint

1. Open a line comment and put the caret where dictation should go. The textarea has a small footer with a microphone button. Tapping it saves the current caret or selected range, asks for microphone access, and starts recording. Play a short start cue when capture begins. A denied permission or unsupported recorder leaves normal typing available.
2. While recording, replace the footer with an elapsed timer and a modest live microphone-level display. Put **Cancel** on the left and **Send** on the right, with enough separation and distinct styling to avoid an accidental discard. Keep the comment text visible. Cancel stops capture and discards the clip; Send stops capture and submits it for transcription. Play a stop cue whenever recording ends, including Cancel, Send, or the time limit.
3. Cap recording at **five minutes**. At the limit, stop capture, play the stop cue, and automatically submit the captured clip for transcription. Show progress in the same footer. The server normalizes audio with FFmpeg and runs the installed Handy model locally.
4. On success, insert the returned text into the textarea at the saved caret. If text was selected when the microphone was tapped, replace only that selected range. Do not ask for append/replace and never replace the whole comment implicitly. Restore focus with the caret after the inserted text; the user can edit it normally before saving the comment.
5. On transcription failure, keep the recorded Blob in memory and the comment unchanged. The footer shows the error, **Cancel** on the left, and **Retry** on the right. Retry resends the same clip. Cancel discards it. No audio is persisted across reloads or kept after success/cancellation.

The first reviewable checkpoint is one recording from the comment textarea footer through automatic insertion at the saved caret. It does not add live streaming, automatic punctuation controls, language selection, or background transcription queues.

## API and data shape

- `POST /api/transcriptions` accepts one bounded audio upload from the same origin. The browser selects a supported `MediaRecorder` MIME type at runtime and sends the actual Blob and declared type. The server rejects absent/unsupported types, empty or oversized bodies, and concurrent jobs before starting FFmpeg. Keep an independent byte cap even with the five-minute timer, so a misbehaving recorder cannot exhaust server memory or disk. The current app relies on private HTTPS and same-origin checks; it has no app-level account system.
- The server streams to a temporary file with a strict byte cap, invokes FFmpeg and Handy with fixed executable paths and argument arrays, and sets process timeouts. FFmpeg output is 16 kHz mono 16-bit PCM WAV. Concurrency starts at one transcription per host. Delete both temporary files in `finally`, including timeout and cancellation paths.
- Parse Handy stdout as untrusted JSON and accept only a bounded nonempty `text` string. Return `{ text }` to the browser. Treat missing model, nonzero exit, malformed JSON, silence, timeout, and cancellation as distinct useful errors. Never log raw audio or transcript text by default.
- The browser records a precise state variant: idle, recording, transcribing, or retryable-error. Save the textarea's `selectionStart`/`selectionEnd` when the microphone is tapped. Keep text edits read-only while a voice clip is pending, including a retryable failure, so the saved insertion point cannot drift; Cancel restores editing and failure preserves the original body. Insert the transcript through the textarea's range operation and synchronize Preact state, then restore the caret after it. [MDN textarea selection](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/selectionStart), [MDN setRangeText](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setRangeText)
- Generate the short start/stop cues locally with Web Audio after the user gesture. Use distinct tones and a visual timer/status as well, because device sound may be muted. The level display reads microphone amplitude locally and is optional if the browser cannot provide it. [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)

## Failure cases and QA

- Verify MIME choices and recording behavior on real Android Chrome and iOS Safari over the installed HTTPS origin. Test permission denial, no microphone, device interruption, Send/Cancel, five-minute automatic stop and cue, silent input, too-large input, Handy unavailable, model unavailable, FFmpeg failure, timeout, retry, and a second simultaneous request.
- Check that closing the editor stops the microphone, discards unsent audio, and retains already typed feedback. Confirm insertion at the beginning, middle, and end of a comment and replacement of only a selected range. Browser reload should retain saved comment text; audio remains temporary.
- Add focused behavior tests for bounded upload/CLI result parsing and error cleanup. Capture comment-sheet states at phone, tablet portrait, tablet landscape, and desktop sizes. Verify the real device microphone and keyboard layout before calling the feature complete.

## Design assumptions to confirm

The maintainer chose a textarea-footer workflow: microphone → live timer/level with separate Cancel and Send → progress → automatic insertion at the saved cursor. The textarea is temporarily read-only while a voice clip is pending, which keeps the saved insertion position exact. At five minutes, recording stops with an audible cue and automatically submits for transcription.
