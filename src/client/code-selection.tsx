import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { type CommentAnchor, type CommentTarget } from "./comments.ts";
import { normalizeSearchQuery } from "../shared/search-query.ts";
import { maxFeedbackRangeLines } from "../shared/feedback-check.ts";
import { selectionComment } from "./code-selection-target.ts";

type CodeSource = {
  projectPath: string | null;
  resource: object;
  text: string;
  anchor: CommentAnchor | null;
};
const sources = new WeakMap<HTMLElement, CodeSource>();
const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}
export function onCodeSourceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registration belongs to the rendered snapshot, including its diff side. */
export function SelectableCode({
  projectPath,
  resource,
  anchor,
  text,
  className,
  children,
}: {
  projectPath: string | null;
  resource: object;
  anchor: CommentAnchor | null;
  text: string;
  className: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLElement>(null);
  const source = useMemo<CodeSource>(
    () => ({ projectPath, resource, text, anchor }),
    [
      projectPath,
      resource,
      text,
      anchor?.kind,
      anchor?.path,
      anchor?.line,
      anchor?.before,
      anchor?.after,
      anchor?.kind === "diff" ? anchor.layer : null,
      anchor?.kind === "diff" ? anchor.side : null,
    ],
  );
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || source.projectPath === null) return;
    sources.set(element, source);
    notify();
    return () => {
      sources.delete(element);
      notify();
    };
  }, [source]);
  return (
    <code class={className} ref={ref}>
      {children}
    </code>
  );
}

export type SelectedCode = {
  code: HTMLElement;
  source: CodeSource;
  range: Range;
  start: number;
  end: number;
  text: string;
  query: string | null;
  target: CommentTarget | null;
  reason: string | null;
  rows: { code: HTMLElement; source: CodeSource }[];
};

function endpoint(range: Range, start: boolean): { code: HTMLElement; offset: number } | null {
  const container = start ? range.startContainer : range.endContainer;
  const offset = start ? range.startOffset : range.endOffset;
  const element = container instanceof Element ? container : container.parentElement;
  if (element?.closest(".diff-no-newline") !== null) return null;
  const code = element?.closest("code.diff-code, code.file-code-line");
  if (!(code instanceof HTMLElement) || !code.isConnected) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(container, offset);
  return { code, offset: prefix.toString().length };
}

export function selectedCode(range: Range, projectPath: string): SelectedCode | null {
  const first = endpoint(range, true);
  const last = endpoint(range, false);
  if (first === null || last === null || first.code.closest("dialog") !== null) return null;
  const pane = first.code.closest(".diff-scroll, .file-code-scroll");
  if (pane === null || last.code.closest(".diff-scroll, .file-code-scroll") !== pane) return null;
  const rows: SelectedCode["rows"] = [];
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node instanceof HTMLElement && node.matches("code.diff-code, code.file-code-line")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  walker.currentNode = first.code;
  let reachedEnd = false;
  for (let node: Node | null = first.code; node !== null; node = walker.nextNode()) {
    if (!(node instanceof HTMLElement)) return null;
    const source = sources.get(node);
    if (
      source === undefined ||
      source.projectPath !== projectPath ||
      Array.from(node.childNodes)
        .filter((child) => !(child instanceof Element && child.matches(".diff-no-newline")))
        .map((child) => child.textContent ?? "")
        .join("") !== source.text
    )
      return null;
    rows.push({ code: node, source });
    if (node === last.code) {
      reachedEnd = true;
      break;
    }
    if (rows.length > maxFeedbackRangeLines) break;
  }
  const head = rows[0];
  const endpointSource = sources.get(last.code);
  if (
    head === undefined ||
    endpointSource === undefined ||
    first.offset > head.source.text.length ||
    last.offset > endpointSource.text.length
  )
    return null;
  const normalized = range.cloneRange();
  let end = last.offset;
  // An untouched next row must not acquire a comment marker for the structural newline.
  if (reachedEnd && rows.length > 1 && end === 0) {
    rows.pop();
    const previous = rows.at(-1);
    if (previous === undefined) return null;
    end = previous.source.text.length;
  }
  const text = rows.map((row) => row.source.text).join("\n");
  const tail = rows.at(-1);
  if (tail === undefined) return null;
  const stop = text.length - tail.source.text.length + end;
  const selectedText = text.slice(first.offset, stop);
  const query = rows.length === 1 ? normalizeSearchQuery(selectedText) : null;
  const comment = selectionComment(
    rows.map((row) => row.source),
    first.offset,
    end,
  );
  const reason = !reachedEnd
    ? `Select at most ${maxFeedbackRangeLines} source lines.`
    : rows.some((row) => row.source.resource !== head.source.resource)
      ? "Select consecutive lines from one source view."
      : comment?.kind === "unavailable"
        ? comment.reason
        : null;
  const target = reason === null && comment?.kind === "target" ? comment.target : null;
  if (query === null && target === null && reason === null) return null;
  return {
    code: head.code,
    source: head.source,
    rows,
    range: normalized,
    start: first.offset,
    end,
    text: selectedText,
    query,
    target,
    reason,
  };
}

export function sameSelection(first: SelectedCode, second: SelectedCode): boolean {
  return (
    first.start === second.start &&
    first.end === second.end &&
    first.text === second.text &&
    first.reason === second.reason &&
    first.rows.length === second.rows.length &&
    first.rows.every(
      (row, index) =>
        row.code === second.rows[index]?.code && row.source === second.rows[index]?.source,
    )
  );
}

export function selectionIsCurrent(selected: SelectedCode, projectPath: string): boolean {
  const fresh = selectedCode(selected.range, projectPath);
  return (
    fresh !== null &&
    sameSelection(fresh, selected) &&
    selected.code.isConnected &&
    sources.get(selected.code) === selected.source &&
    selected.source.projectPath === projectPath &&
    selected.code.getClientRects().length > 0 &&
    document.querySelector("dialog[open]") === null
  );
}
