import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { ChangeLayer, MediaResource } from "../shared/api.ts";

export const maxImageBytes = 25 * 1024 * 1024;

const mimeByExtension = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
]);

export function imageMimeType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : (mimeByExtension.get(path.slice(dot).toLowerCase()) ?? null);
}

export function validImageHeader(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  switch (mimeType) {
    case "image/png":
      return (
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
      );
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif":
      return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/avif":
      return ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, Math.min(bytes.length, 64)));
    case "image/svg+xml": {
      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return false;
      }
      return /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)*(?:(?:<!--[^]*?-->|<!DOCTYPE\s+svg(?:[^>"']|"[^"]*"|'[^']*')*>)\s*)*<svg(?:\s|>)/i.test(
        source,
      );
    }
    default:
      return false;
  }
}

export function workingVersion(metadata: Stats): string {
  return createHash("sha256")
    .update(
      `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`,
    )
    .digest("hex")
    .slice(0, 20);
}

export function fileImageResource(
  projectId: string,
  path: string,
  version: string,
  mimeType: string,
  byteLength: number,
): MediaResource {
  const query = new URLSearchParams({ path, version });
  return {
    kind: "image",
    mimeType,
    byteLength,
    url: `/api/projects/${projectId}/raw/file?${query}`,
  };
}

export function diffImageResource(
  projectId: string,
  layer: ChangeLayer,
  path: string,
  revision: string,
  side: "old" | "new",
  version: string,
  mimeType: string,
  byteLength: number,
): MediaResource {
  const query = new URLSearchParams({ layer, path, revision, side, version });
  return {
    kind: "image",
    mimeType,
    byteLength,
    url: `/api/projects/${projectId}/raw/diff?${query}`,
  };
}
