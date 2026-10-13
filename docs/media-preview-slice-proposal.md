# Native media previews

Files previews the current working-tree file. Working-copy diff cards and historical commit cards
preview their actual comparison sides. The maintainer chose native controls and vertically stacked
**Old**, then **New**, so media uses the same source model as text review.

## Current behavior

Supported images, including SVG, fit their reading surface. Audio and video use native controls,
load metadata without autoplay, and stop when their card closes. Video plays inline on phones. Each
available preview has **Open raw ↗** for the same version in a new tab. Unsupported browser codecs
show a fallback while retaining that raw link. Decode/read errors use
[application notifications](application-notifications.md) and leave an unavailable-preview
placeholder with the raw link.

Additions show only New and deletions only Old. Other sides distinguish available, absent, and
unavailable resources. Staged compares HEAD to index, unstaged compares index to working tree, and
untracked uses an empty Old side; [Git inspection](git-history-slice-proposal.md) uses exact
historical comparison blobs. Renames use each side's own path. Changed or missing versions require
recovery instead of substituting current working-tree bytes.

The [shared media catalog](../packages/shared/src/media-types.ts) owns supported containers, MIME
types, extension aliases, and preview budgets. Server-side
[image signatures](../apps/agent/src/image-types.ts) and
[audio/video signatures](../apps/agent/src/audio-video-types.ts) validate working-file headers.
These classify a supported resource; [the browser preview](../apps/web/src/MediaPreview.tsx) still
determines actual decoding and playback. PDF remains
[optional](initial-implementation-plan.md#remaining-roadmap); HTML preview is outside the current
scope.

## Source and response boundaries

[Media resolution](../apps/agent/src/media.ts) owns comparison/source validation and raw URLs.
[Working media inspection](../apps/agent/src/project-files.ts) supplies validated type, size, and
version metadata; its callers attach source-specific URLs. Git images also require valid headers,
while supported nonempty Git audio/video blobs retain their existing inspection policy without
header sniffing. Browser decoding can still fail and offer the raw fallback.
[Checked working-file access](working-file-boundaries.md) pins validated working-tree descriptors;
[Git object reads](git-read-boundaries.md) supply exact blobs. A selected project may be a
repository subfolder: Old HEAD reads must preserve that scope rather than selecting a namesake at
the repository root. Every raw request revalidates project access and resource version.

Audio/video streams and bounded single-range/HEAD responses belong to
[media streaming](../apps/agent/src/media-stream.ts). They release descriptors or Git streams on
completion, cancellation, or failure and check mutable versions during playback. Awaited reads have
deadlines; consumer backpressure does not impose a total playback deadline.

Raw responses use allowlisted MIME types, no sniffing, no-store caching, and restricted origins. SVG
embeds through an image element; opening it as a raw document also receives a sandboxed Content
Security Policy without script or same-origin privileges. This distinction protects raw-tab
navigation as well as embedded previews. The service worker does not cache media or API responses.

The [agent HTTP boundary](agent-http-protocol.md#origin-preflight-and-response-ownership) preserves
these responses while adding allowed-origin CORS and exposing range headers. Direct cross-origin
native elements use anonymous CORS mode; existing no-CORS restrictions stay in place. The current
app still uses same-origin media until the transport step in the
[split host plan](split-host-architecture-proposal.md) lands.

## Evidence and device limits

The [QA catalog](qa-workflow.md) identifies image, playback/range, and Git-media checks.
[Old/New images](../qa/screenshots/media-images-diff-first/mobile.png),
[Files images](../qa/screenshots/media-images-files-review/mobile.png), and
[HTTPS audio/video](../qa/screenshots/media-av-live-ready-review/mobile.png) are inspected
historical milestones with the other three viewport sizes and manifests in their folders. Browser
checks include a scripted SVG and audio/video seeking/ranges. Real Android/iOS playback, codec
support, and raw-tab behavior remain unverified by those emulated checks.
