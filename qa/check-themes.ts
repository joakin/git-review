import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun run qa:themes <local app URL>");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.locator(".project-switch").click();
  await page.locator(".sidebar-settings").click();
  await page.getByRole("heading", { name: "Appearance" }).waitFor({ state: "visible" });
  if (await page.locator("#app-theme").inputValue() !== "light" || await page.locator("#code-theme").inputValue() !== "match") throw new Error("New browsers did not keep the light appearance");

  await page.locator("#app-theme").selectOption("dark");
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "dark");
  await mkdir(resolve("qa/.artifacts"), { recursive: true });
  await context.storageState({ path: resolve("qa/.artifacts/theme-dark-app-dark-code-storage.json") });
  await page.locator("#code-theme").selectOption("light");
  await page.waitForFunction(() => document.documentElement.dataset["codeTheme"] === "light");
  const darkAppLightCode = await page.evaluate(() => {
    const color = (selector: string, property: "backgroundColor" | "color") => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`Missing ${selector}`);
      return getComputedStyle(element)[property];
    };
    return {
      app: color(".settings-panel", "backgroundColor"),
      code: color(".settings-preview-line:not(.settings-preview-added):not(.settings-preview-removed)", "backgroundColor"),
      accentText: color(".settings-interface-preview-card strong", "color"),
      meta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    };
  });
  if (darkAppLightCode.app === darkAppLightCode.code || darkAppLightCode.code !== "rgb(255, 255, 255)" || darkAppLightCode.meta !== "#08151d") throw new Error(`Dark app and light code were not independent: ${JSON.stringify(darkAppLightCode)}`);
  await context.storageState({ path: resolve("qa/.artifacts/theme-dark-app-light-code-storage.json") });

  await page.getByRole("button", { name: "Back to review" }).click();
  await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await card.locator(".diff-card-toggle").click();
  await card.locator(".diff-row").first().waitFor({ state: "visible" });
  const firstMix = await page.evaluate(() => {
    const color = (selector: string, property: "backgroundColor" | "color") => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`Missing ${selector}`);
      return getComputedStyle(element)[property];
    };
    return { card: color(".diff-card", "backgroundColor"), code: color(".diff-scroll", "backgroundColor"), syntax: color(".syntax-token-keyword", "color") };
  });
  if (firstMix.card === firstMix.code || firstMix.code !== "rgb(255, 255, 255)") throw new Error(`Actual diff did not receive light code palette: ${JSON.stringify(firstMix)}`);
  const reviewScroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Feedback 0" }).click();
  const dialogSurface = await page.locator(".feedback-dialog").evaluate((element) => getComputedStyle(element).backgroundColor);
  if (dialogSurface !== firstMix.card) throw new Error(`Feedback dialog ignored the dark app palette: ${dialogSurface}`);
  await page.getByRole("button", { name: "Close feedback" }).click();

  await page.locator(".project-switch").click();
  await page.locator(".sidebar-settings").click();
  await page.locator("#app-theme").selectOption("light");
  await page.locator("#code-theme").selectOption("dark");
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "light" && document.documentElement.dataset["codeTheme"] === "dark");
  await context.storageState({ path: resolve("qa/.artifacts/theme-light-app-dark-code-storage.json") });
  await page.getByRole("button", { name: "Back to review" }).click();
  if (await card.locator(".diff-card-toggle").getAttribute("aria-expanded") !== "true") throw new Error("Appearance change collapsed the active diff");
  const restoredScroll = await page.evaluate(() => window.scrollY);
  if (Math.abs(restoredScroll - reviewScroll) > 2) throw new Error(`Appearance change moved the review position: ${reviewScroll} → ${restoredScroll}`);
  const secondMix = await page.evaluate(() => {
    const color = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`Missing ${selector}`);
      return getComputedStyle(element).backgroundColor;
    };
    return { card: color(".diff-card"), code: color(".diff-scroll"), added: color(".diff-row-added") };
  });
  if (secondMix.card !== "rgb(255, 255, 255)" || secondMix.code === secondMix.card || secondMix.added === secondMix.code) throw new Error(`Actual diff did not receive dark code palette: ${JSON.stringify(secondMix)}`);
  await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.locator(".file-tree-row", { hasText: "src" }).click();
  await page.locator('.file-tree-row[title="src/view.ts"]').click();
  await page.locator(".file-code-row").first().waitFor({ state: "visible" });
  const fileCode = await page.locator(".file-code-scroll").evaluate((element) => getComputedStyle(element).backgroundColor);
  if (fileCode !== secondMix.code) throw new Error(`Files ignored the independent code palette: ${fileCode}`);
  await page.setViewportSize({ width: 320, height: 700 });
  const fit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  if (!fit) throw new Error("Theme controls widened the 320px phone page");
  await page.reload({ waitUntil: "load" });
  await page.locator(".project-switch").click();
  await page.locator(".sidebar-settings").click();
  if (await page.locator("#app-theme").inputValue() !== "light" || await page.locator("#code-theme").inputValue() !== "dark") throw new Error("Appearance did not survive reload");
  const other = await context.newPage();
  await other.goto(url, { waitUntil: "load" });
  await page.bringToFront();
  await page.locator("#app-theme").selectOption("dark");
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "dark", undefined, { timeout: 5_000 });
  await other.bringToFront();
  await other.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "dark", undefined, { timeout: 5_000 });
  await page.bringToFront();
  await page.locator("#app-theme").selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "light");
  await page.locator("#code-theme").selectOption("match");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset["appTheme"] === "light" && document.documentElement.dataset["codeTheme"] === "light");
  await page.locator("#code-font-size").selectOption("17");
  await page.locator("#code-font-family").selectOption("courier");
  await page.getByRole("button", { name: "Reset appearance" }).click();
  if (await page.locator("#app-theme").inputValue() !== "light" || await page.locator("#code-theme").inputValue() !== "match") throw new Error("Reset appearance did not restore defaults");
  if (await page.locator("#code-font-size").inputValue() !== "17" || await page.locator("#code-font-family").inputValue() !== "courier") throw new Error("Reset appearance changed typography");
  await page.locator("#app-theme").selectOption("dark");
  await page.locator("#code-theme").selectOption("light");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  if (await page.locator("#code-font-size").inputValue() !== "12" || await page.locator("#code-font-family").inputValue() !== "system") throw new Error("Reset typography did not restore defaults");
  if (await page.locator("#app-theme").inputValue() !== "dark" || await page.locator("#code-theme").inputValue() !== "light") throw new Error("Reset typography changed appearance");
  await page.reload({ waitUntil: "load" });
  await page.locator("#app-theme").waitFor({ state: "visible" });
  if (await page.locator("#code-font-size").inputValue() !== "12" || await page.locator("#code-font-family").inputValue() !== "system" || await page.locator("#app-theme").inputValue() !== "dark" || await page.locator("#code-theme").inputValue() !== "light") throw new Error("Independent reset choices did not persist");

  await page.locator("#code-font-size").selectOption("16");
  await page.locator("#code-font-family").selectOption("courier");
  await other.evaluate(() => localStorage.setItem("git-review:appearance:v1", "{invalid JSON"));
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#app-theme")?.value === "light" && document.querySelector<HTMLSelectElement>("#code-theme")?.value === "match" && document.documentElement.dataset["codeTheme"] === "light");
  if (await page.locator("#code-font-size").inputValue() !== "16" || await page.locator("#code-font-family").inputValue() !== "courier") throw new Error("Invalid cross-tab appearance changed typography");
  await page.locator("#app-theme").selectOption("dark");
  await other.evaluate(() => localStorage.setItem("git-review:code-typography:v1", JSON.stringify({ version: 1, fontSize: 99, fontFamily: "courier" })));
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#code-font-size")?.value === "12" && document.querySelector<HTMLSelectElement>("#code-font-family")?.value === "system");
  if (await page.locator("#app-theme").inputValue() !== "dark") throw new Error("Invalid cross-tab typography changed appearance");
  await page.locator("#code-font-size").selectOption("16");
  await other.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#app-theme")?.value === "light" && document.querySelector<HTMLSelectElement>("#code-theme")?.value === "match" && document.querySelector<HTMLSelectElement>("#code-font-size")?.value === "12" && document.querySelector<HTMLSelectElement>("#code-font-family")?.value === "system" && document.documentElement.dataset["appTheme"] === "light");

  const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await deniedContext.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Storage denied for QA", "SecurityError"); } });
  });
  const denied = await deniedContext.newPage();
  denied.on("pageerror", (error) => errors.push(error.message));
  await denied.goto(url, { waitUntil: "load" });
  await denied.locator(".project-switch").click();
  await denied.locator(".sidebar-settings").click();
  await denied.locator("#app-theme").selectOption("dark");
  await denied.locator("#code-theme").selectOption("light");
  await denied.locator("#code-font-size").selectOption("17");
  await denied.locator("#code-font-family").selectOption("courier");
  await denied.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "light");
  const deniedPreview = await denied.locator(".settings-preview-line code").first().evaluate((element) => ({ size: getComputedStyle(element).fontSize, family: getComputedStyle(element).fontFamily }));
  if (deniedPreview.size !== "17px" || !deniedPreview.family.includes("Courier")) throw new Error("Unavailable storage prevented in-memory typography changes");
  await denied.reload({ waitUntil: "load" });
  await denied.locator("#app-theme").waitFor({ state: "visible" });
  if (await denied.locator("#app-theme").inputValue() !== "light" || await denied.locator("#code-theme").inputValue() !== "match" || await denied.locator("#code-font-size").inputValue() !== "12" || await denied.locator("#code-font-family").inputValue() !== "system") throw new Error("Unavailable storage did not restore defaults after reload");
  await denied.locator("#app-theme").selectOption("dark");
  await denied.locator("#code-font-size").selectOption("17");
  await denied.locator("#code-font-family").selectOption("courier");
  await denied.getByRole("button", { name: "Reset appearance" }).click();
  if (await denied.locator("#app-theme").inputValue() !== "light" || await denied.locator("#code-theme").inputValue() !== "match" || await denied.locator("#code-font-size").inputValue() !== "17") throw new Error("Appearance reset failed with unavailable storage");
  await denied.getByRole("button", { name: "Reset", exact: true }).click();
  if (await denied.locator("#code-font-size").inputValue() !== "12" || await denied.locator("#code-font-family").inputValue() !== "system") throw new Error("Typography reset failed with unavailable storage");
  await deniedContext.close();

  const prepaintContext = await browser.newContext({ storageState: resolve("qa/.artifacts/theme-dark-app-light-code-storage.json") });
  const prepaint = await prepaintContext.newPage();
  await prepaint.bringToFront();
  await prepaint.route("**/assets/main.js", async (route) => {
    await new Promise((finish) => setTimeout(finish, 2_000));
    await route.continue();
  });
  await prepaint.goto(url, { waitUntil: "commit" });
  await prepaint.waitForFunction(() => document.documentElement.dataset["appTheme"] === "dark" && document.documentElement.dataset["codeTheme"] === "light" && document.querySelector("#app")?.childElementCount === 0, undefined, { timeout: 5_000 });
  await prepaint.waitForLoadState("load");
  await prepaintContext.close();
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log("Dark/light app and code combinations, real diff and Files palettes, 320px fit, reload, cross-tab sync including invalid values and clearing, system preference, independent resets, unavailable storage, and prepaint loading passed.");
} finally {
  await browser.close();
}
