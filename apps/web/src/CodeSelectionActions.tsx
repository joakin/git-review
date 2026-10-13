import { useEffect, useRef, useState } from "preact/hooks";
import {
  onCodeSourceChange,
  selectedCode,
  selectionIsCurrent,
  sameSelection,
  type SelectedCode,
} from "./code-selection.tsx";
import type { CommentTarget } from "./comments.ts";

type SelectionAction = {
  selected: SelectedCode;
  left: number;
  top: number;
  width: number;
  placement: "above" | "below" | "docked";
};
type Box = { left: number; top: number; right: number; bottom: number };

const actionWidth = 280;
const actionHeight = 46;
const edgeGap = 8;

function intersect(first: Box, second: Box): Box | null {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function visibleViewport(): Box {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    left,
    top,
    right: left + (viewport?.width ?? window.innerWidth),
    bottom: top + (viewport?.height ?? window.innerHeight),
  };
}

function readSelection(projectPath: string): SelectedCode | null {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  return selectedCode(selection.getRangeAt(0), projectPath);
}

function positionSelection(selected: SelectedCode): SelectionAction | null {
  const { code: startCode, range } = selected;
  const viewport = visibleViewport();
  const scrollPane = startCode.closest(".diff-scroll, .file-code-scroll");
  const clip =
    scrollPane instanceof HTMLElement
      ? intersect(viewport, scrollPane.getBoundingClientRect())
      : viewport;
  if (clip === null) return null;
  const visibleRects = Array.from(range.getClientRects())
    .map((rect) => intersect(clip, rect))
    .filter((rect): rect is Box => rect !== null);
  if (visibleRects.length === 0) return null;

  const firstTop = Math.min(...visibleRects.map((rect) => rect.top));
  const firstLine = visibleRects.filter((rect) => Math.abs(rect.top - firstTop) < 3);
  const left = Math.min(...firstLine.map((rect) => rect.left));
  const right = Math.max(...firstLine.map((rect) => rect.right));
  const top = Math.min(...firstLine.map((rect) => rect.top));
  const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
  const width = Math.min(actionWidth, viewport.right - viewport.left - edgeGap * 2);
  if (width < 110) return null;
  const actionLeft = Math.max(
    viewport.left + edgeGap,
    Math.min((left + right - width) / 2, viewport.right - width - edgeGap),
  );
  const above = top - actionHeight - edgeGap;
  const below = bottom + edgeGap;
  const clearAt = (y: number): boolean => {
    const box = { left: actionLeft, right: actionLeft + width, top: y, bottom: y + actionHeight };
    return Array.from(
      document.querySelectorAll(".feedback-launch, .history-navigation, .reattach-banner"),
    ).every(
      (element) =>
        element.getClientRects().length === 0 ||
        intersect(box, element.getBoundingClientRect()) === null,
    );
  };
  const topbar = document.querySelector(".topbar");
  const visibleTop = Math.max(
    viewport.top + edgeGap,
    (topbar?.getBoundingClientRect().bottom ?? viewport.top) + edgeGap,
  );
  const fitsAbove = above >= visibleTop && clearAt(above);
  const fitsBelow = below + actionHeight <= viewport.bottom - edgeGap && clearAt(below);
  if (window.matchMedia("(pointer: coarse)").matches) {
    if (fitsBelow) return { selected, left: actionLeft, top: below, width, placement: "below" };
    const dockedTop = visibleTop;
    if (dockedTop + actionHeight + edgeGap < top && clearAt(dockedTop))
      return { selected, left: actionLeft, top: dockedTop, width, placement: "docked" };
    return null;
  }
  if (fitsAbove) return { selected, left: actionLeft, top: above, width, placement: "above" };
  if (fitsBelow) return { selected, left: actionLeft, top: below, width, placement: "below" };
  return null;
}

function sameAction(first: SelectionAction | null, second: SelectionAction | null): boolean {
  if (first === null || second === null) return first === second;
  return (
    sameSelection(first.selected, second.selected) &&
    first.left === second.left &&
    first.top === second.top &&
    first.width === second.width &&
    first.placement === second.placement
  );
}

