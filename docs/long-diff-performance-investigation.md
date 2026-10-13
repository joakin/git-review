# Long diff performance investigation

Status: investigation completed on 2026-10-07. The maintainer authorized render isolation and CSS
containment on 2026-10-08, with independent review and a separate commit for each step. Render
isolation and containment are implemented and independently reviewed. Physical iPad/Safari testing
remains a maintainer follow-up.

## Findings

Expanded diffs have two substantial costs: browser work over a large tree, and component rendering
that repeats when the code has not changed. The first useful step is to isolate unchanged code from
comment-editor and line-action updates. CSS rendering containment is also promising, provided its
geometry and browser behavior are verified. A whole-file boundary cannot help much while one very
long file remains visible; that case needs smaller blocks.

The investigation baseline [renderer](../apps/web/src/DiffBody.tsx) creates every expanded hunk,
row, line action, selection source, and syntax span. [Changes](../apps/web/src/ChangesView.tsx)
builds fresh per-card draft arrays and callbacks on each render.
[Feedback](../apps/web/src/review-feedback.ts) stores the editor session in an App-owned hook, so
typing renders App and its diff descendants again. Token decoration and comment anchors are rebuilt
along that path. Memoization needs stable semantic inputs and current handlers; wrapping components
with a shallow comparator alone would not address the newly created props.

Scrolling can also repeat code rendering: the [sticky heading](../apps/web/src/DiffCardFrame.tsx)
updates its pinned state as a boundary is crossed, rendering the body below it. Opening or moving a
line action updates state inside DiffBody and renders its hunks again. The line-action overlay
should have a boundary that lets it update without rebuilding unchanged code.

[Syntax highlighting](syntax-highlighting-slice.md) runs on the server and already reuses Shiki and
loaded grammars. [Batching](diff-batching-and-bulk-controls-proposal.md) already bounds network and
server work, but requests every expanded card, including those below the viewport. Returning to a
cached Changes page still mounts its complete expanded tree. The measurements below made no new diff
requests on return, so further request caching would not remove that measured cost.

## Local experiments

The experiments used the real working-copy API with isolated Git fixtures and temporary browser-only
bundles. No application source was edited. Chrome 154.0.8037.98 ran headlessly at 390 × 844 with
touch emulation, wrapped code, and 4× CPU throttling. The Bun server and network were not throttled.
Each variant ran in three fresh browser contexts on the same server. Tables show medians; the first
grammar load can affect the first expansion sample.

Both fixtures rendered 2,000 diff rows: 1,000 removed and 1,000 added TypeScript declarations with
several syntax roles per line. The many-file fixture had twenty files with fifty changed source
lines each; the single-file fixture had one file with one thousand changed source lines. They are
deliberately token-heavy examples, rather than a representative sample of the maintainer's actual
changes. The many-file page had 71,660 HTML elements, including 54,000 syntax spans. The single-file
page had 62,397 elements and 50,000 syntax spans.

Expansion and Back were timed through ready cards and two animation frames. Comment operations were
timed from a dispatched click/input through two animation frames. Typing is the median of thirty
individual character updates. These are synthetic interaction timings, not a measured INP score or
physical-phone latency.

The variants were:

- **File CSS:** `content-visibility: auto` and a remembered intrinsic block size on each file's
  `.diff-scroll`, leaving the sticky heading and fixed line action outside containment. The initial
  size estimate used row count and the unwrapped row height.
- **Render isolation:** experimental semantic memoization of DiffBody, keeping unchanged bodies out
  of parent updates. It retained internal line-action updates and did not reduce the mounted DOM.
  Its comparator ignored changing callback identities to estimate avoidable work. Production code
  must establish stable, current callbacks rather than copy this comparator. Importing Preact compat
  also changes the experimental runtime; these figures establish direction, not a promised gain.
- **Block CSS:** groups of eighty rows inside a hunk, each using automatic content visibility and a
  phone-specific estimated height. Eighty is an experimental value, not a chosen contract.

### Twenty expanded files

