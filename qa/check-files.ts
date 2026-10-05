import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:files <local app URL>");
const url = appUrl(rawUrl);

await withQaBrowser(async (browser) => {
  await withQaContext(browser, qaProfiles.phone, async (context) => {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page.getByRole("button", { name: "Review all changes", exact: true }).click();
    const staged = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
    await staged.waitFor({ state: "visible" });
    await staged.locator(".diff-card-toggle").click();
    await staged.locator(".diff-row").first().waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator('.file-tree-row[title="src"]').click();
    await page.locator('.file-tree-row[title="src/math.c"]').click();
    await page
      .locator('.file-panel[data-path="src/math.c"] .file-code-row')
      .waitFor({ state: "visible" });
    if (
      await page
        .locator(".sidebar")
        .evaluate((element) => element.classList.contains("sidebar-open"))
    )
      throw new Error("Mobile drawer remained open after file selection");
    if ((await page.locator(".file-panel .syntax-token-keyword").count()) === 0)
      throw new Error("C file was not syntax highlighted");

    await page.getByRole("button", { name: "Open list" }).click();
    if (
      new URL(page.url()).searchParams.get("file") !== null ||
      (await page.locator(".workspace").getAttribute("data-mobile-pane")) !== "list"
    )
      throw new Error("Back did not open the full-width file list");
    await page.locator('.file-tree-row[title="src/long-line.ts"]').click();
    await page.locator(".file-code-row").waitFor({ state: "visible" });
    if (await page.getByRole("button", { name: "Wrap: on" }).count())
      await page.getByRole("button", { name: "Wrap: on" }).click();
    const scrolled = await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing code pane");
      return {
        client: element.clientWidth,
        scroll: element.scrollWidth,
      };
    });
    await assertNoHorizontalOverflow(page);
    if (scrolled.scroll <= scrolled.client)
      throw new Error(`Code scrolling escaped the pane: ${JSON.stringify(scrolled)}`);
    await page.getByRole("button", { name: "Wrap: off" }).click();
    const wrapped = await page.locator(".file-code-scroll").evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Missing code pane");
      return { client: element.clientWidth, scroll: element.scrollWidth };
    });
    if (wrapped.scroll > wrapped.client + 2)
      throw new Error(`Code did not wrap inside its pane: ${JSON.stringify(wrapped)}`);

    await page.getByRole("button", { name: "Open list" }).click();
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).click();
    if ((await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true")
      throw new Error("Open diff was lost after visiting Files");

    await assertNoHorizontalOverflow(page);
  });
  console.log(
    "Phone Files flow, C syntax, contained scrolling, wrapping, and Changes return passed",
  );

  await withQaContext(browser, qaProfiles.desktop, async (context) => {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("button", { name: /inventory-fixture/ }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator(".file-tree-row").first().waitFor({ state: "visible" });
    if ((await page.locator(".file-location-bar button").count()) !== 0)
      throw new Error("File path bar still contains a separate navigation button");
    if (!(await page.locator(".sidebar").isVisible()))
      throw new Error("Desktop file sidebar is missing");
    await assertNoHorizontalOverflow(page);
  });
});
