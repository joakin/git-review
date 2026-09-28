import { useEffect, useState } from "preact/hooks";
import type { MediaResource, MediaSide } from "../shared/api.ts";

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function MediaPreview({ resource, path, label }: { resource: MediaResource; path: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [resource.url]);
  const playable = resource.kind === "image" || document.createElement(resource.kind).canPlayType(resource.mimeType) !== "";
  return <div class="media-preview">
    <div class="media-preview-head"><span><strong>{label}</strong> · {resource.mimeType} · {sizeLabel(resource.byteLength)}</span><a href={resource.url} target="_blank" rel="noopener">Open raw ↗</a></div>
    {failed || !playable ? <p class="media-preview-fallback" role="status">{playable ? "This media file could not be displayed." : "This browser does not support this media format."} You can open the raw file.</p> : resource.kind === "image" ? <img src={resource.url} alt={`${label}: ${path}`} loading="lazy" onError={() => setFailed(true)} /> : resource.kind === "audio" ? <audio src={resource.url} controls preload="metadata" aria-label={`${label}: ${path}`} onError={() => setFailed(true)} /> : <video src={resource.url} controls playsInline preload="metadata" aria-label={`${label}: ${path}`} onError={() => setFailed(true)} />}
  </div>;
}

function MediaDiffSide({ side, label }: { side: MediaSide; label: "Old" | "New" }) {
  if (side.kind === "absent") return null;
  if (side.kind === "ready") return <MediaPreview resource={side.resource} path={side.path} label={label} />;
  const reason = side.reason === "too_large" ? "exceeds the preview size limit" : side.reason === "missing" ? "is no longer available" : "cannot be previewed in this browser";
  return <p class="media-preview-fallback"><strong>{label}:</strong> {side.path} {reason}.</p>;
}

export function MediaDiff({ old, next }: { old: MediaSide; next: MediaSide }) {
  return <div class="media-diff"><MediaDiffSide side={old} label="Old" /><MediaDiffSide side={next} label="New" /></div>;
}
