import { appUrl, qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";
import { checkProjectOpeningCancellation } from "./project-opening-check.ts";
import { checkWorkingCopyOwnership } from "./working-copy-ownership-check.ts";
import { checkViewStateRecovery } from "./view-state-check.ts";
import { checkDiffLoading } from "./diff-loading-check.ts";
import { checkBulkDiffControls } from "./bulk-diff-check.ts";
import { parseChangeDiffBatchRequest } from "../src/shared/change-diff-batch.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-loading.ts <local app URL>");
const base = appUrl(rawUrl);

await withQaBrowser(async (browser) => {
  await checkProjectOpeningCancellation(browser, base);
  await checkWorkingCopyOwnership(browser, base);
  await checkViewStateRecovery(browser, base);
  await checkDiffLoading(browser, base);
  await checkBulkDiffControls(browser, base);
  await withQaContext(browser, qaProfiles.phone, async (context) => {
    const page = await context.newPage();

    let releaseOpen = () => {};
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    let openCount = 0;
    const countOpenRequests = (): number => openCount;
    await page.route("**/api/projects/open", async (route) => {
      openCount += 1;
      if (openCount === 1) await openGate;
      await route.continue();
    });

    const openingRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/projects/open"),
    );
    await page.goto(new URL("/?section=changes&project=inventory-fixture&target=list", base).href);
    await openingRequest;
    if (
      (await page.locator(".root-card").isVisible()) ||
      (await page.locator(".folder-location").isVisible())
    )
      throw new Error("Project opening briefly displayed the folder picker");
    if ((await page.getByText("Opening project…").count()) !== 0)
      throw new Error("Short project wait displayed loading text immediately");
    await page
      .locator(".sidebar-message")
      .filter({ hasText: "Opening project…" })
      .waitFor({ state: "visible" });
    releaseOpen();
    await page
      .getByRole("button", { name: "Open staged diff for src/view.ts" })
      .waitFor({ state: "visible" });

    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Files" })
      .click();
    await page.locator('.file-tree-row[title="src"]').waitFor({ state: "visible" });
    let releaseTree = () => {};
    const treeGate = new Promise<void>((resolve) => {
      releaseTree = resolve;
    });
    await page.route(
      (url) => url.pathname.endsWith("/tree") && url.searchParams.get("path") === "src",
      async (route) => {
        await treeGate;
        await route.continue();
      },
    );
    await page.locator('.file-tree-row[title="src"]').click();
    if ((await page.locator('.file-tree-row[title="src"]').count()) !== 0)
      throw new Error("Previous directory remained visible after navigation");
    if ((await page.getByText("Loading files…").count()) !== 0)
      throw new Error("Short directory wait displayed loading text immediately");
    await page.getByText("Loading files…").waitFor({ state: "visible" });
    releaseTree();
    await page.locator('.file-tree-row[title="src/view.ts"]').waitFor({ state: "visible" });

    let releaseFile = () => {};
    const fileGate = new Promise<void>((resolve) => {
      releaseFile = resolve;
    });
    await page.route(
      (url) => url.pathname.endsWith("/file") && url.searchParams.get("path") === "src/view.ts",
      async (route) => {
        await fileGate;
        await route.continue();
      },
    );
    await page.locator('.file-tree-row[title="src/view.ts"]').click();
    if ((await page.getByText("Loading file…").count()) !== 0)
      throw new Error("Short file wait displayed loading text immediately");
    await page.getByText("Loading file…").waitFor({ state: "visible" });
    releaseFile();
    await page
      .locator('.file-panel[data-path="src/view.ts"] .file-code-row')
      .waitFor({ state: "visible" });

    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Choose a project" }).click();
    await page.goBack();
    await page
      .locator('.file-panel[data-path="src/view.ts"] .file-code-row')
      .waitFor({ state: "visible" });
    if (openCount !== 1)
      throw new Error(`Returning to the same project reopened it ${openCount} times`);

    await page.getByRole("button", { name: "Open list" }).click();
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Search" })
      .click();
    await page.getByRole("searchbox", { name: "Find text" }).fill("working tree");
    await page.locator(".search-form button").click();
    await page
      .getByRole("button", { name: /^Open src\/view\.ts at line 1:/ })
      .waitFor({ state: "visible" });

    let releaseSearch = () => {};
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    await page.route(
      (url) =>
        url.pathname.endsWith("/search") &&
        url.searchParams.get("query") === "no-match-loading-check",
      async (route) => {
        await searchGate;
        await route.continue();
      },
    );
    await page.getByRole("searchbox", { name: "Find text" }).fill("no-match-loading-check");
    await page.locator(".search-form button").click();
    if ((await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).count()) !== 0)
      throw new Error("Results from the previous query remained visible after submission");
    if ((await page.getByText("Searching files…").count()) !== 0)
      throw new Error("Short search wait displayed loading text immediately");
    await page.getByText("Searching files…").waitFor({ state: "visible" });
    releaseSearch();
    await page.getByText(/No matches for “no-match-loading-check”/).waitFor({ state: "visible" });

    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Choose a project" }).click();
    await page.locator(".folder-row", { hasText: "other-project" }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page
      .locator(".sidebar-project-title")
      .getByText("other-project")
      .waitFor({ state: "attached" });
    const finalOpenCount = countOpenRequests();
    if (finalOpenCount !== 2)
      throw new Error(`Switching projects sent ${finalOpenCount - 1} open requests instead of one`);

    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Choose a project" }).click();
    await page.locator(".folder-row", { hasText: "other-project" }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page
      .locator(".sidebar-project-title")
      .getByText("other-project")
      .waitFor({ state: "attached" });
    if (countOpenRequests() !== 3)
      throw new Error("Explicitly opening the same folder did not renew its project handle");
  });
  console.log(
    "Delayed loading feedback, route-specific folder and Search data, file loading, and single-request project transitions passed.",
  );

  await withQaContext(browser, qaProfiles.desktop, async (desktop) => {
    const page = await desktop.newPage();
    let diffRequests = 0;
    page.on("request", (request) => {
      if (/\/diffs?$/.test(new URL(request.url()).pathname)) diffRequests += 1;
    });
    await page.goto(new URL("/?section=changes&project=inventory-fixture", base).href);
    const card = page.locator(
      'main .diff-card[data-layer="untracked"][data-path="src/tall-review.ts"]',
    );
    await card.locator(".diff-card-toggle").click();
    await card.locator(".diff-row").first().waitFor({ state: "visible" });
    const initialRequests = diffRequests;
    const initialHeight = await card.evaluate((element) => element.getBoundingClientRect().height);
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: "instant" }));
    const initialScroll = await page.evaluate(() => window.scrollY);

    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Files" })
      .click();
    await page.waitForURL((url) => url.searchParams.get("section") === "files");
    await page.goBack();
    await card.locator(".diff-row").first().waitFor({ state: "visible" });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const returnedScroll = await page.evaluate(() => window.scrollY);
    if (Math.abs(returnedScroll - initialScroll) > 2)
      throw new Error("Changes scroll position was not restored after browser Back");
    if (diffRequests !== initialRequests)
      throw new Error("Returning from Files fetched an already loaded diff again");
    const returnedHeight = await card.evaluate((element) => element.getBoundingClientRect().height);
    if (Math.abs(returnedHeight - initialHeight) > 2)
      throw new Error("Expanded diff card changed height after browser Back");

    await page.goForward();
    await page.waitForURL((url) => url.searchParams.get("section") === "files");
    await page.goBack();
    await card.locator(".diff-row").first().waitFor({ state: "visible" });
    if (diffRequests !== initialRequests)
      throw new Error("A second Back/Forward cycle fetched the diff again");

    const refreshedDiff = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname.endsWith("/diffs") &&
        parseChangeDiffBatchRequest(request.postDataJSON() as unknown).files.some(
          (file) => file.path === "src/tall-review.ts",
        ),
    );
    await page
      .locator(".changes-actions")
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await refreshedDiff;
  });
  console.log(
    "Expanded diffs keep their payload and scroll position across Back/Forward; Refresh fetches new data.",
  );
});
