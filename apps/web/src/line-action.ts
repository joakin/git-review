import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

type PositionedAction = {
  row: HTMLElement;
  clientX: number;
  left: number;
  top: number;
  width: number;
};

export function lineActionPosition(
  row: HTMLElement,
  clientX: number,
): { left: number; top: number; width: number } | null {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const width = Math.min(280, viewportWidth - 16);
  if (width < 160) return null;
  const rect = row.getBoundingClientRect();
  const topbarBottom =
    document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? viewportTop;
  const cardHeadingBottom =
    row.closest(".diff-card")?.querySelector(".diff-card-toggle")?.getBoundingClientRect().bottom ??
    topbarBottom;
  const topLimit = Math.max(viewportTop + 8, topbarBottom + 8, cardHeadingBottom + 8);
  if (
    !row.isConnected ||
    rect.bottom <= topLimit ||
    rect.top >= viewportTop + viewportHeight - 8 ||
    topLimit + 48 > viewportTop + viewportHeight - 8
  )
    return null;
  const left = Math.max(
    viewportLeft + 8,
    Math.min(clientX - width / 2, viewportLeft + viewportWidth - width - 8),
  );
  const above = rect.top - 56;
  const below = rect.bottom + 8;
  let top =
    above >= topLimit ? above : below + 48 <= viewportTop + viewportHeight - 8 ? below : topLimit;
  const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
  if (
    feedback !== undefined &&
    left < feedback.right &&
    left + width > feedback.left &&
    top < feedback.bottom &&
    top + 48 > feedback.top
  ) {
    if (feedback.top - 56 >= topLimit) top = feedback.top - 56;
    else if (feedback.bottom + 56 <= viewportTop + viewportHeight - 8) top = feedback.bottom + 8;
  }
  return { left, top, width };
}

/** Shared placement and dismissal preserve code selection and viewport ownership. */
export function useLineAction<T extends PositionedAction>(resource: unknown, wrap: boolean) {
  const [action, setAction] = useState<T | null>(null);
  useEffect(() => {
    setAction(null);
  }, [resource, wrap]);
  useLayoutEffect(() => {
    if (action === null) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".diff-line-action"))
        setAction(null);
    };
    const dismissSelection = () => {
      if (document.getSelection()?.isCollapsed === false) setAction(null);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAction(null);
    };
    const trackRow = () => {
      const position = lineActionPosition(action.row, action.clientX);
      if (position === null) {
        setAction(null);
        return;
      }
      setAction((current) =>
        current === null ||
        (current.left === position.left &&
          current.top === position.top &&
          current.width === position.width)
          ? current
          : { ...current, ...position },
      );
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("selectionchange", dismissSelection);
    document.addEventListener("scroll", trackRow, true);
    window.addEventListener("keydown", dismissEscape);
    window.addEventListener("resize", trackRow);
    window.visualViewport?.addEventListener("scroll", trackRow);
    window.visualViewport?.addEventListener("resize", trackRow);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("selectionchange", dismissSelection);
      document.removeEventListener("scroll", trackRow, true);
      window.removeEventListener("keydown", dismissEscape);
      window.removeEventListener("resize", trackRow);
      window.visualViewport?.removeEventListener("scroll", trackRow);
      window.visualViewport?.removeEventListener("resize", trackRow);
    };
  }, [action]);
  return [action, setAction] as const;
}

/** A short stationary primary tap reveals an action; dragging and long presses keep native selection. */
export function useLineTap(onReveal: (index: number, row: HTMLElement, x: number) => void) {
  const press = useRef<{
    pointerId: number;
    index: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);
  const completedTap = useRef<{ index: number; x: number } | null>(null);
  return (index: number) => ({
    onPointerDown(event: JSX.TargetedPointerEvent<HTMLElement>) {
      completedTap.current = null;
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        document.getSelection()?.isCollapsed === false ||
        (event.target instanceof Element && event.target.closest("button, a"))
      ) {
        press.current = null;
        return;
      }
      press.current = {
        pointerId: event.pointerId,
        index,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now(),
      };
    },
    onPointerMove(event: JSX.TargetedPointerEvent<HTMLElement>) {
      const start = press.current;
      if (
        start !== null &&
        start.pointerId === event.pointerId &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
      )
        press.current = null;
    },
    onPointerCancel() {
      press.current = null;
    },
    onPointerUp(event: JSX.TargetedPointerEvent<HTMLElement>) {
      const start = press.current;
      press.current = null;
      if (
        start === null ||
        start.pointerId !== event.pointerId ||
        start.index !== index ||
        performance.now() - start.startedAt > 500 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
        document.getSelection()?.isCollapsed === false
      )
        return;
      completedTap.current = { index, x: event.clientX };
    },
    onClick(event: JSX.TargetedMouseEvent<HTMLElement>) {
      const tap = completedTap.current;
      completedTap.current = null;
      if (tap !== null && tap.index === index && document.getSelection()?.isCollapsed !== false)
        onReveal(index, event.currentTarget, tap.x);
    },
  });
}
