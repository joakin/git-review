import type { LanguageOption, ReviewChangeEntry } from "../shared/api.ts";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ChangeStats } from "./ChangeStats.tsx";
import type { CommitFileChange } from "../shared/git.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { DiffBody, type DiffInteraction } from "./DiffBody.tsx";
import { LanguagePicker } from "./LanguagePicker.tsx";
import type { DiffState } from "./diff-loading.ts";

type DiffCardMode =
  | (Extract<DiffInteraction, { kind: "review" }> & { entry: ReviewChangeEntry })
  | { kind: "inspect"; file: CommitFileChange };

/** Native intersection tracking changes corners only after the heading reaches its sticky offset. */
function usePinnedHeading(enabled: boolean) {
  const marker = useRef<HTMLSpanElement>(null);
  const heading = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState(false);
  useLayoutEffect(() => {
    if (!enabled) {
      setPinned(false);
      return;
    }
    const sentinel = marker.current;
    const button = heading.current;
    const section = button?.closest(".diff-section")?.querySelector(".diff-section-heading");
    const topbar = document.querySelector(".topbar");
    if (
      sentinel === null ||
      button === null ||
      section === undefined ||
      section === null ||
      topbar === null
    )
      return;
    let intersection: IntersectionObserver | null = null;
    const observe = () => {
      const top = topbar.getBoundingClientRect().bottom + section.getBoundingClientRect().height;
      intersection?.disconnect();
      setPinned(
        sentinel.getBoundingClientRect().height > 0 && sentinel.getBoundingClientRect().top < top,
      );
      intersection = new IntersectionObserver(
        ([entry]) => {
          if (entry === undefined) return;
          setPinned(
            entry.boundingClientRect.height > 0 &&
              entry.boundingClientRect.top < (entry.rootBounds?.top ?? top),
          );
        },
        { rootMargin: `-${top}px 0px 0px 0px`, threshold: [0, 1] },
      );
      intersection.observe(sentinel);
    };
    observe();
    const resize = new ResizeObserver(observe);
    resize.observe(section);
    resize.observe(button);
    window.addEventListener("resize", observe);
    return () => {
      intersection?.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", observe);
    };
  }, [enabled]);
  return { marker, heading, pinned: enabled && pinned };
}

export function DiffCardFrame({
  mode,
  id,
  expanded,
  onToggle,
  languages,
  override,
  onLanguage,
  current,
  requestKey,
  retry,
  wrap,
}: {
  mode: DiffCardMode;
  id: string;
  expanded: boolean;
  onToggle: () => void;
  languages: readonly LanguageOption[];
  override: string | null;
  onLanguage: (value: string | null) => void;
  current: DiffState;
  requestKey: string;
  retry: () => void;
  wrap: boolean;
}) {
  const sticky = usePinnedHeading(expanded && mode.kind === "review");
  const path = mode.kind === "review" ? mode.entry.path : mode.file.path;
  const label = mode.kind === "review" ? mode.entry.layer : "commit";
  const kind = mode.kind === "review" ? mode.entry.kind : mode.file.kind;
  const oldPath =
    mode.kind === "review"
      ? mode.entry.oldPath
      : mode.file.old.kind === "present" && mode.file.old.path !== path
        ? mode.file.old.path
        : null;
  const submodule =
    mode.kind === "review"
      ? mode.entry.isSubmodule
      : [mode.file.old, mode.file.new].some(
          (side) => side.kind === "present" && side.mode === "160000",
        );
  const modeChange =
    mode.kind === "inspect" &&
    mode.file.old.kind === "present" &&
    mode.file.new.kind === "present" &&
    mode.file.old.mode !== mode.file.new.mode
      ? ` · mode ${mode.file.old.mode} → ${mode.file.new.mode}`
      : "";
  return (
    <article
      class={`diff-card diff-card-${label}`}
      id={id}
      data-layer={label}
      data-path={path}
      data-diff-state={expanded ? current.kind : "collapsed"}
    >
      {expanded && mode.kind === "review" && (
        <span class="diff-card-sticky-marker" ref={sticky.marker} aria-hidden="true" />
      )}
      <button
        class={`diff-card-toggle${sticky.pinned ? " diff-card-toggle-pinned" : ""}`}
        ref={sticky.heading}
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span class="diff-card-chevron" aria-hidden="true">
          {expanded ? "⌄" : "›"}
        </span>
        <span class="diff-card-title">
          <strong>{path}</strong>
          <small class={mode.kind === "review" ? "change-metadata" : ""}>
            <span class="change-description">
              <span class="change-kind">{kind.replace("_", " ")}</span>
              {oldPath === null ? "" : ` from ${oldPath}`}
              {submodule ? " · submodule" : ""}
              {modeChange}
            </span>
            {mode.kind === "review" && <ChangeStats stats={mode.entry.stats} />}
          </small>
        </span>
        {mode.kind === "inspect" && <span class="diff-card-layer">{label}</span>}
      </button>
      {expanded && (
        <div class="diff-card-body">
          {(current.kind !== "ready" || current.value.kind === "text") && (
            <LanguagePicker
              languages={languages}
              override={override}
              onChange={onLanguage}
              syntax={
                current.kind === "ready" && current.value.kind === "text"
                  ? current.value.syntax
                  : null
              }
            />
          )}
          {current.kind === "loading" && (
            <DelayedLoading key={requestKey} className="diff-message" message="Loading diff…" />
          )}
          {current.kind === "error" && (
            <div class="diff-message" role="alert">
              {current.message}{" "}
              <button type="button" onClick={retry}>
                Retry
              </button>
            </div>
          )}
          {current.kind === "ready" && (
            <DiffBody result={current.value} wrap={wrap} interaction={mode} />
          )}
        </div>
      )}
    </article>
  );
}
