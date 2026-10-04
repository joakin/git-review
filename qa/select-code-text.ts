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
