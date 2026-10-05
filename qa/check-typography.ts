import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-typography.ts <local app URL>");
const url = appUrl(rawUrl).href;

await withQaBrowser(async (browser) => {
  await withQaContext(browser, qaProfiles.phone, async (context) => {
    const page = await context.newPage();
    const googleRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://fonts.googleapis.com/"))
        googleRequests.push(request.url());
    });
    await page.goto(url, { waitUntil: "load" });
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();
    await page.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible" });
    const googleOptions = page.locator(
      '#code-font-family option:not([value="system"]):not([value="courier"])',
    );
    if ((await googleOptions.count()) !== 20)
      throw new Error("Settings must offer 20 Google code fonts");
    await page.locator("#code-font-size").selectOption("18");
    await page.locator("#code-font-family").selectOption("courier");
    const preview = await page
      .locator(".settings-preview-line code")
      .first()
      .evaluate((element) => ({
        size: getComputedStyle(element).fontSize,
        family: getComputedStyle(element).fontFamily,
      }));
    if (preview.size !== "18px" || !preview.family.includes("Courier"))
      throw new Error(`Live preview did not change: ${JSON.stringify(preview)}`);
    if (googleRequests.length !== 0)
      throw new Error("A local font unexpectedly contacted Google Fonts");
    const fontResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith("https://fonts.googleapis.com/css2?family=JetBrains+Mono") &&
        response.ok(),
    );
    await page.locator("#code-font-family").selectOption("jetbrains-mono");
    await fontResponse;
    // The response can arrive before its stylesheet registers the font.
    await page.waitForFunction(() =>
      [...document.fonts].some((font) => font.family === "JetBrains Mono"),
    );
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('18px "JetBrains Mono"');
      return [...document.fonts].some(
        (font) => font.family === "JetBrains Mono" && font.status === "loaded",
      );
    });
    if (!loaded) throw new Error("The selected Google font was not loaded");
    const addedFontResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith("https://fonts.googleapis.com/css2?family=Iosevka+Charon+Mono") &&
        response.ok(),
    );
    await page.locator("#code-font-family").selectOption("iosevka-charon-mono");
    await addedFontResponse;
    await page.waitForFunction(() =>
      [...document.fonts].some((font) => font.family === "Iosevka Charon Mono"),
    );
    const addedFontLoaded = await page.evaluate(async () => {
      await document.fonts.load('18px "Iosevka Charon Mono"');
      return [...document.fonts].some(
        (font) => font.family === "Iosevka Charon Mono" && font.status === "loaded",
      );
    });
    if (!addedFontLoaded) throw new Error("The newly added Google font was not loaded");
    const addedFont = await page
      .locator(".settings-preview-line code")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!addedFont.includes("Iosevka Charon Mono"))
      throw new Error(`New Google font did not reach preview code: ${addedFont}`);
    await page.locator("#code-font-family").selectOption("courier");
    await page.getByRole("button", { name: "Back to review" }).click();
    await page
      .locator(".folder-row", { hasText: "inventory-fixture" })
      .waitFor({ state: "visible" });

    await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page.getByRole("button", { name: "Review all changes", exact: true }).click();
    const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
    await card.locator(".diff-card-toggle").click();
    await card.locator(".diff-row").first().waitFor({ state: "visible" });
    const diffSize = await card
      .locator(".diff-row")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize);
    if (diffSize !== "18px") throw new Error(`Diff font did not change: ${diffSize}`);
    const courierDiff = await card
      .locator(".diff-code")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!courierDiff.includes("Courier"))
      throw new Error(`Diff source ignored the chosen Courier font: ${courierDiff}`);
    const border = await card
      .locator(".diff-row")
      .first()
      .evaluate((element) => getComputedStyle(element).borderTopWidth);
    if (border !== "0px") throw new Error(`Diff row divider remains visible: ${border}`);
    await card.scrollIntoViewIfNeeded();
    const beforeSettings = await page.evaluate(() => window.scrollY);
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();
    await page.locator("#code-font-size").selectOption("20");
    await page.locator("#code-font-family").selectOption("jetbrains-mono");
    await page.getByRole("button", { name: "Back to review" }).click();
    await page.waitForTimeout(100);
    const restored = await page.evaluate(() => window.scrollY);
    if (Math.abs(restored - beforeSettings) > 2)
      throw new Error(`Settings did not restore review scroll: ${beforeSettings} → ${restored}`);
    const changedSize = await card
      .locator(".diff-row")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize);
    if (changedSize !== "20px") throw new Error(`Diff font did not update: ${changedSize}`);
    const googleDiff = await card
      .locator(".diff-code")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!googleDiff.includes("JetBrains Mono"))
      throw new Error(`Diff source ignored the chosen Google font: ${googleDiff}`);
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();
    await page.locator("#code-font-family").selectOption("system");
    await page.getByRole("button", { name: "Back to review" }).click();
    const systemDiff = await card
      .locator(".diff-code")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!systemDiff.startsWith("ui-monospace"))
      throw new Error(`Switching back to System did not update source code: ${systemDiff}`);
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();
    await page.locator("#code-font-family").selectOption("jetbrains-mono");
    await page.getByRole("button", { name: "Back to review" }).click();

    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator(".file-tree-row", { hasText: "src" }).click();
    await page.locator('.file-tree-row[title="src/view.ts"]').click();
    await page.locator(".file-code-row").first().waitFor({ state: "visible" });
    const fileSize = await page
      .locator(".file-code-row")
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize);
    if (fileSize !== "20px") throw new Error(`Files code font did not change: ${fileSize}`);
    const fileFamily = await page
      .locator(".file-code-line")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!fileFamily.includes("JetBrains Mono"))
      throw new Error(`Files source ignored the chosen Google font: ${fileFamily}`);
    await page.setViewportSize({ width: 320, height: 700 });
    await assertNoHorizontalOverflow(page);

    await page.reload({ waitUntil: "load" });
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();
    if (
      (await page.locator("#code-font-size").inputValue()) !== "20" ||
      (await page.locator("#code-font-family").inputValue()) !== "jetbrains-mono"
    )
      throw new Error("Typography did not survive reload");
    await page.getByRole("button", { name: "Back to review" }).click();
    await page.getByRole("button", { name: "Open list" }).click();
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Changes" })
      .click();
    await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).click();
    await card.locator(".diff-code").first().waitFor({ state: "visible" });
    const reloadedDiff = await card
      .locator(".diff-code")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    if (!reloadedDiff.includes("JetBrains Mono"))
      throw new Error(`Reloaded review code ignored saved font: ${reloadedDiff}`);
    await page.locator(".project-switch").click();
    await page.locator(".sidebar-settings").click();

    const other = await context.newPage();
    await other.goto(url, { waitUntil: "load" });
    await other.locator(".project-switch").click();
    await other.locator(".sidebar-settings").click();
    await page.locator("#code-font-size").selectOption("15");
    await other.locator("#code-font-size").evaluate((element) => {
      if (!(element instanceof HTMLSelectElement)) throw new Error("Missing font size selector");
      return new Promise<void>((resolve, reject) => {
        if (element.value === "15") {
          resolve();
          return;
        }
        const start = Date.now();
        const timer = setInterval(() => {
          if (element.value === "15") {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - start > 3000) {
            clearInterval(timer);
            reject(new Error("Typography did not sync to another tab"));
          }
        }, 50);
      });
    });
  });

  await withQaContext(browser, qaProfiles.phone, async (fallbackContext) => {
    await fallbackContext.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await fallbackContext.route("https://fonts.gstatic.com/**", (route) => route.abort());
    const fallback = await fallbackContext.newPage();
    await fallback.goto(url, { waitUntil: "load" });
    await fallback.locator(".project-switch").click();
    await fallback.locator(".sidebar-settings").click();
    const failedFont = fallback.waitForEvent("requestfailed", {
      predicate: (request) => request.url().startsWith("https://fonts.googleapis.com/"),
    });
    await fallback.locator("#code-font-family").selectOption("jetbrains-mono");
    await failedFont;
    await fallback.locator("#code-font-size").selectOption("20");
    await fallback.setViewportSize({ width: 320, height: 700 });
    const fallbackMetrics = await fallback
      .locator(".settings-preview-line code")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          family: style.fontFamily,
          size: style.fontSize,
          visible: rect.width > 0 && rect.height > 0 && style.visibility === "visible",
          loadedGoogleFont: [...document.fonts].some(
            (font) => font.family === "JetBrains Mono" && font.status === "loaded",
          ),
        };
      });
    if (
      fallbackMetrics.loadedGoogleFont ||
      !fallbackMetrics.family.includes("ui-monospace") ||
      fallbackMetrics.size !== "20px" ||
      !fallbackMetrics.visible
    )
      throw new Error(
        `Blocked Google font left code unusable or without its local fallback: ${JSON.stringify(fallbackMetrics)}`,
      );
    await assertNoHorizontalOverflow(fallback);
    await fallback.getByRole("button", { name: "Reset", exact: true }).click();
    if (
      (await fallback.locator("#code-font-family").inputValue()) !== "system" ||
      (await fallback.locator("#code-font-size").inputValue()) !== "12"
    )
      throw new Error("Typography reset did not recover from a blocked font");
  });
  console.log(
    "Phone Settings with 20 Google fonts, local font privacy, Google font loading and blocked-font fallback/reset, actual diff and Files code families, borderless diff rows, scroll restoration, 320px containment, reload, and tab sync passed.",
  );
});
