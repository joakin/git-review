import { chromium } from "playwright-core";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:search <local app URL>");
const url = new URL(rawUrl);
if (url.protocol !== "http:" && url.protocol !== "https:")
  throw new Error("Expected an HTTP(S) URL");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Search" })
      .click();
    await page.getByRole("searchbox", { name: "Find text" }).fill("working tree");
    await page.locator(".search-form button").click();
    await page
      .getByRole("button", { name: /^Open src\/view\.ts at line 1:/ })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
    await page
      .locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]')
      .waitFor({ state: "visible" });
    if (
      await page
        .locator(".sidebar")
        .evaluate((element) => element.classList.contains("sidebar-open"))
    )
      throw new Error("Mobile drawer remained open after result navigation");
    await page.getByRole("button", { name: "Open list" }).click();
    if (!(await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).isVisible()))
      throw new Error("Search results were lost after opening a file");
    await page.getByRole("button", { name: "Refresh results" }).click();
    await page
      .getByRole("button", { name: /^Open src\/view\.ts at line 1:/ })
      .waitFor({ state: "visible" });
    await page.getByRole("searchbox", { name: "Find text" }).fill("item170");
    await page.locator(".search-form button").click();
    await page.getByRole("button", { name: /^Open src\/tall-review\.ts at line 170:/ }).click();
    const target = page.locator(
      '.file-panel[data-path="src/tall-review.ts"] .file-code-row-target[data-line="170"]',
    );
    await target.waitFor({ state: "visible" });
    const targetBox = await target.boundingBox();
    if (targetBox === null || targetBox.y < 0 || targetBox.y > 844)
      throw new Error("A deep search result did not scroll into the phone viewport");
    const location = page.locator(".file-location-bar");
    const locationBox = await location.boundingBox();
    if (
      locationBox === null ||
      locationBox.y < 60 ||
      locationBox.y > 90 ||
      !(await location.textContent())?.includes("src/tall-review.ts")
    )
      throw new Error(
        "The file path did not stay visible below the top bar above a deep search result",
      );
    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("searchbox", { name: "Find text" }).fill("working tree");
    await page.locator(".search-form button").click();
    await page
      .getByRole("button", { name: /^Open src\/view\.ts at line 1:/ })
      .waitFor({ state: "visible" });
    await page.route("**/api/projects/*/file?*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "not_found", message: "File was not found" } }),
      }),
    );
    await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "may have changed or been deleted" })
      .waitFor({ state: "visible" });
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    if (widths.document > widths.viewport + 2)
      throw new Error(`Search page overflowed: ${JSON.stringify(widths)}`);
    if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    console.log(
      "Phone search, deep navigation, stale-result notice, preserved results, refresh, and page width passed",
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
