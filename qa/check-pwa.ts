import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun qa/check-pwa.ts <local app URL>");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const manifestResponse = await context.request.get(new URL("/manifest.webmanifest", url).href);
  if (!manifestResponse.ok() || !manifestResponse.headers()["content-type"]?.startsWith("application/manifest+json")) throw new Error("Manifest is unavailable or has the wrong MIME type");
  const manifest: unknown = await manifestResponse.json() as unknown;
  if (typeof manifest !== "object" || manifest === null || !("display" in manifest) || manifest.display !== "standalone" || !("start_url" in manifest) || manifest.start_url !== "/") throw new Error("Manifest does not declare a standalone root app");
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
    const iconResponse = await context.request.get(new URL(`/icons/${name}`, url).href);
    if (!iconResponse.ok() || iconResponse.headers()["content-type"] !== "image/png") throw new Error(`${name} is unavailable or is not PNG`);
    const png = await iconResponse.body();
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`${name} has wrong dimensions`);
  }

  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.getByRole("button", { name: "Browse host folders" }).click();
  await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await card.waitFor({ state: "visible" });
  await card.locator(".diff-card-toggle").click();
  await card.locator(".diff-row-added").tap();
  await card.locator(".diff-line-action").click();
  await page.getByPlaceholder("What should change?").fill("PWA backup keeps this draft.");
  await page.getByRole("button", { name: "Save comment" }).click();
  await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
  await page.locator(".project-switch").click();
  await page.locator(".sidebar-settings").click();
  await page.locator("#code-font-size").selectOption("17");
  await page.locator("#code-font-family").selectOption("courier");
  await page.getByRole("button", { name: "Back to review" }).click();
  await page.locator(".project-switch").click();
  await page.getByRole("button", { name: /Install & local data/ }).click();
  const dialog = page.getByRole("dialog", { name: "Install & local data" });
  await dialog.waitFor({ state: "visible" });
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export local review data" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error("Backup download did not complete");
  const backupBytes = await Bun.file(downloadPath).arrayBuffer();
  const backup: unknown = JSON.parse(new TextDecoder().decode(backupBytes)) as unknown;
  if (typeof backup !== "object" || backup === null || !("comments" in backup) || !Array.isArray(backup.comments) || backup.comments.length !== 1) throw new Error("Export omitted the review record");
  if (!("version" in backup) || backup.version !== 2 || !("codeTypography" in backup) || typeof backup.codeTypography !== "object" || backup.codeTypography === null || !("fontSize" in backup.codeTypography) || backup.codeTypography.fontSize !== 17 || !("fontFamily" in backup.codeTypography) || backup.codeTypography.fontFamily !== "courier") throw new Error("Export omitted code typography");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backupBytes) });
  await dialog.getByText("including 1 existing draft", { exact: false }).waitFor({ state: "visible" });

  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const freshPage = await fresh.newPage();
  await freshPage.goto(url, { waitUntil: "load" });
  await freshPage.locator(".project-switch").click();
  await freshPage.getByRole("button", { name: /Install & local data/ }).click();
  const freshDialog = freshPage.getByRole("dialog", { name: "Install & local data" });
  const fileInput = freshDialog.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":1}') });
  await freshDialog.getByRole("alert").waitFor({ state: "visible" });
  if (await freshDialog.getByRole("button", { name: "Import and replace matching data" }).count() !== 0) throw new Error("Invalid backup became importable");
  await fileInput.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backupBytes) });
  await freshDialog.getByRole("button", { name: "Import and replace matching data" }).click();
  await freshPage.locator(".project-switch").click();
  await freshPage.locator(".sidebar-settings").click();
  if (await freshPage.locator("#code-font-size").inputValue() !== "17" || await freshPage.locator("#code-font-family").inputValue() !== "courier") throw new Error("Imported typography was not restored");
  await freshPage.getByRole("button", { name: "Back to review" }).click();
  await freshPage.getByRole("button", { name: "Browse host folders" }).click();
  await freshPage.locator(".folder-row", { hasText: "inventory-fixture" }).click();
  await freshPage.getByRole("button", { name: /Open this folder/ }).click();
  await freshPage.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });

  const cacheUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  if (cacheUrls.some((cached) => cached.includes("/api/") || cached.includes("/diff"))) throw new Error("Service worker cached project data");
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.getByRole("heading", { name: "Host unavailable" }).waitFor({ state: "visible" });
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await fresh.close();
  await context.close();
  console.log("PWA manifest, icon dimensions, offline fallback, no API cache, draft and typography backup export/import, and invalid backup rejection passed.");
} finally {
  await browser.close();
}
