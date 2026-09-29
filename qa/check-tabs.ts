import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:tabs <local app URL>");
const url = new URL(rawUrl);
const rootPath = resolve("qa/.artifacts");
await mkdir(resolve(rootPath, "other-project"), { recursive: true });

async function selectFolder(page: Page, folder: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(folder) }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await page.locator(".sidebar-project-title").getByText(folder, { exact: true }).waitFor();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    await first.goto(url.href);
    await selectFolder(first, "inventory-fixture");

    const second = await context.newPage();
    await second.goto(url.href);
    await second.locator(".welcome h1").waitFor();
    await selectFolder(second, "other-project");

    await first.reload();
    await first.locator(".sidebar-project-title").getByText("inventory-fixture", { exact: true }).waitFor();
    await second.reload();
    await second.locator(".sidebar-project-title").getByText("other-project", { exact: true }).waitFor();
    const state = await first.evaluate(() => ({
      shared: localStorage.getItem("git-review:workspace:v3"),
      first: sessionStorage.getItem("git-review:active-project:v1"),
    }));
    const secondActive = await second.evaluate(() => sessionStorage.getItem("git-review:active-project:v1"));
    if (state.shared === null || state.shared.includes("activePath") || !state.shared.includes("other-project") ||
        state.first === null || !state.first.includes("inventory-fixture") || secondActive === null || !secondActive.includes("other-project")) {
      throw new Error(`Projects are not independent by tab: ${JSON.stringify({ ...state, secondActive })}`);
    }

    const migration = await browser.newContext();
    try {
      const migrated = await migration.newPage();
      await migrated.goto(url.href);
      await migrated.evaluate((approvedRoot) => localStorage.setItem("git-review:workspace:v2", JSON.stringify({
        version: 2, rootPath: approvedRoot, activePath: "inventory-fixture", recentPaths: ["inventory-fixture"],
      })), rootPath);
      await migrated.reload();
      await migrated.locator(".sidebar-project-title").getByText("inventory-fixture", { exact: true }).waitFor();
      const legacy = await migrated.evaluate(() => localStorage.getItem("git-review:workspace:v2"));
      if (legacy !== null) throw new Error("Legacy shared selection was not retired");
      const fresh = await migration.newPage();
      await fresh.goto(url.href);
      await fresh.locator(".welcome h1").waitFor();
    } finally {
      await migration.close();
    }
    console.log("Independent project tabs, reload restoration, shared recents, and legacy selection migration passed.");
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
