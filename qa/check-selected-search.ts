import { chromium } from "playwright-core";
import { selectCodeText } from "./select-code-text.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:selected-search <local app URL>");
const url = new URL(rawUrl);
if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Expected an HTTP(S) URL");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: "Browse host folders" }).click();
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();

    const diff = page.locator('main .diff-card[data-layer="unstaged"][data-path="src/view.ts"]');
    await diff.locator(".diff-card-toggle").click();
    const code = diff.locator(".diff-code").filter({ hasText: "working tree" });
    await code.waitFor({ state: "visible" });
    await code.scrollIntoViewIfNeeded();
    await selectCodeText(code, "working tree");
    await page.getByRole("button", { name: "Search selected text: working tree" }).waitFor({ state: "visible" });
    await selectCodeText(code, "export const");
    const action = page.getByRole("button", { name: "Search selected text: export const" });
    await action.waitFor({ state: "visible" });
    const before = await action.boundingBox();
    if (before === null) throw new Error("Selected-code action has no position");
    const selectedBottom = await page.evaluate(() => {
      const range = document.getSelection()?.getRangeAt(0);
      if (range === undefined) throw new Error("Selected range was lost");
      return range.getBoundingClientRect().bottom;
    });
    if (before.y < selectedBottom + 4) throw new Error("Touch Search action did not appear below the native selection-menu area");
    const moved = await page.evaluate(() => {
      const previous = window.scrollY;
      window.scrollBy(0, 40);
      return window.scrollY - previous;
    });
    await page.waitForTimeout(100);
    const after = await action.boundingBox();
    if (Math.abs(moved) > 2 && (after === null || Math.abs((after.y - before.y) + moved) > 4)) throw new Error("Selected-code action did not follow page scrolling");
    await page.evaluate(() => {
      const range = document.getSelection()?.getRangeAt(0);
      if (range === undefined) throw new Error("Selected range was lost");
      window.scrollBy(0, range.getBoundingClientRect().bottom - (window.innerHeight - 18));
    });
    await page.locator(".code-selection-action-docked").waitFor({ state: "visible" });
    await action.click();
    await page.getByRole("searchbox", { name: "Find text" }).waitFor({ state: "visible" });
    if (await page.getByRole("searchbox", { name: "Find text" }).inputValue() !== "export const") throw new Error("Selected code did not fill Search");
    await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
    const fileCode = page.locator('.file-panel[data-path="src/view.ts"] .file-code-line');
    await fileCode.waitFor({ state: "visible" });
    await selectCodeText(fileCode, "working tree");
    const fileAction = page.getByRole("button", { name: "Search selected text: working tree" });
    await fileAction.waitFor({ state: "visible" });
    await fileAction.click();
    if (await page.getByRole("searchbox", { name: "Find text" }).inputValue() !== "working tree") throw new Error("File code selection did not fill Search");
    await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: /Browse files/ }).click();
    await page.locator('.file-tree-row[title="src/long-line.ts"]').click();
    const longCode = page.locator('.file-panel[data-path="src/long-line.ts"] .file-code-line');
    await longCode.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Wrap: on" }).click();
    await selectCodeText(longCode, "longLine");
    const longAction = page.getByRole("button", { name: "Search selected text: longLine" });
    await longAction.waitFor({ state: "visible" });
    await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Code pane was not scrollable");
      element.scrollLeft = element.scrollWidth;
    });
    await longAction.waitFor({ state: "hidden" });
    await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Code pane was not scrollable");
      element.scrollLeft = 0;
    });
    await longAction.waitFor({ state: "visible" });

    await page.getByRole("button", { name: /Browse files/ }).click();
    await page.locator('.file-tree-row[title="src/tall-review.ts"]').click();
    await page.locator('.file-panel[data-path="src/tall-review.ts"] .file-code-line').nth(1).waitFor({ state: "visible" });
    await page.evaluate(() => {
      const lines = document.querySelectorAll('.file-panel[data-path="src/tall-review.ts"] .file-code-line');
      const first = lines.item(0);
      const second = lines.item(1);
      const firstText = first === null ? null : document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
      const secondText = second === null ? null : document.createTreeWalker(second, NodeFilter.SHOW_TEXT).nextNode();
      if (firstText === null || secondText === null) throw new Error("Two file code lines were unavailable");
      const range = document.createRange();
      range.setStart(firstText, 0);
      range.setEnd(secondText, 1);
      const selection = document.getSelection();
      if (selection === null) throw new Error("Browser selection was unavailable");
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.locator(".code-selection-action").waitFor({ state: "hidden" });
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    if (widths.document > widths.viewport + 2) throw new Error(`Selected-code Search overflowed: ${JSON.stringify(widths)}`);
    if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    console.log("Phone diff/file selection, page and code-pane scrolling, invalid cross-line selection, Search submission, results, and page width passed");
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
