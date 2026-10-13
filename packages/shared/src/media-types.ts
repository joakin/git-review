export const maxImageBytes = 25 * 1024 * 1024;
export const maxAudioVideoBytes = 200 * 1024 * 1024;

export const mediaByteLimits = {
  image: maxImageBytes,
  audio: maxAudioVideoBytes,
  video: maxAudioVideoBytes,
} as const;

const formats = [
  { type: { kind: "image", mimeType: "image/png" }, extensions: [".png"] },
  { type: { kind: "image", mimeType: "image/jpeg" }, extensions: [".jpg", ".jpeg"] },
  { type: { kind: "image", mimeType: "image/gif" }, extensions: [".gif"] },
  { type: { kind: "image", mimeType: "image/webp" }, extensions: [".webp"] },
  { type: { kind: "image", mimeType: "image/avif" }, extensions: [".avif"] },
  { type: { kind: "image", mimeType: "image/svg+xml" }, extensions: [".svg"] },
  { type: { kind: "audio", mimeType: "audio/mpeg" }, extensions: [".mp3"] },
  { type: { kind: "audio", mimeType: "audio/mp4" }, extensions: [".m4a"] },
  { type: { kind: "audio", mimeType: "audio/wav" }, extensions: [".wav"] },
  { type: { kind: "audio", mimeType: "audio/ogg" }, extensions: [".ogg", ".oga"] },
  { type: { kind: "video", mimeType: "video/mp4" }, extensions: [".mp4", ".m4v"] },
  { type: { kind: "video", mimeType: "video/webm" }, extensions: [".webm"] },
  { type: { kind: "video", mimeType: "video/quicktime" }, extensions: [".mov"] },
] as const;

export type MediaType = (typeof formats)[number]["type"];
export type ImageMimeType = Extract<MediaType, { kind: "image" }>["mimeType"];
export type AudioVideoType = Exclude<MediaType, { kind: "image" }>;
export type MediaResource = MediaType & { byteLength: number; url: string };
export type ImageResource = Extract<MediaResource, { kind: "image" }>;
export type AudioVideoResource = Exclude<MediaResource, { kind: "image" }>;

const byExtension = new Map<string, MediaType>();
for (const format of formats)
  for (const extension of format.extensions) byExtension.set(extension, format.type);

export function mediaTypeForPath(path: string): MediaType | null {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : (byExtension.get(path.slice(dot).toLowerCase()) ?? null);
}

export function imageMimeType(path: string): ImageMimeType | null {
  const type = mediaTypeForPath(path);
  return type?.kind === "image" ? type.mimeType : null;
}

export function audioVideoType(path: string): AudioVideoType | null {
  const type = mediaTypeForPath(path);
  return type === null || type.kind === "image" ? null : type;
}

export function findMediaType(kind: unknown, mimeType: unknown): MediaType | null {
  return (
    formats.find((format) => format.type.kind === kind && format.type.mimeType === mimeType)
      ?.type ?? null
  );
}
