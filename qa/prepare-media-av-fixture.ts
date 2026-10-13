import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit as git } from "./test-support.ts";

const fixture = resolve("qa/.artifacts/media-av-fixture");
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
git(fixture, "init", "-q");
sound(440);
clip("red");
git(fixture, "add", "sound.wav", "clip.mp4");
git(fixture, "commit", "-qm", "baseline");
sound(660);
clip("green");
git(fixture, "add", "sound.wav", "clip.mp4");
sound(880);
clip("blue");
console.log(`Media audio/video fixture ready: ${fixture}`);
