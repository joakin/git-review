import type { Locator } from "playwright-core";

export async function selectCodeText(locator: Locator, text: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((element, selectedText) => {
    const content = element.textContent ?? "";
    const start = content.indexOf(selectedText);
    if (selectedText.length === 0 || start < 0)
      throw new Error(`Code does not contain selection: ${selectedText}`);
    const end = start + selectedText.length;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      const next = offset + node.length;
      if (startNode === null && start < next) {
        startNode = node;
        startOffset = start - offset;
      }
      if (end <= next) {
        endNode = node;
        endOffset = end - offset;
        break;
      }
      offset = next;
    }
    if (startNode === null || endNode === null)
      throw new Error("Could not locate selected text nodes");
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    if (selection === null) throw new Error("Browser selection is unavailable");
    selection.removeAllRanges();
    selection.addRange(range);
  }, text);
}

/** Select across registered rows without quoting gutters or relying on token markup. */
export async function selectCodeRange(
  first: Locator,
  start: number,
  last: Locator,
  end: number,
  options: { reverse?: boolean; elementBoundaries?: boolean } = {},
): Promise<void> {
  await first.scrollIntoViewIfNeeded();
  const lastElement = await last.elementHandle();
  if (lastElement === null) throw new Error("Missing last source row");
  try {
    await first.evaluate(
      (element, input) => {
        function endpoint(code: Element, offset: number): { node: Node; offset: number } {
          const text = code.textContent ?? "";
          if (offset < 0 || offset > text.length) throw new Error("Invalid source offset");
          if (text.length === 0 || input.elementBoundaries) {
            if (offset !== 0 && offset !== text.length)
              throw new Error("Element boundary must be a source edge");
            return { node: code, offset: offset === 0 ? 0 : code.childNodes.length };
          }
          const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          let position = 0;
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (!(node instanceof Text)) continue;
            if (offset <= position + node.length) return { node, offset: offset - position };
            position += node.length;
          }
          throw new Error("Missing source text endpoint");
        }
        const from = endpoint(element, input.start);
        const to = endpoint(input.last, input.end);
        const selection = document.getSelection();
        if (selection === null) throw new Error("Missing native selection");
        selection.removeAllRanges();
        if (input.reverse) selection.setBaseAndExtent(to.node, to.offset, from.node, from.offset);
        else {
          const range = document.createRange();
          range.setStart(from.node, from.offset);
          range.setEnd(to.node, to.offset);
          selection.addRange(range);
        }
      },
      {
        last: lastElement,
        start,
        end,
        reverse: options.reverse ?? false,
        elementBoundaries: options.elementBoundaries ?? false,
      },
    );
  } finally {
    await lastElement.dispose();
  }
}
