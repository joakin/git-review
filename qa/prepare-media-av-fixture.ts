import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = resolve("qa/.artifacts/media-av-fixture");
const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
const ffmpeg = (...args: string[]) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    cwd: fixture,
    stdio: "pipe",
  });
const sound = (frequency: number) =>
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:duration=2`,
    "-c:a",
    "pcm_s16le",
    "sound.wav",
  );
const clip = (color: string) =>
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=320x180:r=15:d=2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "clip.mp4",
  );

await mkdir(fixture);
git("init", "-q");
sound(440);
clip("red");
git("add", "sound.wav", "clip.mp4");
git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");
sound(660);
clip("green");
git("add", "sound.wav", "clip.mp4");
sound(880);
clip("blue");
console.log(`Media audio/video fixture ready: ${fixture}`);
