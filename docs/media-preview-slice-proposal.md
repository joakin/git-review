# Native media previews in Files and change cards

Status: approved by the maintainer and implemented. Image and audio/video checkpoints passed local
and private HTTPS browser QA. Additional real-phone playback and raw-tab checks remain unverified
[optional future work](initial-implementation-plan.md#remaining-roadmap).

## Job and user flow

1. Open a supported image, audio, or video file in **Files**. Show the browser's native preview of
   the **current working-tree file** in the main file panel, with the path, format, size, and a
   small **Open raw ↗** link. The link opens the same bytes in a new tab. An unsupported decoder or
   damaged file shows a useful fallback while keeping the raw link.
2. Expand a binary change card. Show previews **inside that card** in a simple vertical sequence:
   labeled **Old** first, then **New**. An addition shows only New, and a deletion only Old. Each
   available side has its own raw link. There is no split-screen comparison or overlay.
3. The preview must represent the layer being reviewed: staged Before = `HEAD`, staged After =
   index; unstaged Before = index, unstaged After = working tree; untracked After = working tree. A
   rename can have different before/after paths. A missing or changed version shows a stale message
   and Refresh, never a silently substituted working-tree file.
4. Images fit the card width without widening the page. Audio and video use native controls, do not
   autoplay, and stop when the card closes. Video uses inline playback on phones. Media loads only
   when its card or file panel is opened; show a loading state and a decoder-error fallback.

The first checkpoint is **images, including SVG**, in Files and all applicable Git layers, including
Old/New sides and raw links. The second checkpoint reuses the same source-aware endpoint for **audio
and video**, adds seeking/range QA, and reviews their phone controls. This ordering keeps each
change reviewable while delivering the requested media types in one planned slice.

## API and data model

- The API has a discriminated `media` result alongside existing `text`, `binary`, and limit states.
  A resource has a required kind (`image`, `audio`, or `video`), MIME type, byte length, and
  versioned raw URL. A diff result has explicit Old and New states (`ready`, `absent`, or
  `unavailable`) so a deletion is distinct from a failed read. Text diffs keep their existing route;
  media bytes do not enter JSON.
- The narrow raw routes are `GET/HEAD /api/projects/:id/raw/file?path=…&version=…` and
  `GET/HEAD /api/projects/:id/raw/diff?layer=…&path=…&revision=…&side=old|new&version=…`. The server
  generates these URLs from validated results. Each raw request revalidates the opened project,
  approved root, project-relative path, file kind, layer/side, and version. There is no generic
  static-directory mapping for host files.
- Read worktree bytes through [shared checked file access](working-file-boundaries.md), from an
  already validated, no-follow file descriptor rather than lazily reopening a path after the
  containment check. For Git versions, resolve the index or tree entry to a blob object ID, verify
  its type and size, then read that object with fixed argument-array subprocess calls through the
  [shared Git read boundaries](git-read-boundaries.md). Buffered and streamed reads share literal
  argument handling, environment overrides and cleanup. Each awaited stream read has a deadline;
  pausing the consumer does not impose a total playback deadline. No shell, checkout, repository
  write, or historical browsing is required. This source mapping is essential: a staged file may
  differ from both `HEAD` and the working tree.
  [Git object reads](https://git-scm.com/docs/git-cat-file),
  [Git index entries](https://git-scm.com/docs/git-ls-files)
- Selected projects may be repository subfolders. Resolve staged Old paths with Git's `HEAD:./path`
  syntax from the selected project's working directory; a bare `HEAD:path` would address the
  repository root and could select a same-named file outside the project. Renames resolve their Old
  path the same way. Index reads retain project-relative literal pathspecs; historical media uses
  exact validated comparison blobs.
- Serve an allowlisted MIME type and `Content-Disposition: inline` with a safe filename,
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and no permissive CORS. A raw link
  uses `target="_blank"` and `rel="noopener"`. Treat extension and file bytes as untrusted; validate
  a recognized signature where practical and let the browser report actual decode failure. SVG
  belongs in the image checkpoint: embed it through `<img>`, where browsers disable scripts and
  interaction. **Opening SVG as a document in a raw tab differs**, so that response also receives a
  restrictive `Content-Security-Policy` with `sandbox` and no scripts or same-origin privileges.
  Test this with an SVG containing a script before shipping the raw link. HTML preview is out of
  scope; PDF can wait.
  [SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image),
  [CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox),
  [MIME sniffing protection](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options)
- Audio/video use a bounded single byte-range response with `206`, `Content-Range`, `Accept-Ranges`,
  `HEAD`, and `416` on invalid ranges. Worktree media streams from an already checked descriptor;
  Git media streams from a validated object ID. Both avoid whole-file buffering. The initial size
  limits are **25 MiB for images and 200 MiB for audio/video**; files above the cap get a limit
  state.
  [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- The server recognizes a bounded set of common formats, for example PNG/JPEG/GIF/WebP/AVIF/**SVG**,
  MP3/M4A/WAV/Ogg, and MP4/WebM/MOV. The browser checks `canPlayType()` for audio/video and falls
  back if it returns empty; `maybe` is only a hint, so playback errors still need a fallback. Image
  load/error determines whether a declared image actually renders. This avoids promising that every
  codec inside an allowed container will play on every device.
  [Media capability hint](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/canPlayType),
  [image formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)

## Edge cases and QA

- Cover staged plus unstaged edits to the same media path, renamed and deleted media, untracked
  files, a file changed after its preview metadata loaded, missing Git blobs, malformed/duplicate
  query values, traversal and symlink escapes, special files, mislabeled content, unusual Unicode
  filenames, and the proposed size limits. The raw URL must never return bytes from a different side
  or from a file outside the selected project.
- Verify `GET`, `HEAD`, normal and invalid Range, direct new-tab navigation, `Content-Type`,
  no-sniff and cache headers, and that the service worker does not cache raw responses. Video/audio
  seeking must work from the running private HTTPS app, not only localhost.
- Capture expanded image and media cards and the Files panel at phone, tablet portrait, tablet
  landscape, and desktop widths. Inspect large portrait images, long filenames, stacked Old/New
  cards, video controls, safe-area and page overflow. Check Android and iOS playback and the new-tab
  action on real devices; codecs vary by browser.

## Decisions for maintainer review

The maintainer confirmed that Files shows the current file, change cards show Old then New
vertically, SVG is an image in this slice, HTML preview is unnecessary, and the 25 MiB image / 200
MiB audio-video limits are acceptable for now. Both checkpoints are implemented. Keep PDF deferred.

## Review evidence

- `bun run typecheck`, `bun test`, and `bun run qa:check` pass. The API fixture verifies image and
  audio Old/New source mapping across staged and unstaged layers, untracked and deleted images, raw
  version checks, range, HEAD, and invalid-range handling.
- `bun run qa:media` opened a script-bearing SVG in Chrome as an image and as a raw document; the
  script did not run. `bun run qa:media-playback` loaded and sought staged audio/video and current
  Files audio/video in a mobile Chrome viewport, and verified a raw video `206` response. Both
  browser checks also passed through the running private HTTPS origin on port 8443.
- Four-size images: [image diff phone](../qa/screenshots/media-images-diff-first/mobile.png),
  [image Files phone](../qa/screenshots/media-images-files-review/mobile.png),
  [final HTTPS audio/video diff phone](../qa/screenshots/media-av-live-ready-review/mobile.png), and
  [final HTTPS video Files phone](../qa/screenshots/media-av-live-control-review/mobile.png). Each
  folder also has tablet portrait, tablet landscape, and desktop captures. On narrow screens the
  floating Feedback action sits below the top bar when media controls are present, keeping the
  player controls clear.
- Local Chrome emulation does not establish iOS Safari or Android Chrome decoder support, native
  control behavior, or new-tab handling. Check those through the private HTTPS app on devices before
  calling that device QA complete.

## Maintenance verification — 2026-10-01

M01 is accepted and committed as `ba62d1d`. The scoped HEAD-path correction has five API regression
tests in [media-api.test.ts](../src/server/media-api.test.ts), all confirmed to fail before the fix
and pass afterward. They approve only a repository subfolder and verify both media descriptions and
raw bytes with/without outside namesakes, including SHA-1/SHA-256, unusual names, image/audio/video,
HEAD/ranges, rejected outside-object versions, and staged rename/deletion. The full suite passes 53
tests with 945 assertions; strict type checking and the CSS token gate also pass.

Inspected [phone](../qa/screenshots/maintenance-m01-scoped-media/mobile.png),
[tablet portrait](../qa/screenshots/maintenance-m01-scoped-media/tablet-portrait.png),
[tablet landscape](../qa/screenshots/maintenance-m01-scoped-media/tablet-landscape.png), and
[desktop](../qa/screenshots/maintenance-m01-scoped-media/desktop.png) captures show the correct
scoped Old/New images without page-wide overflow. This is Chrome emulation and byte-source
verification, not new real-device playback or decoder verification.
