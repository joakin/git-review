import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { appUrl, qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";

function options(args: readonly string[]): { url: URL; folder: string } {
  if (args.length !== 4 || args[0] !== "--url" || args[2] !== "--folder") {
    throw new Error(
      "Usage: bun qa/check-foundation.ts --url <local app URL> --folder <direct child folder>",
    );
  }
  const rawUrl = args[1];
  const folder = args[3];
  if (rawUrl === undefined || folder === undefined || folder.length === 0 || folder.includes("/")) {
    throw new Error("Provide an app URL and one direct child folder name");
  }
  return { url: appUrl(rawUrl), folder };
}

async function main(): Promise<void> {
  const { url, folder } = options(process.argv.slice(2));
  const artifactDirectory = resolve("qa/.artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const statePath = resolve(artifactDirectory, "foundation-storage.json");
  await withQaBrowser(async (browser) => {
    await withQaContext(browser, qaProfiles.phone, async (context) => {
      const page = await context.newPage();
      await page.goto(url.href, { waitUntil: "load" });
      await page.locator(".folder-row", { hasText: folder }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      await page
        .getByRole("button", { name: "Review all changes", exact: true })
        .waitFor({ state: "visible" });
      if ((await page.locator(".project-switch .switch-label").textContent()) !== folder) {
        throw new Error("Opening the folder did not show it as the active workspace");
      }
      await page.reload({ waitUntil: "load" });
      await page
        .getByRole("button", { name: "Review all changes", exact: true })
        .waitFor({ state: "visible" });
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
      await context.storageState({ path: statePath });
    });
    console.log(`Mobile folder selection and reload passed. Browser state: ${statePath}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