| Operation                     | Current  | File CSS | Render isolation | Both     |
| ----------------------------- | -------- | -------- | ---------------- | -------- |
| Expand all                    | 2,211 ms | 1,495 ms | 2,267 ms         | 1,552 ms |
| Open comment editor           | 706 ms   | 262 ms   | 581 ms           | 162 ms   |
| One typed character           | 142 ms   | 139 ms   | 33 ms            | 33 ms    |
| Save comment                  | 658 ms   | 212 ms   | 562 ms           | 123 ms   |
| Back from Files, cached diffs | 1,595 ms | 751 ms   | 1,497 ms         | 719 ms   |

Every character update rendered all 2,000 SelectableCode components in the current and CSS-only
variants: 20,000 row-component renders for ten characters. Render isolation reduced those typing
renders to zero. Saving a draft in that prototype still rendered the affected file. DOM element
counts stayed the same in every file-level variant.

Opening and closing the modal caused substantial browser style work. On the current many-file page,
opening the editor spent about 435 ms recalculating style, versus about 89 ms with file CSS. Render
isolation alone left most of that style cost. This explains why improving the component boundary and
reducing off-screen browser work are complementary.

The CSS-only page's initial document height was 47,143 px versus 79,070 px after full layout in the
current app. Wrapped lines made the simple estimate too short. The browser can remember rendered
sizes after visiting content, but initial and remounted skipped regions still need a useful estimate
or an application-held measured size. This prototype is unsuitable for shipping with current
reading-position expectations.

### One large expanded file

| Operation                    | Current  | File CSS | Block CSS | Blocks + render isolation |
| ---------------------------- | -------- | -------- | --------- | ------------------------- |
| Expand all                   | 2,022 ms | 2,010 ms | 1,187 ms  | 1,269 ms                  |
| Open comment editor          | 562 ms   | 528 ms   | 172 ms    | 244 ms                    |
| One typed character          | 128 ms   | 117 ms   | 117 ms    | 33 ms                     |
| Save comment                 | 559 ms   | 535 ms   | 144 ms    | 216 ms                    |
| Back from Files, cached diff | 1,259 ms | 1,269 ms | 549 ms    | 512 ms                    |

The whole-file CSS boundary remained visible, so its benefit was small. Smaller blocks reduced
browser work even inside that visible file. They retained every row and added twenty-five wrapper
elements. The more accurate fixture-specific estimate gave an initial height of 76,780 px, compared
with the current page's 76,000 px. This does not establish a general estimator for wrapping, fonts,
or viewport changes.

Synthetic scrolling used ninety animation-frame steps, moving 140 px per frame for forty-five frames
and returning for forty-five. It covered the top part of the page, not the entire review. The
single-file baseline crossed sticky-heading boundaries and rendered 4,000 row components during that
scroll, with a median maximum frame gap of 133 ms. Render isolation alone eliminated those row
renders and reduced the maximum gap to 26 ms. Block CSS alone retained approximately 134 ms gaps;
the combined prototype measured 42 ms as blocks entered view. The many-file baseline was already
relatively smooth in this narrow synthetic traversal. Deferred work can become visible as scrolling
enters new blocks; faster initial rendering does not guarantee smoother scrolling.

Temporary harness and raw results are retained locally under ignored
`qa/.artifacts/diff-performance-2026-10-07/`. The baseline/file experiments contain twenty-four
runs; the block experiments contain six. The harness starts and stops only its own fixture server
and isolated browser contexts.

## What the CSS does and its constraints

