import type { DiffContextGap as Gap } from "../shared/diff-context.ts";
import { consumedContext } from "./diff-context-state.ts";
import type { DiffContextControl } from "./use-diff-context.ts";

export function DiffContextGap({
  gap,
  hunkCount,
  control,
}: {
  gap: Gap;
  hunkCount: number;
  control: DiffContextControl;
}) {
  const { remaining } = consumedContext(control.data, gap);
  if (remaining === 0) return null;
  const pending =
    control.activity.kind === "loading" ||
    (control.activity.kind === "error" && control.activity.gap === null);
  return (
    <div class="diff-context-gap" data-gap={gap.id}>
      <div class="diff-context-gap-content">
        <span class="diff-context-buttons">
          {(["up", "down"] as const)
            .filter((direction) => (direction === "up" ? gap.id < hunkCount : gap.id > 0))
            .map((direction) => (
              <button
                type="button"
                class="diff-context-button"
                aria-label={`Show ${Math.min(20, remaining)} lines ${direction === "up" ? "above" : "below"}`}
                title={`Show more lines ${direction === "up" ? "above the following code" : "below the preceding code"}`}
                aria-disabled={pending}
                onClick={(event) => {
                  const separator = event.currentTarget.closest(".diff-context-gap");
                  if (separator instanceof HTMLElement) control.expand(gap, direction, separator);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  {direction === "up" ? (
                    <>
                      <path d="M4 4h16M12 20V8m-5 5 5-5 5 5" />
                    </>
                  ) : (
                    <>
                      <path d="M4 20h16M12 4v12m-5-5 5 5 5-5" />
                    </>
                  )}
                </svg>
              </button>
            ))}
        </span>
        <span class="diff-context-label" role="status">
          {control.activity.kind === "loading" && control.activity.gap === gap.id
            ? "Loading context…"
            : `${remaining} unchanged ${remaining === 1 ? "line" : "lines"} hidden`}
        </span>
      </div>
    </div>
  );
}
