import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testGit } from "../src/test-support.ts";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--root" || args[1] === undefined))
  throw new Error("Usage: bun qa/prepare-feasibility-fixture.ts [--root <new directory>]");
const fixture = resolve(args[1] ?? "qa/.artifacts/feasibility-fixture");
// Refuse to overwrite an existing directory, even one that looks like an earlier fixture.
await mkdir(fixture);
await writeFile(
  resolve(fixture, "review.txt"),
  "git-review feasibility\nThis file is read from the agent workspace.\n",
);
await writeFile(
  resolve(fixture, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#246b56"/><text x="20" y="100" fill="white" font-size="24">Agent image loaded</text></svg>',
);
const sampleRate = 8000;
const samples = sampleRate * 4;
const wave = Buffer.alloc(44 + samples * 2);
wave.write("RIFF", 0);
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(sampleRate, 24);
wave.writeUInt32LE(sampleRate * 2, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(samples * 2, 40);
for (let index = 0; index < samples; index += 1)
  wave.writeInt16LE(
    Math.round(1000 * Math.sin((2 * Math.PI * 440 * index) / sampleRate)),
    44 + index * 2,
  );
await writeFile(resolve(fixture, "sound.wav"), wave);
await copyFile(new URL("./feasibility/clip.mp4", import.meta.url), resolve(fixture, "clip.mp4"));
testGit(fixture, "init", "-q");
testGit(fixture, "add", "review.txt", "image.svg", "sound.wav", "clip.mp4");
testGit(fixture, "commit", "-qm", "Feasibility fixture");
await writeFile(
  resolve(fixture, "review.txt"),
  "git-review feasibility\nThis file is read from the agent workspace.\nA working-tree change is visible to Git.\n",
);
console.log(`Disposable Git/media fixture: ${fixture}`);