`content-visibility: auto` lets the browser skip rendering work, including descendant layout, for
content it considers irrelevant to the current view. The element remains in the document; the
property does not defer component execution, response parsing, DOM construction, or server syntax
highlighting. With `contain-intrinsic-block-size: auto <estimate>`, a skipped element reserves an
estimated height until the browser has a remembered rendered size. It does not preserve exact
unvisited wrapped geometry for free. See
[MDN content visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility),
[MDN intrinsic size](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain-intrinsic-size),
and [Chrome's rendering explanation](https://web.dev/articles/content-visibility).

Automatic visibility preserves availability to browser find and accessibility features, subject to
browser behavior. It introduces layout and paint containment, including containing-block and
clipping effects. Putting it on an entire card or body can interfere with sticky headings and the
fixed comment action. Keep overlays and sticky navigation outside the contained code region, and
verify horizontal scrolling, focus outlines, text selection and targeted scrolling. Geometry reads
inside skipped descendants can force the rendering work that was intended to be avoided. See the
[CSS containment draft](https://drafts.csswg.org/css-contain-2/).

For exact geometry without deferred descendant layout, ordinary layout/paint containment is an
alternative worth profiling, but it cannot provide the same off-screen layout saving. A viewport
mounting strategy would reduce DOM and component work as well, at the cost of explicit height,
selection, focus, find-in-page and scroll-restoration policies.

Safari has supported the property since
[Safari 18](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/). There are nevertheless
relevant open Safari 26 reports from GitLab:
[repeated scroll stutter on diff files](https://bugs.webkit.org/show_bug.cgi?id=318216), and
[blank/collapsed diff blocks on scroll reveal](https://bugs.webkit.org/show_bug.cgi?id=321501). The
first report says GitLab planned to disable content visibility for Safari diff files. These are
reports about another implementation, not reproduced failures in git-review; their proposed engine
explanations are explicitly unverified. Both reports were still marked NEW when inspected on
2026-10-07. A supports check alone would not detect those failures.

## Render isolation implementation

Changes now groups card drafts once per draft-store version. Diff hunks and file row collections
have memoized boundaries, with separate memoized rows receiving primitive marker counts. Immutable
source anchors and token decoration remain tied to their actual resource. Stable command delegates
invoke the current owner while allowing presentation props to retain identity. Transient editor,
sticky-heading and line-action changes no longer rebuild unchanged code. Saving feedback updates its
affected row; target-line and reattachment-side changes still reach the appropriate source.

Six repeated large-diff runs against the implementation recorded zero code-row renders during
scrolling, line-action reveal, editor opening and typing, and one affected row on Save. Median
character latency was about 33 ms in both fixtures, compared with 142/128 ms in the baseline. The
single-file scroll maximum gap fell from about 133 ms to 25 ms. Browser style and initial mounting
costs remain for the containment step.

An independent read-only review found no actionable correctness or maintainability issues, checking
current callbacks, resource identity, side changes, primitive counts, line taps and file targets.
Typecheck, build and all 256 tests passed. Focused browser QA covered comment persistence,
Old-context reattachment and checked export. [Rendering QA](../qa/check-code-rendering.ts) guards
unchanged-code exclusion and affected-marker updates in large Changes and Files views. Selected-code
feedback, Old/New reattachment and navigation QA also passed. Physical-device and Safari behavior
remain unverified.

## Agreed implementation approach

The first implementation keeps the current DOM and loading policy while isolating code rendering.

- **User flow:** Expand all, individual toggles, commenting, reattachment, wrapping, sticky
  headings, and Back/Forward keep their existing behavior. Typing or repositioning a line action
  should not rebuild unrelated syntax content. A saved comment should update its affected markers.
- **Data/API shape:** keep HTTP, cache identities, persisted formats and server highlighting intact.
  Establish stable renderer inputs for the accepted immutable diff, interaction mode and relevant
  draft counts, with current callbacks. Isolate transient editor and overlay state from code
  rendering; derive decoration once for its accepted source where useful.
- **Edge cases:** a new diff version, language, wrap state, project or reattachment side must update
  the appropriate code and anchors. Handler stabilization must preserve current feedback ownership.
  Selection registration must remain tied to the displayed source. Old/New comments and same-path
  layers must stay distinct. Sticky corners, modal focus, route focus and saved reading positions
  must retain their contracts.
- **Validation:** repeat the two large fixtures and verify reduced component work; exercise
  feedback, selected-code actions, reattachment, stale/update recovery and navigation. Inspect
  phone, tablet portrait, tablet landscape and desktop states, then check the maintainer's real
  phone.

The second slice applies automatic content visibility to each text code pane and bounded groups of
source lines within wrapped panes. It retains every row and syntax token. Initial skipped heights
estimate one ordinary code-line height per row, plus hunk headings at the pane level. Visited block
and pane heights are remembered by the immutable displayed resource and layout: pane/viewport width,
wrapping, typography and completed font loads. The cache retains a bounded number of layouts per
resource without retaining DOM nodes. Resize observations accept only rendered children and apply
non-inherited intrinsic block sizes directly. Layout changes discard pending measurements before
observing the new layout.

Per-row containment was tested but added substantial scrolling overhead. Small groups reduced that
cost while still bounding browser work inside a long file. Unwrapped inner blocks keep normal layout
to preserve the full horizontal extent of off-screen long lines; the outer pane still uses automatic
content visibility. Sticky card headings and fixed line actions stay outside containment. Explicit
file-line targets render their block before route scrolling. Browsers lacking the required CSS and
visibility/resize APIs use ordinary rendering. This is browser rendering deferral, not DOM
virtualization; initial mounting and retained DOM still have costs.

Final samples used the same Chrome phone profile and 4× CPU throttling as the investigation, with
three fresh contexts per fixture and no concurrent browser checks. Medians compare the original
baseline with both delivered steps:

| Operation           | Twenty files: baseline | Twenty files: delivered | One file: baseline | One file: delivered |
| ------------------- | ---------------------- | ----------------------- | ------------------ | ------------------- |
| Expand all          | 2,211 ms               | 1,644 ms                | 2,022 ms           | 1,317 ms            |
| Open comment editor | 706 ms                 | 143 ms                  | 562 ms             | 63 ms               |
| One typed character | 142 ms                 | 33 ms                   | 128 ms             | 33 ms               |
| Save comment        | 658 ms                 | 107 ms                  | 559 ms             | 50 ms               |
| Cached Back         | 1,595 ms               | 771 ms                  | 1,259 ms           | 564 ms              |

The single-file synthetic scroll's median maximum frame gap was about 36 ms, versus 133 ms in the
baseline. None of the six final scroll samples exceeded 50 ms. These controlled measurements are not
physical-phone timings or an INP score. The final result file is retained locally beside the
original ignored investigation evidence as `results-step-two-final.json`.

Independent review identified visibility-filter and responsive-cache issues; both were corrected and
rereviewed without further findings. The isolated delivery tree passed typecheck, build, formatting,
CSS-token checks and all 256 tests. [Containment QA](../qa/check-code-containment.ts) checks
complete DOM, skipped off-screen content, deep cached Back, rotation, font size, wrapping,
horizontal extent, card jumps, direct file-line navigation, far-line focus and unsupported fallback.
Rendering QA still records zero unchanged code renders for transient actions and exactly one
affected line on Save. Blank-line checks passed in Changes, historical Git and Files at all four
layouts, multiple font sizes and both wrap modes. Selected-code feedback, Old/New reattachment and
navigation checks passed.

The [Changes](../qa/screenshots/long-code-containment-changes/mobile.png) and
[Files with a line action](../qa/screenshots/long-code-containment-files/mobile.png) milestone sets
were captured and inspected at phone, tablet portrait, tablet landscape and desktop sizes. No blank
visible blocks, clipped actions or page-wide horizontal overflow were observed. Safari 26.0.1 is
installed locally, but WebDriver could not create a session because remote automation is disabled;
its settings were left unchanged. No Safari or physical iPad/phone pass is claimed. The maintainer
accepted enabling containment now and checking their iPad afterward.

Concurrent feature work was kept out of both commits. Final typecheck, tests and browser checks used
an isolated copy of the reviewed render-isolation commit plus only the containment changes; the
shared working app's client assets were rebuilt afterward. Future changes to a text snapshot must
also change the containment resource identity, including any separately implemented context
expansion.

Other opportunities are secondary: prioritize near-viewport expanded-card requests for initial
network work; avoid repeated token decoration and duplicate per-card language-option work; inspect
cache eviction when more expanded resources exceed the budgets in
[diff-cache.ts](../apps/web/src/diff-cache.ts). Increasing cache budgets alone would not improve the
cache-hit scenarios measured here.

## Evidence limits

The original investigation did not validate physical iOS/Android gestures, installed-PWA behavior,
Safari rendering, deep scroll restoration under estimated heights, browser find,
keyboard/screen-reader navigation, unwrapped horizontal sizing, other viewport sizes, or sustained
memory use. Temporary prototypes are performance probes, not completed correctness-tested
implementations. The original performance probes did not change production code. Implementation
evidence is recorded separately above.
