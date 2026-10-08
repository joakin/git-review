import type { LanguageOption, ReviewChangeEntry } from "../shared/api.ts";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ChangeStats } from "./ChangeStats.tsx";
import type { CommitFileChange } from "../shared/git.ts";
import { DelayedLoading } from "./DelayedLoading.tsx";
import { DiffBody, type DiffInteraction } from "./DiffBody.tsx";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { Chevron, Icon } from "./Icons.tsx";
import type { DiffState } from "./diff-loading.ts";
import type { DiffContextControl } from "./use-diff-context.ts";
import { useNotification } from "./Notifications.tsx";

type DiffCardMode =
  | (Extract<DiffInteraction, { kind: "review" }> & {
      entry: ReviewChangeEntry;
      onOpenFile: () => void;
    })
  | { kind: "inspect"; file: CommitFileChange };

/** Native intersection tracking changes corners only after the heading reaches its sticky offset. */
function usePinnedHeading(enabled: boolean) {
  const marker = useRef<HTMLSpanElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  useLayoutEffect(() => {
    if (!enabled) {
      setPinned(false);
      return;
    }
    const sentinel = marker.current;
    const header = heading.current;
    const section = header?.closest(".diff-section")?.querySelector(".diff-section-heading");
    const topbar = document.querySelector(".topbar");
    if (
      sentinel === null ||
      header === null ||
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
    resize.observe(header);
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
  context = null,
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
  context?: DiffContextControl | null;
}) {
  const sticky = usePinnedHeading(expanded && mode.kind === "review");
  const path = mode.kind === "review" ? mode.entry.path : mode.file.path;
  useNotification(
    `diff-load:${requestKey}`,
    expanded && current.kind === "error"
      ? {
          message: `${path}: ${current.message}`,
          severity: "error",
          action: { label: "Retry", run: retry },
        }
      : null,
  );
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
  const canPickLanguage = current.kind !== "ready" || current.value.kind === "text";
  const syntax =
    current.kind === "ready" && current.value.kind === "text" ? current.value.syntax : null;
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
      <div
        class={`diff-card-heading${sticky.pinned ? " diff-card-heading-pinned" : ""}`}
        ref={sticky.heading}
        data-expanded={expanded ? "true" : "false"}
      >
        <button class="diff-card-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
          <span class="diff-card-chevron" aria-hidden="true">
            <Chevron direction={expanded ? "down" : "right"} />
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
              {mode.kind === "review" && (
                <span class="diff-card-stats">
                  <span aria-hidden="true">·</span>
                  <ChangeStats stats={mode.entry.stats} />
                </span>
              )}
            </small>
          </span>
          {mode.kind === "inspect" && <span class="diff-card-layer">{label}</span>}
        </button>
        {mode.kind === "review" && (
          <div class="diff-card-actions">
            {expanded && canPickLanguage && (
              <LanguagePicker
                variant="compact"
                languages={languages}
                override={override}
                onChange={onLanguage}
                syntax={syntax}
              />
            )}
            <button
              class="diff-card-open"
              type="button"
              disabled={kind === "deleted" || submodule}
              aria-label={`Open ${path} in Files`}
              title={
                kind === "deleted"
                  ? "Deleted file has no current working file to open"
                  : submodule
                    ? "Submodules are directories rather than files"
                    : "Open current working file in Files"
              }
              onClick={mode.onOpenFile}
            >
              <Icon name="file" /> Open
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div class="diff-card-body">
          {mode.kind === "inspect" && canPickLanguage && (
            <LanguagePicker
              languages={languages}
              override={override}
              onChange={onLanguage}
              syntax={syntax}
            />
          )}
          {current.kind === "loading" && (
            <DelayedLoading key={requestKey} className="diff-message" message="Loading diff…" />
          )}
          {current.kind === "error" && <p class="diff-message">Diff unavailable.</p>}
          {current.kind === "ready" && (
            <DiffBody result={current.value} wrap={wrap} interaction={mode} context={context} />
          )}
        </div>
      )}
    </article>
  );
}
