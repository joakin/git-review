import { chromium, type Page } from "playwright-core";

const [rawUrl, rawPlainUrl, ...extra] = process.argv.slice(2);
if (rawUrl === undefined || rawPlainUrl === undefined || extra.length !== 0) throw new Error("Usage: bun run qa:project-entry <inventory fixture app URL> <clean-git and plain-folder app URL>");
const base = new URL(rawUrl);
const plainBase = new URL(rawPlainUrl);
if (![base, plainBase].every((url) => url.protocol === "http:" || url.protocol === "https:")) throw new Error("Expected HTTP(S) app URLs");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function openFolder(page: Page, origin: URL, folder: string): Promise<void> {
  await page.goto(new URL(`/?section=projects&dir=${encodeURIComponent(folder)}`, origin).href);
  await page.getByRole("button", { name: /Open this folder/ }).click();
}

async function changesList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Review all changes", exact: true }).waitFor({ state: "visible" });
  assert(new URL(page.url()).searchParams.get("target") === "list", "Phone project entry did not select the Changes list route");
  assert(!await page.locator("main").isVisible(), "Phone list left the content pane visible");
  await page.getByRole("navigation", { name: "Project views" }).waitFor({ state: "visible" });
}

async function contained(page: Page): Promise<void> {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), "Project entry widened the page");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [320, 390, 600, 601, 820, 1180, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width < 601 ? 844 : 900 }, isMobile: width <= 600, hasTouch: width < 1200, serviceWorkers: "block" });
    context.setDefaultTimeout(10_000);
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openFolder(page, base, "inventory-fixture");
      await page.locator(".changes-review-all").waitFor({ state: "attached" });
      if (width <= 600) {
        await changesList(page);
        const listUrl = page.url();
        const target = await page.locator(".changes-review-all").boundingBox();
        assert(target !== null && target.height >= 44 && target.width >= 44, "Review all changes has an undersized touch target");
        await page.getByRole("button", { name: "Review all changes", exact: true }).click();
        await page.locator("main .diff-card").first().waitFor({ state: "visible" });
        const reviewUrl = page.url();
        assert(!new URL(reviewUrl).searchParams.has("target"), "Review all changes did not open the continuous review route");
        await page.getByRole("button", { name: "Go back", exact: true }).click();
        await page.waitForURL(listUrl);
        await changesList(page);
        await page.getByRole("button", { name: "Go forward", exact: true }).click();
        await page.waitForURL(reviewUrl);
        await page.reload();
        await page.locator("main .diff-card").first().waitFor({ state: "visible" });
        assert(page.url() === reviewUrl, "Reload rewrote explicit continuous review to a list");
        await page.goBack();
        await changesList(page);
        await page.getByRole("button", { name: "Open staged diff for src/view.ts", exact: true }).click();
        await page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"] .diff-row').first().waitFor({ state: "visible" });
        const diffUrl = page.url();
        await page.reload();
        await page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"] .diff-row').first().waitFor({ state: "visible" });
        await page.setViewportSize({ width: 820, height: 390 });
        assert(page.url() === diffUrl, "Rotation rewrote the selected diff route");
        await page.setViewportSize({ width, height: 844 });
        assert(page.url() === diffUrl && await page.locator("main").isVisible(), "Rotation lost phone diff content");
      } else {
        await page.locator("main .diff-card").first().waitFor({ state: "visible" });
        assert(!new URL(page.url()).searchParams.has("target"), "Tablet/desktop implicit entry changed from continuous review");
        const reviewUrl = page.url();
        await page.setViewportSize({ width: 390, height: 844 });
        assert(page.url() === reviewUrl && await page.locator("main").isVisible(), "Narrowing rewrote an existing review destination");
      }
      await contained(page);
      assert(errors.length === 0, errors.join("; "));
      console.log(`Project entry, explicit destination preservation, and containment passed at ${width}px.`);
    } finally { await context.close(); }
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  context.setDefaultTimeout(10_000);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openFolder(page, base, "inventory-fixture");
    await changesList(page);
    await page.getByRole("button", { name: "Review all changes", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("button", { name: "Choose a project", exact: true }).click();
    await page.locator(".recent-row", { hasText: "inventory-fixture" }).click();
    await changesList(page);
    await page.getByRole("button", { name: "Review all changes", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.locator(".menu-recents button", { hasText: "inventory-fixture" }).click();
    await changesList(page);
    await page.getByRole("button", { name: "Review all changes", exact: true }).click();
    await page.goto(new URL("/", base).href);
    await changesList(page);
    await page.reload();
    await changesList(page);

    for (const query of [
      "section=files&project=inventory-fixture&file=src%2Fview.ts&line=1",
      "section=search&project=inventory-fixture&q=working+tree&file=src%2Fview.ts&line=1",
    ]) {
      await page.goto(new URL(`/?${query}`, base).href);
      await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
      const fileUrl = page.url();
      await page.reload();
      await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
      assert(page.url() === fileUrl, "Explicit file or Search-result reload changed its destination");
    }
    await page.goto(new URL("/?section=git&project=inventory-fixture", base).href);
    await page.locator(".git-commit-row").first().click();
    await page.locator(".commit-view").waitFor({ state: "visible" });
    const commitUrl = page.url();
    await page.reload();
    await page.locator(".commit-view").waitFor({ state: "visible" });
    assert(page.url() === commitUrl, "Explicit commit reload changed its destination");
    await contained(page);
    assert(errors.length === 0, errors.join("; "));
    console.log("Picker recents, menu recents, bare restoration, and explicit Files/Search/commit reload passed on phone.");
    await page.route("**/api/roots", async (route) => {
      await route.fulfill({ status: 503, json: { error: { code: "internal_error", message: "Controlled host-root failure" } } });
    });
    await page.goto(new URL("/?section=changes&project=inventory-fixture&target=list", base).href);
    await page.locator(".sidebar [role=alert]").filter({ hasText: "Controlled host-root failure" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Choose another project", exact: true }).click();
    await page.locator(".root-copy").getByText("Controlled host-root failure", { exact: true }).waitFor({ state: "visible" });
    await contained(page);
    assert(errors.length === 0, errors.join("; "));
    console.log("Host-root failure is visible on the phone list and can return to the picker.");
  } finally { await context.close(); }

  for (const folder of ["clean-git", "plain-folder"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    context.setDefaultTimeout(10_000);
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openFolder(page, plainBase, folder);
      if (folder === "clean-git") {
        await changesList(page);
        assert(await page.locator(".change-row-button").count() === 0, "The clean Git fixture unexpectedly has changes");
        await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Files", exact: true }).click();
      }
      await page.locator('.file-tree-row[title="readme.txt"]').waitFor({ state: "visible" });
      assert(new URL(page.url()).searchParams.get("section") === "files" && !await page.locator("main").isVisible(), "Plain/clean folder did not offer its Files list");
      if (folder === "plain-folder") {
        assert(await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Changes", exact: true }).isDisabled(), "Non-Git Changes remained enabled");
        assert(await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Git", exact: true }).isDisabled(), "Non-Git history remained enabled");
        assert(await page.locator(".changes-review-all").count() === 0, "Non-Git folder offered continuous Git review");
      }
      await page.locator('.file-tree-row[title="readme.txt"]').click();
      await page.locator(".file-code-row").first().waitFor({ state: "visible" });
      await page.goto(new URL("/", plainBase).href);
      if (folder === "clean-git") await changesList(page);
      else await page.locator('.file-tree-row[title="readme.txt"]').waitFor({ state: "visible" });
      await contained(page);
      assert(errors.length === 0, errors.join("; "));
      console.log(`Real ${folder} entry, file access, and bare restoration passed on phone.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
