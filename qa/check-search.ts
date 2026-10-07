import type { Page } from "playwright-core";
import { parseFileReadResponse } from "../src/shared/api.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";
import { selectCodeText } from "./select-code-text.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-search.ts <local app URL>");
const url = appUrl(rawUrl);

async function checkSameFileSectionNavigation(page: Page): Promise<void> {
  await page.goto(url.href, { waitUntil: "load" });
  await page.getByRole("button", { name: /inventory-fixture/ }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const projectPath = await page.locator(".sidebar-project-path").textContent();
  if (projectPath === null) throw new Error("Missing opened fixture path");

  let fileReads = 0;
  await page.route(
    (requestUrl) =>
      requestUrl.pathname === "/api/project/file" &&
      requestUrl.searchParams.get("projectPath") === projectPath &&
      requestUrl.searchParams.get("path") === "src/view.ts",
    async (route) => {
      const response = await route.fetch();
      const result = parseFileReadResponse((await response.json()) as unknown);
      if (result.kind !== "text" || result.lines.length !== 1)
        throw new Error("Expected the one-line working-tree fixture");
      const first = result.lines[0];
      if (first === undefined || !first.text.includes("working tree"))
        throw new Error("Expected the current working-tree fixture text");
      const text = `${first.text} // file read ${++fileReads}`;
      const freshResult = parseFileReadResponse({
        ...result,
        byteLength: new TextEncoder().encode(`${text}\n`).byteLength,
        syntax: { kind: "plain", reason: "selected" },
        lines: [{ number: 1, text, tokens: [{ text, role: "plain" }] }],
      });
      await route.fulfill({ response, json: freshResult });
    },
  );

  async function chooseTab(name: "Files" | "Search"): Promise<void> {
    const tab = page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name, exact: true });
    if (!(await tab.isVisible())) await page.getByRole("button", { name: "Open list" }).click();
    await tab.click();
  }

  const file = page.locator('.file-panel[data-path="src/view.ts"]');
  const code = file.locator(".file-code-line");
  const selectionAction = page.getByRole("button", { name: "Search selected text: working tree" });
  async function expectFreshFile(read: number, section: "files" | "search"): Promise<void> {
    await code.filter({ hasText: `// file read ${read}` }).waitFor({ state: "visible" });
    if (fileReads !== read) throw new Error(`Expected file read ${read}, got ${fileReads}`);
    await page
      .getByRole("heading", { name: section === "files" ? "Browse files" : "Search result" })
      .waitFor({ state: "visible" });
    const heading = page.locator("main .changes-heading");
    if (section === "search") {
      if ((await heading.locator(".changes-actions").count()) !== 0)
        throw new Error("Search acquired Files heading controls");
      await file.locator('.file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
    } else {
      await heading.getByRole("button", { name: /^Wrap: / }).waitFor({ state: "visible" });
      const refresh = heading.getByRole("button", { name: "Refresh", exact: true });
      if (!(await refresh.isVisible()) || !(await refresh.isEnabled()))
        throw new Error("Files Refresh is missing or disabled");
      if ((await file.locator(".file-code-row-target").count()) !== 0)
        throw new Error("Files retained the Search line target");
    }
    if ((await file.locator(".file-search-stale").count()) !== 0)
      throw new Error("Fresh same-file navigation acquired a stale-result notice");
    await selectionAction.waitFor({ state: "hidden" });
    await assertNoHorizontalOverflow(page);
  }

  await chooseTab("Files");
  await page.locator('.file-tree-row[title="src"]').click();
  await page.locator('.file-tree-row[title="src/view.ts"]').click();
  await expectFreshFile(1, "files");
  const filesUrl = page.url();
  const filesHistoryLength = await page.evaluate(() => history.length);

  await chooseTab("Search");
  await page.getByRole("searchbox", { name: "Find text" }).fill("working tree");
  await page.locator(".search-form button").click();
  await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
  await expectFreshFile(2, "search");
  const searchUrl = page.url();
  const historyDistance = (await page.evaluate(() => history.length)) - filesHistoryLength;
  if (historyDistance < 1) throw new Error("Section navigation did not create history entries");

  // Jump between UI-created file destinations without visiting the intervening list routes.
  // This exercises branch remounting even when the project/path key stays the same.
  await selectCodeText(code, "working tree");
  await selectionAction.waitFor({ state: "visible" });
  await page.evaluate((distance) => history.go(-distance), historyDistance);
  await page.waitForURL(filesUrl);
  await expectFreshFile(3, "files");
  await selectCodeText(code, "working tree");
  await selectionAction.waitFor({ state: "visible" });
  await page.evaluate((distance) => history.go(distance), historyDistance);
  await page.waitForURL(searchUrl);
  await expectFreshFile(4, "search");

  await chooseTab("Files");
  await page.locator('.file-tree-row[title="src"]').click();
  await page.locator('.file-tree-row[title="src/view.ts"]').click();
  await expectFreshFile(5, "files");
}

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
    // The row can have a layout box before FileViewer's queued route-focus scroll runs.
    await page.waitForFunction(
      () => {
        const top = document
          .querySelector(
            '.file-panel[data-path="src/tall-review.ts"] .file-code-row-target[data-line="170"]',
          )
          ?.getBoundingClientRect().y;
        return top !== undefined && top >= 0 && top <= 844;
      },
      null,
      { timeout: 5_000 },
    );
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

  for (const profile of [qaProfiles.phone, qaProfiles.desktop]) {
    await withQaContext(browser, profile, async (context) => {
      await checkSameFileSectionNavigation(await context.newPage());
    });
  }
  console.log("Phone and desktop same-file Files/Search fresh reads and selection cleanup passed");
});
