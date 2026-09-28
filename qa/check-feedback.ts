import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun qa/check-feedback.ts <local app URL>");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined }); });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  if (await page.evaluate(() => typeof crypto.randomUUID) !== "undefined") throw new Error("The insecure-origin UUID regression setup failed");
  await page.getByRole("button", { name: "Browse host folders" }).click();
  await page.getByRole("button", { name: /inventory-fixture/ }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await card.waitFor({ state: "visible" });
  await card.locator(".diff-card-toggle").click();
  await card.getByRole("button", { name: /New line 1.*Add comment/ }).click();
  await page.waitForFunction(() => document.documentElement.style.overflow === "hidden");
  await page.getByPlaceholder("What should change?").fill("Please explain the staged value.");
  await page.getByRole("button", { name: "Save comment" }).click();
  await page.locator(".comment-editor").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
  await card.getByRole("button", { name: /New line 1.*Add comment/ }).click();
  await page.locator(".comment-editor[open]").waitFor({ state: "visible" });
  await page.mouse.click(5, 100);
  await page.locator(".comment-editor").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "Feedback 1" }).click();
  const copy = page.getByRole("button", { name: "Copy feedback" });
  await copy.waitFor({ state: "visible" });
  await page.waitForFunction(() => !(document.querySelector(".feedback-dialog .review-status")));
  const preview = await page.locator("#review-export-text").inputValue();
  if (!preview.includes('[staged] "src/view.ts"') || !preview.includes('new line 1  "export const view = \'staged\';"') || !preview.includes("Please explain the staged value.")) throw new Error(`Incorrect feedback preview: ${preview}`);
  await context.storageState({ path: "qa/.artifacts/feedback-storage.json" });
  const activeSession = await page.evaluate(() => sessionStorage.getItem("git-review:active-project:v1"));
  if (activeSession === null) throw new Error("Expected an active project in this tab");
  await copy.click();
  await page.getByRole("button", { name: "Feedback 0" }).waitFor({ state: "visible" });
  if (await page.locator(".review-history-item").count() !== 1) throw new Error("Successful copy did not create history");
  await page.getByRole("button", { name: "Undo last copy" }).click();
  await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Close feedback" }).click();

  const fallback = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: "qa/.artifacts/feedback-storage.json" });
  await fallback.addInitScript((value) => sessionStorage.setItem("git-review:active-project:v1", value), activeSession);
  await fallback.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto(url, { waitUntil: "load" });
  await fallbackPage.getByRole("button", { name: "Feedback 1" }).click();
  await fallbackPage.getByRole("button", { name: "Copy feedback" }).click();
  await fallbackPage.getByText("Clipboard access is unavailable here", { exact: false }).waitFor({ state: "visible" });
  if (await fallbackPage.getByRole("button", { name: "Feedback 1" }).count() !== 1) throw new Error("Clipboard failure cleared a draft");
  if (await fallbackPage.locator("#review-export-text").inputValue() !== preview) throw new Error("Clipboard failure removed selectable text");
  await fallbackPage.getByRole("button", { name: "Close feedback" }).click();
  await fallbackPage.route("**/api/projects/*/status", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ kind: "git", revision: "00000000000000000000", entries: [] }) });
  });
  await fallbackPage.getByRole("button", { name: "Feedback 1" }).click();
  await fallbackPage.getByText("Line changed or disappeared.", { exact: false }).waitFor({ state: "visible" });
  if (await fallbackPage.getByRole("button", { name: "Copy feedback" }).isEnabled()) throw new Error("Outdated feedback remained copyable");
  if (await fallbackPage.locator("#review-export-text").count() !== 0) throw new Error("Outdated feedback remained selectable for export");
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await fallback.close();
  await context.close();
  console.log("Mobile comment, reload, preview, copy history, undo, clipboard fallback, and outdated-line exclusion passed.");
} finally {
  await browser.close();
}
