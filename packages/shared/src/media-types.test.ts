import { expect, test } from "bun:test";
import { imageMimeType, audioVideoType } from "./media-types.ts";

const formats = [
  { kind: "image", mimeType: "image/png", extensions: [".png"] },
  { kind: "image", mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  { kind: "image", mimeType: "image/gif", extensions: [".gif"] },
  { kind: "image", mimeType: "image/webp", extensions: [".webp"] },
  { kind: "image", mimeType: "image/avif", extensions: [".avif"] },
  { kind: "image", mimeType: "image/svg+xml", extensions: [".svg"] },
  { kind: "audio", mimeType: "audio/mpeg", extensions: [".mp3"] },
  { kind: "audio", mimeType: "audio/mp4", extensions: [".m4a"] },
  { kind: "audio", mimeType: "audio/wav", extensions: [".wav"] },
  { kind: "audio", mimeType: "audio/ogg", extensions: [".ogg", ".oga"] },
  { kind: "video", mimeType: "video/mp4", extensions: [".mp4", ".m4v"] },
  { kind: "video", mimeType: "video/webm", extensions: [".webm"] },
  { kind: "video", mimeType: "video/quicktime", extensions: [".mov"] },
];

test("media discovery preserves every extension alias and case-insensitive suffix", () => {
  for (const { kind, mimeType, extensions } of formats)
    for (const extension of extensions)
      for (const path of [extension, `folder.with.dots/odd\\ ?#% ñ${extension.toUpperCase()}`]) {
        expect<unknown>(imageMimeType(path)).toBe(kind === "image" ? mimeType : null);
        expect<unknown>(audioVideoType(path)).toEqual(kind === "image" ? null : { kind, mimeType });
      }
});

test("media discovery requires a supported final suffix", () => {
  for (const path of [
    "",
    "no-extension",
    "file.",
    "file.svg.txt",
    "file.svg/child",
    "folder.png/file",
    "file.svg?download=1",
    "file.svg.pngx",
    "file.flac",
    "file.avi",
  ])
    expect([imageMimeType(path), audioVideoType(path)]).toEqual([null, null]);
});
