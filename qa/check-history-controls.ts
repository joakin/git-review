import { chromium, type Page } from "playwright-core";
import { selectCodeText } from "./select-code-text.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:history-controls <local app URL>");
const base = new URL(rawUrl);
const fileUrl = new URL(
  "/?section=files&project=inventory-fixture&dir=src&file=src%2Fview.ts",
  base,
).href;
const key = "git-review:navigation-history:v1";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function availability(page: Page, back: boolean, forward: boolean): Promise<void> {
  if (!back && !forward) {
    await page.locator(".history-navigation").waitFor({ state: "hidden" });
    return;
  }
  await page.locator(".history-navigation").waitFor({ state: "visible" });
  await page.waitForFunction(
    ({ back, forward }) => {
      const previous = document.querySelector<HTMLButtonElement>(
        '.history-navigation [aria-label="Go back"]',
      );
      const next = document.querySelector<HTMLButtonElement>(
        '.history-navigation [aria-label="Go forward"]',
      );
      return previous?.disabled === !back && next?.disabled === !forward;
    },
    { back, forward },
  );
}

async function list(page: Page): Promise<void> {
  const sidebar = page.locator(".sidebar");
  const box = await sidebar.boundingBox();
  if ((await sidebar.isVisible()) && box !== null && box.x >= -1) return;
  await page.getByRole("button", { name: "Open list", exact: true }).click();
  await page.locator(".sidebar").waitFor({ state: "visible" });
}

