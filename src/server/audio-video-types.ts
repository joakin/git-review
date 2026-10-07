import { projectApiUrl } from "../shared/project-path.ts";
import type { ChangeLayer } from "../shared/api.ts";
import type { AudioVideoResource, AudioVideoType } from "../shared/media-types.ts";

export function validAudioVideoHeader(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  switch (mimeType) {
    case "audio/mpeg":
      return (
        ascii(0, 3) === "ID3" || (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] ?? 0) >= 224)
      );
    case "audio/mp4":
    case "video/mp4":
    case "video/quicktime":
      return ascii(4, 8) === "ftyp";
    case "audio/wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "video/webm":
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3
      );
    default:
      return false;
  }
}

export function fileAudioVideoResource(
  projectPath: string,
  path: string,
  version: string,
  type: AudioVideoType,
  byteLength: number,
): AudioVideoResource {
  return {
    ...type,
    byteLength,
    url: projectApiUrl("/raw/file", projectPath, { path, version }),
  };
}

export function diffAudioVideoResource(
  projectPath: string,
  layer: ChangeLayer,
  path: string,
  revision: string,
  side: "old" | "new",
  version: string,
  type: AudioVideoType,
  byteLength: number,
): AudioVideoResource {
  return {
    ...type,
    byteLength,
    url: projectApiUrl("/raw/diff", projectPath, { layer, path, revision, side, version }),
  };
}
