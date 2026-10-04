import type { Browser } from "playwright-core";
import type { FileTree } from "../src/shared/api.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function checkViewStateRecovery(browser: Browser, base: URL): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(10_000);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let treeReads = 0;
    const treeFailure = "Controlled Files directory failure";
    await page.route((url) => /^\/api\/projects\/[^/]+\/tree$/u.test(url.pathname) && url.searchParams.get("path") === "src", async (route) => {
      treeReads += 1;
      if (treeReads === 1) await route.fulfill({ status: 503, json: { error: { code: "internal_error", message: treeFailure } } });
      else await route.continue();
    });

    await page.goto(new URL("/?section=files&project=inventory-fixture", base).href);
    await page.locator('.file-tree-row[title="src"]').click();
    await page.waitForURL((url) => url.searchParams.get("section") === "files" && url.searchParams.get("dir") === "src" && !url.searchParams.has("file"));
    const failedDirectory = page.url();
    const fileError = page.locator(".sidebar-files").getByRole("alert");
    await fileError.filter({ hasText: treeFailure }).waitFor({ state: "visible" });
    assert(await page.locator('.file-tree-row[title="src"]').count() === 0, "Failed Files navigation retained rows from the parent directory");
    await fileError.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator('.file-tree-row[title="src/view.ts"]').waitFor({ state: "visible" });
    assert(page.url() === failedDirectory, "Files Retry changed the selected directory");
    assert(treeReads === 2, `Files failure/retry sent ${treeReads} directory reads instead of two`);
    assert(await fileError.count() === 0, "Files Retry left the failed-directory error visible");
    await page.locator('.file-tree-row[title="src/view.ts"]').click();
    await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row').first().waitFor({ state: "visible" });
    assert(new URL(page.url()).searchParams.get("file") === "src/view.ts", "A recovered Files row did not open its file destination");

    // A valid empty response also exercises parent navigation without changing
    // the fixture's contents or inventing an unavailable directory.
    const emptyTree: FileTree = { path: "", parentPath: null, entries: [] };
    await page.route((url) => /^\/api\/projects\/[^/]+\/tree$/u.test(url.pathname) && url.searchParams.get("path") === "", async (route) => {
      await route.fulfill({ status: 200, json: emptyTree });
    });
    await page.getByRole("button", { name: "Open list", exact: true }).click();
    await page.getByRole("button", { name: "Go to parent directory", exact: true }).click();
    await page.getByText("This directory is empty.", { exact: true }).waitFor({ state: "visible" });
    const emptyUrl = new URL(page.url());
    assert(emptyUrl.searchParams.get("section") === "files" && !emptyUrl.searchParams.has("dir") && !emptyUrl.searchParams.has("file"), "Files parent navigation did not select the root directory list");
    assert(await page.locator(".file-tree-row").count() === 0, "Empty Files directory retained rows from the previous directory");
    console.log("Files directory failure, same-directory Retry, recovered file selection, and empty parent directory passed.");

    let directoryReads = 0;
    const pickerFailure = "Controlled picker directory failure";
    await page.route((url) => url.pathname === "/api/directories" && url.searchParams.get("path") === "inventory-fixture", async (route) => {
      directoryReads += 1;
      if (directoryReads === 1) await route.fulfill({ status: 503, json: { error: { code: "internal_error", message: pickerFailure } } });
      else await route.continue();
    });
    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Choose a project", exact: false }).click();
    await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
    const pickerError = page.locator(".folder-list-section").getByRole("alert");
    await pickerError.filter({ hasText: pickerFailure }).waitFor({ state: "visible" });
    assert(new URL(page.url()).searchParams.get("dir") === "inventory-fixture", "Picker directory failure lost the selected folder destination");
    assert(await page.locator(".open-button").isDisabled(), "Picker allowed opening a directory whose listing failed");
    await pickerError.getByRole("button", { name: "Back to root", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("section") === "projects" && !url.searchParams.has("dir"));
    await page.locator(".folder-row", { hasText: "inventory-fixture" }).waitFor({ state: "visible" });
    assert(await pickerError.count() === 0, "Back to root retained the failed picker directory's error");
    await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
    await page.getByRole("button", { name: "Go to parent folder", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const button = document.querySelector(".open-button");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.locator(".open-button").click();
    await page.getByRole("button", { name: "Review all changes", exact: true }).waitFor({ state: "visible" });
    assert(new URL(page.url()).searchParams.get("project") === "inventory-fixture", "Recovered picker did not open the selected project");
    assert(directoryReads === 2, `Picker failure/recovery sent ${directoryReads} selected-directory reads instead of two`);
    assert(errors.length === 0, `View-state browser errors: ${errors.join("; ")}`);
    console.log("Picker directory failure, Back to root, directory reselection, and recovered project opening passed.");
  } finally {
    await context.close();
  }
}