try {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width <= 600,
      hasTouch: viewport.width < 900,
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(fileUrl);
      const code = page.locator(".file-code-line");
      await code.waitFor({ state: "visible" });
      await availability(page, false, false);
      await selectCodeText(code, "working tree");
      await page.getByRole("button", { name: "Search selected text: working tree" }).click();
      await page.waitForURL(
        (url) => url.searchParams.get("section") === "search" && !url.searchParams.has("file"),
      );
      const resultsUrl = page.url();
      await availability(page, true, false);
      await list(page);
      if (viewport.width > 600 && viewport.width < 900) {
        await availability(page, false, false);
        await page.setViewportSize({ width: 1180, height: 820 });
        await availability(page, true, false);
        await page.setViewportSize(viewport);
        await availability(page, false, false);
        if (page.url() !== resultsUrl)
          throw new Error("Resizing the drawer changed the destination");
      }
      await page.getByRole("button", { name: /^Open src\/view\.ts at line 1:/ }).click();
      await page.locator(".file-code-row-target").waitFor({ state: "visible" });
      const resultUrl = page.url();
      await availability(page, true, false);
      const dimensions = await page.locator(".history-navigation").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("button")].map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        }));
        return {
          left: rect.left,
          bottom: rect.bottom,
          overlap:
            feedback !== undefined &&
            rect.left < feedback.right &&
            rect.right > feedback.left &&
            rect.top < feedback.bottom &&
            rect.bottom > feedback.top,
          buttons,
          viewportHeight: innerHeight,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        };
      });
      if (
        dimensions.left < 8 ||
        dimensions.bottom > dimensions.viewportHeight - 8 ||
        dimensions.overlap ||
        dimensions.overflow ||
        dimensions.buttons.some((button) => button.width < 44 || button.height < 44)
      )
        throw new Error(`History control geometry: ${JSON.stringify(dimensions)}`);

      // Two clicks before the next render still issue only one browser traversal.
      await page.getByRole("button", { name: "Go back", exact: true }).evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Missing Back button");
        button.click();
        button.click();
      });
      await page.waitForURL(resultsUrl);
      await availability(page, true, true);
      await page.reload();
      await availability(page, true, true);
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await page.waitForURL(fileUrl);
      await code.waitFor({ state: "visible" });
      await availability(page, false, true);
      await page.getByRole("button", { name: "Go forward", exact: true }).click();
      await page.waitForURL(resultsUrl);
      await availability(page, true, true);
      await page.getByRole("button", { name: "Go forward", exact: true }).click();
      await page.waitForURL(resultUrl);
      await availability(page, true, false);
      await page.reload();
      await availability(page, true, false);
      await page.goBack();
      await page.waitForURL(resultsUrl);
      await availability(page, true, true);
      await page.goForward();
      await page.waitForURL(resultUrl);
      await availability(page, true, false);

      await selectCodeText(code, "working tree");
      await page.locator(".code-selection-action").waitFor({ state: "visible" });
      await page.locator(".history-navigation").waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await availability(page, true, false);
      await page.getByRole("button", { name: /^Feedback/ }).click();
      await page.locator(".feedback-dialog").waitFor({ state: "visible" });
      await page.locator(".history-navigation").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Close feedback", exact: true }).click();
      await availability(page, true, false);

      if (viewport.width < 1200) {
        await page.getByRole("button", { name: "Open workspace menu" }).click();
        await page.locator(".history-navigation").waitFor({ state: "hidden" });
        await page.setViewportSize({ width: 1440, height: 900 });
        await availability(page, true, false);
        await page.setViewportSize(viewport);
        await page.locator(".history-navigation").waitFor({ state: "hidden" });
        await page
          .locator(".workspace-menu")
          .getByRole("button", { name: "Close workspace menu" })
          .click();
        await availability(page, true, false);
      }

      // A new section after Back abandons the old result, including after reload.
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await page.waitForURL(resultsUrl);
      await list(page);
      await page
        .getByRole("navigation", { name: "Project views" })
        .getByRole("button", { name: "Git", exact: true })
        .click();
      await page.waitForURL(
        (url) => url.searchParams.get("section") === "git" && url.searchParams.get("ref") !== null,
      );
      const gitUrl = page.url();
      await availability(page, true, false);
      await page.reload();
      await availability(page, true, false);
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      // Phone Open list adds a real list destination; Git canonicalization adds none.
      if (viewport.width <= 600)
        await page.waitForURL(
          (url) => url.searchParams.get("section") === "search" && !url.searchParams.has("file"),
        );
      else await page.waitForURL(resultsUrl);
      await availability(page, true, true);
      await page.getByRole("button", { name: "Go forward", exact: true }).click();
      await page.waitForURL(gitUrl);
      await availability(page, true, false);

      // Recover from a browser that ignores go() without leaving controls disabled.
      await page.evaluate(() => {
        history.go = () => {};
      });
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLButtonElement>('[aria-label="Go back"]')?.disabled === true,
      );
      await availability(page, true, false);
      if (page.url() !== gitUrl) throw new Error("An ignored traversal changed the route");
      if (errors.length > 0) throw new Error(errors.join("; "));
      console.log(
        `${viewport.width}px: visible/native history, Search return, reload, branching, Git replacement, overlays, rapid/ignored traversal, touch targets and containment passed`,
      );
    } finally {
      await context.close();
    }
  }

  const denied = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await denied.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("Storage denied");
        },
      });
    });
    const page = await denied.newPage();
    await page.goto(fileUrl);
    await page.locator(".file-code-line").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Open list", exact: true }).click();
    await availability(page, true, false);
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForURL(fileUrl);
    await availability(page, false, true);
    await page.reload();
    await availability(page, false, false);
    console.log(
      "Denied session storage retains page-lifetime history and reload starts conservatively",
    );
  } finally {
    await denied.close();
  }

  const corrupted = await browser.newContext();
  try {
    const page = await corrupted.newPage();
    await page.goto(fileUrl);
    await page.locator(".file-code-line").waitFor({ state: "visible" });
    await page.evaluate((key) => sessionStorage.setItem(key, '{"version":1,"entries":[]}'), key);
    await page.reload();
    await availability(page, false, false);
    await page.evaluate(() =>
      history.replaceState(
        { gitReviewNavigation: { version: 1, trail: "bad", position: 2, entry: "bad" } },
        "",
      ),
    );
    await page.reload();
    await availability(page, false, false);
    console.log("Malformed journal and entry metadata cannot advertise destinations");
    await page.locator(".file-code-line").waitFor({ state: "visible" });
    await selectCodeText(page.locator(".file-code-line"), "working tree");
    await page.getByRole("button", { name: "Search selected text: working tree" }).click();
    await availability(page, true, false);
    const independent = await corrupted.newPage();
    await independent.goto(fileUrl);
    await independent.locator(".file-code-line").waitFor({ state: "visible" });
    await availability(independent, false, false);
    await page.reload();
    await availability(page, true, false);
    await independent.close();
    console.log("A second tab starts independently without changing the original trail");
    await page.goto("data:text/html,<title>Outside the app</title>");
    await page.goBack();
    await page.waitForURL((url) => url.origin === base.origin);
    await availability(page, false, false);
    console.log("Returning from another document starts without unknown history destinations");

    await page.goto(
      new URL("/?section=search&project=inventory-fixture&q=trail-initial", base).href,
    );
    const input = page.getByRole("searchbox", { name: "Find text" });
    await input.waitFor({ state: "visible" });
    for (let index = 0; index < 60; index += 1) {
      await input.fill(`trail${index}`);
      await page.locator(".search-form button").click();
      await page.waitForURL((url) => url.searchParams.get("q") === `trail${index}`);
    }
    const retained = Math.min(61, await page.evaluate(() => history.length));
    await page.reload();
    await availability(page, true, false);
    for (let step = 1; step < retained; step += 1) {
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      const query = step === 60 ? "trail-initial" : `trail${59 - step}`;
      await page.waitForURL((url) => url.searchParams.get("q") === query);
      await availability(page, step + 1 < retained, true);
    }
    await page.reload();
    await availability(page, false, true);
    console.log(
      `Browser retained ${retained} known destinations after 60 pushes; reload and traversal stop at the oldest retained entry`,
    );
  } finally {
    await corrupted.close();
  }
} finally {
  await browser.close();
}
