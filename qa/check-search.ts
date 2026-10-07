import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-search.ts <local app URL>");
const url = appUrl(rawUrl);

await withQaBrowser(async (browser) => {
  await withQaContext(browser, qaProfiles.phone, async (context) => {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Search" })
      .click();
    await page.getByRole("searchbox", { name: "Find text" }).fill("  working tree  ");
    await page.locator(".search-form button").click();
    await page
      .getByRole("button", { name: /^Open src\/view\.ts at line 1:/ })
      .waitFor({ state: "visible" });
    if (
      (await page.getByRole("searchbox", { name: "Find text" }).inputValue()) !== "working tree" ||
      new URL(page.url()).searchParams.get("q") !== "working tree"
    )
      throw new Error("Search submission did not normalize the input and URL");
    const beforeRepeat = page.url();
    const repeated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/project/search",
    );
    await page.locator(".search-form button").click();
    if ((await repeated).status() !== 200 || page.url() !== beforeRepeat)
      throw new Error("Repeating a Search query did not refresh the same destination");
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
    await page.route("**/api/project/file?*", (route) =>
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
    await assertNoHorizontalOverflow(page);

    const direct = new URL(beforeRepeat);
    direct.searchParams.set("q", "  term� + café🦊  ");
    await page.goto(direct.href, { waitUntil: "load" });
    await page
      .getByText("No matches for “term� + café🦊”. Try another search.", { exact: true })
      .waitFor({ state: "visible" });
    if (
      new URL(page.url()).searchParams.get("q") !== "term� + café🦊" ||
      (await page.getByRole("searchbox", { name: "Find text" }).inputValue()) !== "term� + café🦊"
    )
      throw new Error("A direct Unicode Search link did not canonicalize its query");
    let malformedRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/project/search") malformedRequests += 1;
    });
    await page.goto(`${url.origin}/?section=search&project=inventory-fixture&q=term%FF`, {
      waitUntil: "load",
    });
    await page
      .getByText("This link has invalid navigation information. Choose a project to continue.", {
        exact: true,
      })
      .waitFor({ state: "visible" });
    if (malformedRequests !== 0) throw new Error("A malformed Search link reached the API");
  });
  console.log(
    "Phone search, query normalization and encoding, repeat submission, deep navigation, stale-result notice, preserved results, refresh, and page width passed",
  );
});
