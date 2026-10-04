import { useEffect, useRef, useState } from "preact/hooks";

type SelectionAction = {
  text: string;
  left: number;
  top: number;
  width: number;
  placement: "above" | "below" | "docked";
};
type Box = { left: number; top: number; right: number; bottom: number };

const actionWidth = 220;
const actionHeight = 44;
const edgeGap = 8;

function codeElement(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const code = element?.closest("code.diff-code, code.file-code-line");
  return code instanceof HTMLElement && code.isConnected ? code : null;
}

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

function readSelection(): SelectionAction | null {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const startCode = codeElement(range.startContainer);
  if (startCode === null || codeElement(range.endContainer) !== startCode) return null;
  const text = selection.toString().trim();
  if (text.length === 0 || text.length > 128 || /[\0\r\n]/.test(text)) return null;

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
  const bottom = Math.max(...firstLine.map((rect) => rect.bottom));
  const width = Math.min(actionWidth, viewport.right - viewport.left - edgeGap * 2);
  if (width < 110) return null;
  const actionLeft = Math.max(
    viewport.left + edgeGap,
    Math.min((left + right - width) / 2, viewport.right - width - edgeGap),
  );
  const above = top - actionHeight - edgeGap;
  const below = bottom + edgeGap;
  const fitsAbove = above >= viewport.top + edgeGap;
  const fitsBelow = below + actionHeight <= viewport.bottom - edgeGap;
  if (window.matchMedia("(pointer: coarse)").matches) {
    if (fitsBelow) return { text, left: actionLeft, top: below, width, placement: "below" };
    const topbar = document.querySelector(".topbar");
    const dockedTop = Math.max(
      viewport.top + edgeGap,
      (topbar?.getBoundingClientRect().bottom ?? viewport.top) + edgeGap,
    );
    if (dockedTop + actionHeight + edgeGap < top)
      return { text, left: actionLeft, top: dockedTop, width, placement: "docked" };
    return null;
  }
  if (fitsAbove) return { text, left: actionLeft, top: above, width, placement: "above" };
  if (fitsBelow) return { text, left: actionLeft, top: below, width, placement: "below" };
  return null;
}

function sameAction(first: SelectionAction | null, second: SelectionAction | null): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.text === second.text &&
    first.left === second.left &&
    first.top === second.top &&
    first.width === second.width &&
    first.placement === second.placement
  );
}

export function CodeSelectionSearch({
  onSearch,
  wrap,
}: {
  onSearch: (text: string) => void;
  wrap: boolean;
}) {
  const [action, setAction] = useState<SelectionAction | null>(null);
  const actionRef = useRef<SelectionAction | null>(null);
  const onSearchRef = useRef(onSearch);
  const holdRef = useRef(false);
  const updateRef = useRef<() => void>(() => {});
  onSearchRef.current = onSearch;

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = readSelection();
        if (holdRef.current && next === null) return;
        actionRef.current = next;
        setAction((current) => (sameAction(current, next) ? current : next));
      });
    };
    updateRef.current = update;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      holdRef.current = false;
      document.getSelection()?.removeAllRanges();
      actionRef.current = null;
      setAction(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("scroll", update, true);
    window.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("keydown", onKeyDown);
    window.visualViewport?.addEventListener("scroll", update);
    window.visualViewport?.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKeyDown);
      window.visualViewport?.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    updateRef.current();
  }, [wrap]);

  const search = () => {
    const selected = actionRef.current;
    if (selected === null) return;
    holdRef.current = false;
    document.getSelection()?.removeAllRanges();
    actionRef.current = null;
    setAction(null);
    onSearchRef.current(selected.text);
  };

  if (action === null) return null;
  return (
    <div
      class={`code-selection-action code-selection-action-${action.placement}`}
      style={{ left: `${action.left}px`, top: `${action.top}px`, width: `${action.width}px` }}
    >
      <button
        type="button"
        aria-label={`Search selected text: ${action.text}`}
        onPointerDown={(event) => {
          holdRef.current = true;
          event.preventDefault();
        }}
        onFocus={() => {
          holdRef.current = true;
        }}
        onBlur={() => {
          holdRef.current = false;
          updateRef.current();
        }}
        onClick={search}
      >
        <span aria-hidden="true">⌕</span>
        <span class="code-selection-label">
          Search <strong>“{action.text}”</strong>
        </span>
      </button>
    </div>
  );
}
