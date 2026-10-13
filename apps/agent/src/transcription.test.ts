import { expect, test } from "bun:test";
import {
  createTranscriptionHandler,
  maxAudioBytes,
  parseHandyTranscript,
} from "./transcription.ts";

test("Handy output must contain bounded, nonempty transcription text", () => {
  expect(parseHandyTranscript('{"text":"  A useful comment.  "}')).toBe("A useful comment.");
  expect(() => parseHandyTranscript("not JSON")).toThrow("unreadable");
  expect(() => parseHandyTranscript('{"text":12}')).toThrow("invalid");
  expect(() => parseHandyTranscript('{"text":"   "}')).toThrow("No speech");
  expect(() => parseHandyTranscript(JSON.stringify({ text: "a".repeat(5_001) }))).toThrow(
    "too long",
  );
});

test("voice upload rejects absent, unsupported, empty, and oversized recordings", async () => {
  const transcribe = createTranscriptionHandler();
  const request = (body: BodyInit | null, type: string, length?: number) =>
    new Request("http://localhost/api/transcriptions", {
      method: "POST",
      headers: {
        "content-type": type,
        ...(length === undefined ? {} : { "content-length": String(length) }),
      },
      body,
    });
  await expect(
    transcribe(request(new Uint8Array([1]), "application/octet-stream")),
  ).rejects.toMatchObject({ status: 415 });
  await expect(transcribe(request(null, "audio/webm"))).rejects.toMatchObject({ status: 400 });
  await expect(transcribe(request(new Uint8Array(0), "audio/webm"))).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    transcribe(request(new Uint8Array([1]), "audio/webm", maxAudioBytes + 1)),
  ).rejects.toMatchObject({ status: 413 });
  // The failure path must not depend on a developer's installed FFmpeg/Handy/model.
  const failingTool = Bun.which("false");
  if (failingTool === null) throw new Error("The voice test requires the POSIX false executable");
  const keys = ["GIT_REVIEW_FFMPEG_PATH", "GIT_REVIEW_HANDY_PATH"];
  const previous = keys.map((key) => ({ key, value: process.env[key] }));
  try {
    for (const key of keys) process.env[key] = failingTool;
    await expect(transcribe(request(new Uint8Array([1]), "audio/webm"))).rejects.toMatchObject({
      status: 422,
    });
  } finally {
    for (const { key, value } of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
