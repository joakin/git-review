import type { Page } from "playwright-core";
import { parseStatusResponse } from "@git-review/shared/api";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-sidebar-sections.ts <local app URL>");
const base = appUrl(rawUrl);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function revealList(page: Page, width: number): Promise<void> {
  if (width >= 900) return;
  if (width <= 600 && (await page.locator('.workspace[data-mobile-pane="list"]').count()) > 0)
    return;
  if ((await page.locator(".sidebar-open").count()) === 0)
    await page.getByRole("button", { name: "Open list", exact: true }).click();
}

await withQaBrowser(async (browser) => {
  for (const [name, options] of Object.entries({
    ...qaProfiles,
    narrowPhone: { ...qaProfiles.phone, viewport: { width: 320, height: 844 } },
  })) {
    await withQaContext(browser, { ...options, serviceWorkers: "block" }, async (context) => {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const width = options.viewport.width;
      const reads: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (/\/(status|diffs?)$/.test(url.pathname) && !url.searchParams.has("mode"))
          reads.push(url.href);
      });
      await page.goto(
        new URL("/?section=changes&project=line-counts-fixture&target=list", base).href,
      );
      await revealList(page, width);
      const sidebar = page.getByRole("complementary", { name: "Changed files", exact: true });
      const staged = sidebar.getByRole("button", { name: "Staged", exact: true });
      const unstaged = sidebar.getByRole("button", { name: "Unstaged", exact: true });
      const untracked = sidebar.getByRole("button", { name: "Untracked", exact: true });
      await staged.waitFor();
      for (const toggle of [staged, unstaged, untracked]) {
        assert((await toggle.getAttribute("aria-expanded")) === "true", `${name}: starts closed`);
        assert(
          ((await toggle.boundingBox())?.height ?? 0) >= 44,
          `${name}: heading touch target too small`,
        );
      }
      const totals = await staged.innerText();
      const url = page.url();
      const readCount = reads.length;
      if ("hasTouch" in options && options.hasTouch) await staged.tap();
      else await staged.click();
      await sidebar.locator('.change-group-staged button[aria-expanded="false"]').waitFor();
      assert((await staged.innerText()) === totals, `${name}: collapsed totals disappeared`);
      assert(
        !(await sidebar
          .getByRole("button", { name: "Open staged diff for src/view.ts" })
          .isVisible()),
        `${name}: collapsed rows remain accessible`,
      );
      await staged.focus();
      await page.keyboard.press("Tab");
      assert(
        await unstaged.evaluate((element) => element === document.activeElement),
        `${name}: hidden rows remain in tab order`,
      );
      await staged.focus();
      await staged.press("Space");
      await sidebar.locator('.change-group-staged button[aria-expanded="true"]').waitFor();
      await staged.press("Enter");
      await sidebar.locator('.change-group-staged button[aria-expanded="false"]').waitFor();
      assert(
        await staged.evaluate((element) => element === document.activeElement),
        `${name}: toggle lost focus`,
      );
      await untracked.click();
      await sidebar.locator('.change-group-untracked button[aria-expanded="false"]').waitFor();
      assert(
        (await unstaged.getAttribute("aria-expanded")) === "true",
        `${name}: sections are coupled`,
      );
      assert(
        !(await sidebar.locator(".change-stats-note").isVisible()),
        `${name}: hidden notes remain visible`,
      );
      assert(
        page.url() === url && reads.length === readCount,
        `${name}: disclosure navigated or fetched data`,
      );
      assert(
        (await page.locator('main .diff-card-toggle[aria-expanded="true"]').count()) === 0,
        `${name}: disclosure expanded cards`,
      );
      await assertNoHorizontalOverflow(page);

      await sidebar
        .getByRole("button", { name: "Open unstaged diff for src/view.ts", exact: true })
        .click();
      const card = page.locator('main .diff-card[data-layer="unstaged"][data-path="src/view.ts"]');
      await card.locator(".diff-row").first().waitFor({ state: "visible" });
      const refreshed = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith("/status") && !url.searchParams.has("mode");
      });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await refreshed;
      await card.locator(".diff-row").first().waitFor({ state: "visible" });
      await revealList(page, width);
      assert(
        (await staged.getAttribute("aria-expanded")) === "false",
        `${name}: Refresh reset disclosure`,
      );
      assert(
        (await card.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
        `${name}: Refresh collapsed card`,
      );

      const tabs = sidebar.getByRole("navigation", { name: "Project views" });
      await tabs.getByRole("button", { name: "Files", exact: true }).click();
      await page.locator(".file-tree-row").first().waitFor();
      await revealList(page, width);
      await page
        .getByRole("navigation", { name: "Project views" })
        .getByRole("button", { name: "Changes", exact: true })
        .click();
      await revealList(page, width);
      assert(
        (await staged.getAttribute("aria-expanded")) === "false" &&
          (await untracked.getAttribute("aria-expanded")) === "false",
        `${name}: view navigation reset disclosure`,
      );
      await sidebar.getByRole("button", { name: "Review all changes", exact: true }).click();
      await page.locator("main .diff-section-staged").waitFor({ state: "visible" });
      assert(
        (await page.locator("main .diff-section-untracked .diff-card").count()) > 0,
        `${name}: Review all omitted collapsed sidebar group`,
      );

      await page.reload();
      await revealList(page, width);
      await staged.waitFor();
      assert(
        (await staged.getAttribute("aria-expanded")) === "true" &&
          (await untracked.getAttribute("aria-expanded")) === "true",
        `${name}: reload retained transient state`,
      );
      console.log(
        `${name}: independent pointer/keyboard disclosures, totals, focus, refresh, navigation, Review all and reload pass.`,
      );
    });
  }

  await withQaContext(
    browser,
    { ...qaProfiles.desktop, serviceWorkers: "block" },
    async (context) => {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      let empty = true;
      await page.route(
        (url) => url.pathname.endsWith("/status") && !url.searchParams.has("mode"),
        async (route) => {
          const response = await route.fetch();
          const status = parseStatusResponse(await response.json());
          assert(status.kind === "git", "Empty-group fixture is not Git");
          await route.fulfill({
            response,
            json: { ...status, entries: empty ? [] : status.entries },
          });
        },
      );
      await page.goto(
        new URL("/?section=changes&project=line-counts-fixture&target=list", base).href,
      );
      const staged = page.locator(".change-group-staged .change-group-toggle");
      await staged.waitFor();
      assert((await staged.locator(".change-count").innerText()) === "0", "Empty count missing");
      await staged.click();
      assert(
        !(await page.locator(".change-group-staged .change-empty").isVisible()),
        "Empty message remains visible",
      );
      empty = false;
      const refreshed = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/status"),
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await refreshed;
      await staged.locator(".change-count").filter({ hasText: "4" }).waitFor();
      assert(
        (await staged.getAttribute("aria-expanded")) === "false",
        "New files reopened a collapsed group",
      );
      await staged.click();
      await page
        .getByRole("button", { name: "Open staged diff for src/view.ts", exact: true })
        .waitFor();
      await staged.click();
      await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
      await page.locator(".folder-row").filter({ hasText: "inventory-fixture" }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      await page.waitForURL(
        (url) => url.searchParams.get("project")?.endsWith("/inventory-fixture") === true,
      );
      await staged.waitFor();
      assert(
        (await staged.getAttribute("aria-expanded")) === "true",
        "Project switch inherited collapsed groups",
      );
      console.log("Empty groups, newly accepted files and project reset pass.");
    },
  );
});
