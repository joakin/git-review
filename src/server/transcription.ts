import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { isRecord } from "../shared/validation.ts";
import { AppError } from "./paths.ts";

const runFile = promisify(execFile);
export const maxAudioBytes = 32 * 1024 * 1024;
const maxTranscriptLength = 5_000;
const acceptedAudioTypes = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
]);

function executable(configKey: string, defaults: readonly string[], name: string): string {
  const configured = process.env[configKey];
  const candidates = configured === undefined ? defaults : [configured];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next known location. */
    }
  }
  throw new AppError("internal_error", 503, `${name} is unavailable on this host`);
}

function processTimedOut(error: unknown): boolean {
  return isRecord(error) && error["killed"] === true && error["signal"] === "SIGTERM";
}

export function parseHandyTranscript(raw: string): string {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("internal_error", 503, "Handy returned an unreadable transcription");
  }
  if (!isRecord(value) || typeof value["text"] !== "string") {
    throw new AppError("internal_error", 503, "Handy returned an invalid transcription");
  }
  const text = value["text"].trim();
  if (text.length === 0)
    throw new AppError("invalid_request", 422, "No speech was detected in this recording");
  if (text.length > maxTranscriptLength)
    throw new AppError("invalid_request", 422, "Transcription is too long for one comment");
  return text;
}

async function saveBoundedAudio(request: Request, path: string): Promise<void> {
  if (request.body === null) throw new AppError("invalid_request", 400, "Recording is missing");
  const advertisedLength = request.headers.get("content-length");
  if (
    advertisedLength !== null &&
    (!/^\d+$/.test(advertisedLength) || Number(advertisedLength) > maxAudioBytes)
  ) {
    throw new AppError("invalid_request", 413, "Recording is too large");
  }
  const reader = request.body.getReader();
  const file = await open(path, "wx", 0o600);
  let bytes = 0;
  try {
    while (true) {
      if (request.signal.aborted)
        throw new AppError("invalid_request", 499, "Recording upload was cancelled");
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxAudioBytes)
        throw new AppError("invalid_request", 413, "Recording is too large");
      let offset = 0;
      while (offset < next.value.byteLength) {
        const written = await file.write(next.value, offset, next.value.byteLength - offset);
        if (written.bytesWritten === 0)
          throw new AppError("internal_error", 503, "Recording could not be saved");
        offset += written.bytesWritten;
      }
    }
  } catch (error: unknown) {
    try {
      await reader.cancel();
    } catch {
      /* Preserve the upload error. */
    }
    throw error;
  } finally {
    await file.close();
    reader.releaseLock();
  }
  if (bytes === 0) throw new AppError("invalid_request", 400, "Recording is empty");
}

export function createTranscriptionHandler(): (request: Request) => Promise<Response> {
  let active = false;
  return async (request) => {
    const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type === undefined || !acceptedAudioTypes.has(type))
      throw new AppError("invalid_request", 415, "Unsupported recording format");
    if (active)
      throw new AppError(
        "invalid_request",
        429,
        "Another transcription is running. Try again shortly.",
      );
    active = true;
    let directory: string | null = null;
    try {
      directory = await mkdtemp(join(tmpdir(), "git-review-voice-"));
      const input = join(directory, "recording");
      const wav = join(directory, "normalized.wav");
      await saveBoundedAudio(request, input);
      const ffmpeg = executable(
        "GIT_REVIEW_FFMPEG_PATH",
        ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"],
        "FFmpeg",
      );
      const handy = executable(
        "GIT_REVIEW_HANDY_PATH",
        ["/Applications/Handy.app/Contents/MacOS/handy"],
        "Handy",
      );
      try {
        await runFile(
          ffmpeg,
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-sample_fmt",
            "s16",
            "-f",
            "wav",
            wav,
          ],
          { timeout: 60_000, maxBuffer: 64 * 1024, signal: request.signal },
        );
      } catch (error: unknown) {
        if (request.signal.aborted)
          throw new AppError("invalid_request", 499, "Transcription was cancelled");
        if (processTimedOut(error))
          throw new AppError(
            "internal_error",
            503,
            "Audio conversion timed out. Try a shorter recording.",
          );
        throw new AppError("invalid_request", 422, "This recording could not be decoded");
      }
      const normalized = await stat(wav);
      if (normalized.size <= 44)
        throw new AppError("invalid_request", 422, "Recording contains no audio");
      let stdout: string;
      try {
        const result = await runFile(handy, ["--transcribe-file", wav, "--json"], {
          timeout: 300_000,
          maxBuffer: 256 * 1024,
          signal: request.signal,
        });
        stdout = result.stdout;
      } catch (error: unknown) {
        if (request.signal.aborted)
          throw new AppError("invalid_request", 499, "Transcription was cancelled");
        if (processTimedOut(error))
          throw new AppError(
            "internal_error",
            503,
            "Handy transcription timed out. Try a shorter recording.",
          );
        throw new AppError(
          "internal_error",
          503,
          "Handy could not transcribe this recording. Check its installed model and retry.",
        );
      }
      return Response.json({ text: parseHandyTranscript(stdout) });
    } finally {
      if (directory !== null) await rm(directory, { recursive: true, force: true });
      active = false;
    }
  };
}
