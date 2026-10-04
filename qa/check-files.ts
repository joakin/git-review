import { chromium } from "playwright-core";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:files <local app URL>");
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
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    const staged = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
    await staged.waitFor({ state: "visible" });
    await staged.locator(".diff-card-toggle").click();
    await staged.locator(".diff-row").first().waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator('.file-tree-row[title="src"]').click();
    await page.locator('.file-tree-row[title="src/math.c"]').click();
    await page.locator('.file-panel[data-path="src/math.c"] .file-code-row').waitFor({ state: "visible" });
    if (await page.locator(".sidebar").evaluate((element) => element.classList.contains("sidebar-open"))) throw new Error("Mobile drawer remained open after file selection");
    if ((await page.locator(".file-panel .syntax-token-keyword").count()) === 0) throw new Error("C file was not syntax highlighted");

    await page.getByRole("button", { name: "Open list" }).click();
    if (new URL(page.url()).searchParams.get("file") !== null || await page.locator(".workspace").getAttribute("data-mobile-pane") !== "list") throw new Error("Back did not open the full-width file list");
    await page.locator('.file-tree-row[title="src/long-line.ts"]').click();
    await page.locator(".file-code-row").waitFor({ state: "visible" });
    if (await page.getByRole("button", { name: "Wrap: on" }).count()) await page.getByRole("button", { name: "Wrap: on" }).click();
    const scrolled = await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing code pane");
      return { client: element.clientWidth, scroll: element.scrollWidth, document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth };
    });
    if (scrolled.scroll <= scrolled.client || scrolled.document > scrolled.viewport + 2) throw new Error(`Code scrolling escaped the pane: ${JSON.stringify(scrolled)}`);
    await page.getByRole("button", { name: "Wrap: off" }).click();
    const wrapped = await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing code pane");
      return { client: element.clientWidth, scroll: element.scrollWidth };
    });
    if (wrapped.scroll > wrapped.client + 2) throw new Error(`Code did not wrap inside its pane: ${JSON.stringify(wrapped)}`);

    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).click();
    if ((await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true") throw new Error("Open diff was lost after visiting Files");

    if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    console.log("Phone Files flow, C syntax, contained scrolling, wrapping, and Changes return passed");
  } finally {
    await context.close();
  }

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await desktop.newPage();
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator(".file-tree-row").first().waitFor({ state: "visible" });
    if (await page.locator(".file-location-bar button").count() !== 0) throw new Error("File path bar still contains a separate navigation button");
    if (!(await page.locator(".sidebar").isVisible())) throw new Error("Desktop file sidebar is missing");
  } finally {
    await desktop.close();
  }
} finally {
  await browser.close();
}