export function CodeSelectionActions({
  projectPath,
  onSearch,
  onComment,
  wrap,
}: {
  projectPath: string;
  onSearch: (text: string) => void;
  onComment: (target: CommentTarget) => void;
  wrap: boolean;
}) {
  const [action, setAction] = useState<SelectionAction | null>(null);
  const actionRef = useRef<SelectionAction | null>(null);
  const handlersRef = useRef({ onSearch, onComment });
  const holdRef = useRef(false);
  const updateRef = useRef<() => void>(() => {});
  handlersRef.current = { onSearch, onComment };

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const native = readSelection(projectPath);
        const held =
          holdRef.current && (document.getSelection()?.isCollapsed ?? true)
            ? (actionRef.current?.selected ?? null)
            : null;
        const selected = native ?? held;
        const next =
          selected !== null && selectionIsCurrent(selected, projectPath)
            ? positionSelection(selected)
            : null;
        actionRef.current = next;
        setAction((current) => (sameAction(current, next) ? current : next));
      });
    };
    updateRef.current = update;
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".code-selection-action") !== null
      )
        return;
      holdRef.current = false;
      actionRef.current = null;
      setAction(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      holdRef.current = false;
      document.getSelection()?.removeAllRanges();
      actionRef.current = null;
      setAction(null);
    };
    const unsubscribe = onCodeSourceChange(() => {
      const captured = actionRef.current?.selected;
      if (captured !== undefined && !selectionIsCurrent(captured, projectPath)) {
        holdRef.current = false;
        document.getSelection()?.removeAllRanges();
        actionRef.current = null;
        setAction(null);
      }
      update();
    });
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("scroll", update, true);
    window.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("keydown", onKeyDown);
    window.visualViewport?.addEventListener("scroll", update);
    window.visualViewport?.addEventListener("resize", update);
    update();
    return () => {
      unsubscribe();
      document.getSelection()?.removeAllRanges();
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKeyDown);
      window.visualViewport?.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [projectPath]);

  useEffect(() => {
    updateRef.current();
  }, [wrap]);

  const invoke = (kind: "search" | "comment") => {
    const captured = actionRef.current?.selected ?? null;
    const native = readSelection(projectPath);
    const selected =
      native ??
      (holdRef.current && (document.getSelection()?.isCollapsed ?? true) ? captured : null);
    const valid =
      selected !== null &&
      captured !== null &&
      sameSelection(selected, captured) &&
      selectionIsCurrent(selected, projectPath) &&
      positionSelection(selected) !== null;
    holdRef.current = false;
    document.getSelection()?.removeAllRanges();
    actionRef.current = null;
    setAction(null);
    if (!valid || selected === null) return;
    if (kind === "comment" && selected.target !== null)
      handlersRef.current.onComment(selected.target);
    if (kind === "search" && selected.query !== null) handlersRef.current.onSearch(selected.query);
  };
  const hold = (event: PointerEvent) => {
    holdRef.current = true;
    event.preventDefault();
  };
  const focus = () => {
    holdRef.current = true;
  };
  const blur = () => {
    holdRef.current = false;
    updateRef.current();
  };

  if (action === null) return null;
  return (
    <div
      class={`code-selection-action code-selection-action-${action.placement}`}
      style={{ left: `${action.left}px`, top: `${action.top}px`, width: `${action.width}px` }}
    >
      {action.selected.reason !== null && (
        <span class="code-selection-reason" role="status">
          {action.selected.reason}
        </span>
      )}
      {action.selected.query !== null && (
        <button
          type="button"
          class="code-selection-search"
          aria-label={`Search selected text: ${action.selected.query}`}
          onPointerDown={hold}
          onFocus={focus}
          onBlur={blur}
          onClick={() => invoke("search")}
        >
          <span aria-hidden="true">⌕</span>
          <span class="code-selection-label">
            Search <strong>“{action.selected.query}”</strong>
          </span>
        </button>
      )}
      {action.selected.target !== null && (
        <button
          type="button"
          class="code-selection-comment"
          aria-label={`Comment on selected text: ${action.selected.text}`}
          onPointerDown={hold}
          onFocus={focus}
          onBlur={blur}
          onClick={() => invoke("comment")}
        >
          Comment
          {action.selected.query === null && (
            <span class="code-selection-label">
              <strong>“{action.selected.text}”</strong>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
