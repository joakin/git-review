import { chromium, type Page } from "playwright-core";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:navigation <local app URL>");
const base = new URL(rawUrl);
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function waitForRoute(page: Page, section: string): Promise<void> {
  await page.waitForURL((value) => value.searchParams.get("section") === section);
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base.href, { waitUntil: "load" });
  await waitForRoute(page, "projects");
  await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await waitForRoute(page, "changes");
  await page.locator(".project-switch .switch-label").getByText("inventory-fixture").waitFor();
  await page.goBack();
  await waitForRoute(page, "projects");
  await page.getByRole("button", { name: /Open this folder/ }).waitFor({ state: "visible" });
  await page.goForward();
  await waitForRoute(page, "changes");
  await page.locator(".diff-card").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Back to list" }).click();
  if (await page.locator(".main-content").isVisible()) throw new Error("Phone list left the content pane visible");
  await page.getByRole("navigation", { name: "Project views" }).waitFor({ state: "visible" });

  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Search" }).click();
  await waitForRoute(page, "search");
  await page.getByRole("searchbox", { name: "Find text" }).fill("working tree");
  await page.locator(".search-form button").click();
  await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });
  const resultsUrl = page.url();
  await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
  await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
  if (await page.getByRole("navigation", { name: "Project views" }).isVisible()) throw new Error("Phone tabs remained visible over file content");
  const resultUrl = page.url();
  if (!resultUrl.includes("section=search") || !resultUrl.includes("file=src%2Fview.ts") || !resultUrl.includes("line=1")) throw new Error(`Search result did not get a direct URL: ${resultUrl}`);
  await page.goBack();
  await page.waitForURL(resultsUrl);
  await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });
  await page.goForward();
  await page.waitForURL(resultUrl);
  await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
  await page.reload();
  await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });

  const direct = await context.newPage();
  await direct.goto(resultUrl);
  await direct.locator('.file-panel[data-path="src/view.ts"] .file-code-row-target[data-line="1"]').waitFor({ state: "visible" });
  await direct.getByRole("button", { name: "Back to list" }).click();
  await direct.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });
  await direct.goto(new URL("/?section=files&project=inventory-fixture&file=src%2Ftall-review.ts&line=170", base).href);
  await direct.locator('.file-panel[data-path="src/tall-review.ts"] .file-code-row-target[data-line="170"]').waitFor({ state: "visible" });
  if (!direct.url().includes("dir=src")) throw new Error("A direct file link did not normalize its directory");
  await direct.goto(new URL("/?section=changes&project=inventory-fixture&layer=staged&file=src%2Fview.ts", base).href);
  await direct.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"] .diff-row').first().waitFor({ state: "visible" });
  await direct.close();

  await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Files" }).click();
  await waitForRoute(page, "files");
  await page.locator(".sidebar-project-title").getByText("inventory-fixture").waitFor({ state: "visible" });
  if (await page.locator(".file-tree-breadcrumb").count() !== 0) throw new Error("Files root repeated the project directory");
  await page.locator(".file-tree-row", { hasText: "src" }).click();
  await page.locator(".file-tree-breadcrumb").getByText("/src").waitFor({ state: "visible" });
  await page.locator('.file-tree-row[title="src/view.ts"]').click();
  await page.locator('.file-panel[data-path="src/view.ts"]').waitFor({ state: "visible" });
  const fileUrl = page.url();
  if (!fileUrl.includes("section=files") || !fileUrl.includes("dir=src") || !fileUrl.includes("file=src%2Fview.ts")) throw new Error(`Files did not get a direct URL: ${fileUrl}`);
  await page.goBack();
  await page.locator('.file-tree-row[title="src/view.ts"]').waitFor({ state: "visible" });
  await page.goForward();
  await page.locator('.file-panel[data-path="src/view.ts"]').waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Back to list" }).click();
  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Changes" }).click();
  await page.waitForURL((value) => value.searchParams.get("target") === "list");
  await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).click();
  await page.waitForURL((value) => value.searchParams.get("layer") === "staged" && value.searchParams.get("file") === "src/view.ts");
  const selectedCard = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await selectedCard.locator(".diff-row").first().waitFor({ state: "visible" });
  await selectedCard.locator(".diff-row-added").first().tap();
  await selectedCard.locator(".diff-line-action").click();
  await page.getByPlaceholder("What should change?").fill("Browser Back keeps this draft.");
  await page.goBack();
  await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });

  await page.locator(".project-switch").click();
  await page.getByRole("button", { name: "Choose a project" }).click();
  await waitForRoute(page, "projects");
  await page.locator(".folder-row", { hasText: "other-project" }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await waitForRoute(page, "changes");
  await page.locator(".project-switch .switch-label").getByText("other-project").waitFor();
  await page.goBack();
  await waitForRoute(page, "projects");
  await page.goBack();
  await waitForRoute(page, "projects");
  await page.goBack();
  await waitForRoute(page, "changes");
  await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
  const mobileFit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  if (!mobileFit) throw new Error("Phone navigation caused page-wide horizontal overflow");
  await page.goto(new URL("/?section=settings&project=inventory-fixture", base).href);
  await page.locator(".settings-install-data").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 320, height: 700 });
  const settingsFit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  if (!settingsFit) throw new Error("Settings actions widened a narrow phone");

  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const tabletPage = await tablet.newPage();
  await tabletPage.goto(new URL("/?section=changes&project=inventory-fixture", base).href);
  await tabletPage.locator(".diff-card").first().waitFor({ state: "visible" });
  await tabletPage.getByRole("button", { name: "Back to list" }).click();
  if (!(await tabletPage.locator(".sidebar").evaluate((element) => element.classList.contains("sidebar-open")))) throw new Error("Tablet list did not open");
  await tabletPage.locator(".sidebar-project-title").getByText("inventory-fixture").waitFor({ state: "visible" });
  await tabletPage.locator(".sidebar-project-tabs").getByRole("button", { name: "Files" }).click();
  await waitForRoute(tabletPage, "files");
  await tabletPage.goto(new URL("/?section=search&project=inventory-fixture&q=working+tree&file=src%2Fview.ts&line=1", base).href);
  await tabletPage.locator('.file-panel[data-path="src/view.ts"]').waitFor({ state: "visible" });
  await tabletPage.getByRole("button", { name: "Back to list" }).click();
  await tabletPage.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).waitFor({ state: "visible" });
  await tabletPage.locator(".sidebar .close-drawer").click();
  await tabletPage.goto(new URL("/?section=files&project=inventory-fixture&file=src%2Fview.ts", base).href);
  await tabletPage.locator('.file-panel[data-path="src/view.ts"]').waitFor({ state: "visible" });
  await tabletPage.getByRole("button", { name: "Back to list" }).click();
  await tabletPage.locator('.file-tree-row[title="src/view.ts"]').waitFor({ state: "visible" });
  await tabletPage.locator(".sidebar .close-drawer").click();
  await tabletPage.goto(new URL("/?section=files&project=x&file=..%2Fsecret", base).href);
  await tabletPage.getByRole("heading", { name: "That link cannot be opened." }).waitFor({ state: "visible" });
  await tablet.close();

  const compact = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const compactPage = await compact.newPage();
  await compactPage.goto(new URL("/?section=changes&project=inventory-fixture", base).href);
  await compactPage.locator(".diff-card").first().waitFor({ state: "visible" });
  if (!(await compactPage.locator(".sidebar").isVisible()) || await compactPage.getByRole("button", { name: "Back to list" }).isVisible()) throw new Error("Compact desktop did not keep its sidebar beside content");
  await compactPage.setViewportSize({ width: 900, height: 800 });
  const adjacent = await compactPage.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".sidebar");
    const content = document.querySelector<HTMLElement>(".main-content");
    if (list === null || content === null) throw new Error("Workspace panes are missing");
    return { listLeft: list.getBoundingClientRect().left, listRight: list.getBoundingClientRect().right, contentLeft: content.getBoundingClientRect().left, pageWidth: document.documentElement.scrollWidth };
  });
  if (adjacent.listLeft < -1 || Math.abs(adjacent.listRight - adjacent.contentLeft) > 2 || adjacent.pageWidth > 902) throw new Error(`Sidebar is not beside content at 900px: ${JSON.stringify(adjacent)}`);
  await compactPage.setViewportSize({ width: 899, height: 800 });
  if (!(await compactPage.getByRole("button", { name: "Back to list" }).isVisible())) throw new Error("Back control did not appear below the sidebar breakpoint");
  await compactPage.waitForFunction(() => (document.querySelector(".sidebar")?.getBoundingClientRect().right ?? Infinity) <= 0);
  await compactPage.getByRole("button", { name: "Back to list" }).click();
  if (!(await compactPage.locator(".sidebar").evaluate((element) => element.classList.contains("sidebar-open")))) throw new Error("Back control did not reveal the sidebar below 900px");
  await compact.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(new URL("/?section=changes&project=inventory-fixture", base).href);
  await desktopPage.locator(".diff-card").first().waitFor({ state: "visible" });
  const visible = await Promise.all([desktopPage.locator(".workspace-menu").isVisible(), desktopPage.locator(".sidebar").isVisible(), desktopPage.locator(".main-content").isVisible()]);
  if (visible.some((value) => !value)) throw new Error("Desktop did not show menu, list, and content together");
  await desktopPage.locator(".sidebar-project-title").getByText("inventory-fixture").waitFor({ state: "visible" });
  if (!(await desktopPage.locator(".sidebar-project-tabs").isVisible()) || await desktopPage.locator(".main-content .project-view-tabs").count() !== 0) throw new Error("Project tabs are not in the contextual list");
  if (await desktopPage.locator(".workspace-menu").getByText("CURRENT PROJECT").count() !== 0 || await desktopPage.locator(".main-content").getByText("LOCAL ONLY").count() !== 0) throw new Error("Redundant project or host headings remain");
  await desktop.close();

  const invalid = await context.newPage();
  await invalid.goto(new URL("/?section=files&project=x&file=..%2Fsecret", base).href);
  await invalid.getByRole("heading", { name: "That link cannot be opened." }).waitFor();
  await invalid.locator("main").getByRole("button", { name: "Choose a project" }).click();
  await waitForRoute(invalid, "projects");
  await invalid.goto(new URL("/?section=files&project=missing-project-for-link-test&file=readme.txt", base).href);
  await invalid.locator("main").getByRole("button", { name: "Choose another project" }).waitFor({ state: "visible" });
  await invalid.locator("main").getByRole("button", { name: "Choose another project" }).click();
  await waitForRoute(invalid, "projects");
  await invalid.close();
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log("URL navigation, Back/Forward, direct links, phone list/content, tablet drawer, 900px sidebar boundary, desktop panes, and invalid-link recovery passed.");
} finally {
  await browser.close();
}
