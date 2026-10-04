import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

function options(args: readonly string[]): { url: URL; folder: string } {
  if (args.length !== 4 || args[0] !== "--url" || args[2] !== "--folder") {
    throw new Error("Usage: bun run qa:foundation --url <local app URL> --folder <direct child folder>");
  }
  const rawUrl = args[1];
  const folder = args[3];
  if (rawUrl === undefined || folder === undefined || folder.length === 0 || folder.includes("/")) {
    throw new Error("Provide an app URL and one direct child folder name");
  }
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The app URL must use HTTP or HTTPS");
  return { url, folder };
}

async function main(): Promise<void> {
  const { url, folder } = options(process.argv.slice(2));
  const artifactDirectory = resolve("qa/.artifacts");
  await mkdir(artifactDirectory, { recursive: true });
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
      if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
      await page.locator(".folder-row", { hasText: folder }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      await page.getByRole("button", { name: "Review all changes", exact: true }).waitFor({ state: "visible" });
      if ((await page.locator(".project-switch .switch-label").textContent()) !== folder) {
        throw new Error("Opening the folder did not show it as the active workspace");
      }
      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: "Review all changes", exact: true }).waitFor({ state: "visible" });
      if ((await page.locator(".project-switch .switch-label").textContent()) !== folder) {
        throw new Error("The selected workspace was not restored after reload");
      }
      await page.getByRole("button", { name: "Review all changes", exact: true }).click();
      await page.locator(".project-view").waitFor({ state: "visible" });
      await page.locator(".project-switch").click();
      await page.locator(".menu-project").click();
      await page.locator(".folder-row", { hasText: folder }).click();
      await page.locator(".folder-name-row strong").getByText(folder, { exact: true }).waitFor();
      await page.goBack();
      await page.goBack();
      await page.locator(".project-view").waitFor({ state: "visible" });
      if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
      const statePath = resolve(artifactDirectory, "foundation-storage.json");
      await context.storageState({ path: statePath });
      console.log(`Mobile folder selection and reload passed. Browser state: ${statePath}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
