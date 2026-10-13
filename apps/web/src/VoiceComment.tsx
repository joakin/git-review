import { useEffect, useRef, useState } from "preact/hooks";
import { useAgentApi, useAgentLifetime } from "./AgentApiProvider.tsx";
import { maxBodyLength } from "./comments.ts";
import { useNotification } from "./Notifications.tsx";

type VoiceState =
  | { kind: "idle"; error: string | null }
  | { kind: "starting" }
  | { kind: "recording"; seconds: number; level: number }
  | { kind: "sending" }
  | { kind: "retry"; error: string };

type SavedRange = { start: number; end: number };
const maxRecordingMs = 5 * 60 * 1000;
const maxRecordingBytes = 32 * 1024 * 1024;
const mimeChoices = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Microphone permission was denied. Allow it in your browser settings and retry.";
  return error instanceof Error ? error.message : "Voice recording failed";
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useVoiceComment(
  textareaRef: { current: HTMLTextAreaElement | null },
  onBody: (body: string) => void,
) {
  const api = useAgentApi();
  const lifetime = useAgentLifetime();
  const [state, setState] = useState<VoiceState>({ kind: "idle", error: null });
  useNotification(
    "voice-error",
    (state.kind === "idle" || state.kind === "retry") && state.error !== null
      ? { message: state.error, severity: "error" }
      : null,
  );
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const clip = useRef<Blob | null>(null);
  const selection = useRef<SavedRange>({ start: 0, end: 0 });
  const request = useRef<AbortController | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const startedAt = useRef(0);
  const sendOnStop = useRef(false);
  const recordingError = useRef<string | null>(null);

  function stopMeters(): void {
    if (interval.current !== null) clearInterval(interval.current);
    if (limit.current !== null) clearTimeout(limit.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    interval.current = null;
    limit.current = null;
    frame.current = null;
  }

  function stopTracks(): void {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  function cue(kind: "start" | "stop"): void {
    const context = audio.current;
    if (context === null || context.state === "closed") return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = kind === "start" ? 660 : 440;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.17);
    } catch {
      /* Visual status remains available when sound is blocked. */
    }
  }

  async function sendClip(recording: Blob): Promise<void> {
    if (!mounted.current) return;
    if (recording.size === 0) {
      clip.current = null;
      setState({ kind: "idle", error: "No audio was recorded. Try again." });
      return;
    }
    if (recording.size > maxRecordingBytes) {
      clip.current = null;
      setState({ kind: "idle", error: "Recording is too large. Make a shorter clip." });
      return;
    }
    const controller = lifetime.createController();
    request.current = controller;
    setState({ kind: "sending" });
    try {
      const text = await api.transcribeRecording(recording, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const textarea = textareaRef.current;
      if (textarea === null) throw new Error("The comment editor is no longer available");
      const { start, end } = selection.current;
      if (textarea.value.length - (end - start) + text.length > maxBodyLength) {
        throw new Error(
          `This transcript would exceed the ${maxBodyLength}-character comment limit. Cancel, shorten the comment, and record again.`,
        );
      }
      textarea.setRangeText(text, start, end, "end");
      onBody(textarea.value);
      clip.current = null;
      setState({ kind: "idle", error: null });
      textarea.focus();
    } catch (error: unknown) {
      if (mounted.current && !controller.signal.aborted)
        setState({ kind: "retry", error: errorMessage(error) });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function finish(send: boolean): void {
    const current = recorder.current;
    if (current === null || current.state === "inactive") return;
    sendOnStop.current = send;
    stopMeters();
    cue("stop");
    current.stop();
    stopTracks();
    if (send) setState({ kind: "sending" });
  }

  async function start(): Promise<void> {
    if (state.kind !== "idle") return;
    const textarea = textareaRef.current;
    if (textarea === null) return;
    selection.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState({
        kind: "idle",
        error: "This browser cannot record audio here. Use HTTPS and allow microphone access.",
      });
      return;
    }
    setState({ kind: "starting" });
    try {
      try {
        if (audio.current === null || audio.current.state === "closed")
          audio.current = new AudioContext();
        await audio.current.resume();
      } catch {
        audio.current = null;
      }
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = captured;
      const mimeType = mimeChoices.find((choice) => MediaRecorder.isTypeSupported(choice));
      const current =
        mimeType === undefined
          ? new MediaRecorder(captured)
          : new MediaRecorder(captured, { mimeType });
      if (!/^(audio\/(webm|mp4|ogg|wav|x-wav))(;|$)/.test(current.mimeType))
        throw new Error("This browser records an audio format the server cannot read");
      recorder.current = current;
      chunks.current = [];
      sendOnStop.current = false;
      recordingError.current = null;
      current.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      current.onerror = () => {
        recordingError.current = "Recording was interrupted. Try again.";
        finish(false);
      };
      current.onstop = () => {
        recorder.current = null;
        stopMeters();
        stopTracks();
        const recording = new Blob(chunks.current, { type: current.mimeType });
        chunks.current = [];
        if (!mounted.current || !sendOnStop.current) {
          clip.current = null;
          if (mounted.current) setState({ kind: "idle", error: recordingError.current });
          return;
        }
        clip.current = recording;
        void sendClip(recording);
      };
      current.start(1000);
      startedAt.current = Date.now();
      cue("start");
      setState({ kind: "recording", seconds: 0, level: 0 });
      interval.current = setInterval(() => {
        const seconds = Math.min(300, Math.floor((Date.now() - startedAt.current) / 1000));
        setState((previous) =>
          previous.kind === "recording" ? { ...previous, seconds } : previous,
        );
      }, 250);
      limit.current = setTimeout(() => finish(true), maxRecordingMs);
      const context = audio.current;
      if (context !== null) {
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(captured).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let lastUpdate = 0;
        const measure = (now: number) => {
          analyser.getByteTimeDomainData(samples);
          if (now - lastUpdate > 100) {
            const level = Math.min(
              1,
              Math.max(...samples.map((sample) => Math.abs(sample - 128))) / 40,
            );
            setState((previous) =>
              previous.kind === "recording" ? { ...previous, level } : previous,
            );
            lastUpdate = now;
          }
          frame.current = requestAnimationFrame(measure);
        };
        frame.current = requestAnimationFrame(measure);
      }
    } catch (error: unknown) {
      stopMeters();
      stopTracks();
      recorder.current = null;
      if (mounted.current) setState({ kind: "idle", error: errorMessage(error) });
    }
  }

  function cancel(): void {
    request.current?.abort();
    request.current = null;
    clip.current = null;
    if (recorder.current?.state === "recording") finish(false);
    else setState({ kind: "idle", error: null });
  }

  useEffect(() => {
    const dispose = () => {
      mounted.current = false;
      request.current?.abort();
      stopMeters();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
      void audio.current?.close();
      clip.current = null;
    };
    if (lifetime.signal.aborted) dispose();
    else lifetime.signal.addEventListener("abort", dispose, { once: true });
    return () => {
      lifetime.signal.removeEventListener("abort", dispose);
      dispose();
    };
  }, [lifetime]);

  return {
    state,
    start,
    send: () => finish(true),
    cancel,
    retry: () => {
      if (clip.current !== null) void sendClip(clip.current);
    },
    locked: state.kind !== "idle",
  };
}

export function VoiceCommentFooter({ voice }: { voice: ReturnType<typeof useVoiceComment> }) {
  const state = voice.state;
  return (
    <div class="voice-footer" aria-live="polite">
      {state.kind === "idle" && (
        <>
          <span class="voice-status">Voice comment · transcribed locally</span>
          <button
            type="button"
            class="voice-mic"
            aria-label="Record voice comment"
            title="Record voice comment"
            onClick={() => void voice.start()}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
            </svg>
          </button>
        </>
      )}
      {state.kind === "starting" && <span class="voice-status">Waiting for microphone…</span>}
      {state.kind === "recording" && (
        <>
          <button type="button" class="voice-cancel" onClick={voice.cancel}>
            Cancel
          </button>
          <span class="voice-recording">
            <span class="voice-live-dot" />
            {formatTime(state.seconds)}{" "}
            <meter min="0" max="1" value={state.level} aria-label="Microphone level" />
          </span>
          <button type="button" class="voice-send" onClick={voice.send}>
            Send
          </button>
        </>
      )}
      {state.kind === "sending" && (
        <>
          <button type="button" class="voice-cancel" onClick={voice.cancel}>
            Cancel
          </button>
          <span class="voice-status" role="status">
            Transcribing locally…
          </span>
        </>
      )}
      {state.kind === "retry" && (
        <>
          <button type="button" class="voice-cancel" onClick={voice.cancel}>
            Cancel
          </button>
          <span class="voice-status">Recording ready to retry</span>
          <button type="button" class="voice-send" onClick={voice.retry}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
