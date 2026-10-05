import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { selectionSubject, type CommentAnchor, type CommentTarget } from "./comments.ts";

type CodeSource = { projectId: string | null; text: string; anchor: CommentAnchor | null };
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
  projectId,
  resource,
  anchor,
  text,
  className,
  children,
}: {
  projectId: string | null;
  resource: object;
  anchor: CommentAnchor | null;
  text: string;
  className: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLElement>(null);
  const source = useMemo<CodeSource>(
    () => ({ projectId, text, anchor }),
    [
      projectId,
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
    if (element === null || source.projectId === null) return;
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
  target: CommentTarget | null;
};

export function selectedCode(range: Range, projectId: string): SelectedCode | null {
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const code = element?.closest("code.diff-code, code.file-code-line");
  if (!(code instanceof HTMLElement) || !code.contains(range.endContainer) || !code.isConnected)
    return null;
  const source = sources.get(code);
  if (source === undefined || source.projectId !== projectId || code.closest("dialog") !== null)
    return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  const end = start + text.length;
  if (
    text.trim().length === 0 ||
    /[\0\r\n]/.test(text) ||
    end > source.text.length ||
    source.text.slice(start, end) !== text
  )
    return null;
  const subject = selectionSubject(source.text, start, end);
  const target =
    source.anchor !== null && subject !== null ? { anchor: source.anchor, subject } : null;
  if (text.trim().length > 128 && target === null) return null;
  return { code, source, range: range.cloneRange(), start, end, text, target };
}

export function selectionIsCurrent(selected: SelectedCode, projectId: string): boolean {
  const fresh = selectedCode(selected.range, projectId);
  return (
    fresh !== null &&
    fresh.start === selected.start &&
    fresh.end === selected.end &&
    fresh.text === selected.text &&
    selected.code.isConnected &&
    sources.get(selected.code) === selected.source &&
    selected.source.projectId === projectId &&
    selected.code.getClientRects().length > 0 &&
    document.querySelector("dialog[open]") === null
  );
}
