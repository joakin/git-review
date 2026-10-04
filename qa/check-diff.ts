import { chromium } from "playwright-core";

function options(args: readonly string[]): { url: URL; folder: string } {
  if (args.length !== 4 || args[0] !== "--url" || args[2] !== "--folder") {
    throw new Error("Usage: bun run qa:diff --url <local app URL> --folder <direct child Git fixture>");
  }
  const rawUrl = args[1];
  const folder = args[3];
  if (rawUrl === undefined || folder === undefined || folder.length === 0 || folder.includes("/")) {
    throw new Error("Provide an app URL and one direct child fixture folder");
  }
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The app URL must use HTTP or HTTPS");
  return { url, folder };
}

async function main(): Promise<void> {
  const { url, folder } = options(process.argv.slice(2));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(url.href, { waitUntil: "load" });
      await page.getByRole("button", { name: new RegExp(folder) }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      const staged = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
      await staged.waitFor({ state: "visible" });

      await page.getByRole("button", { name: "Open list" }).click();
      await page.getByRole("button", { name: "Open staged diff for src/view.ts" }).click();
      await staged.locator(".diff-row").first().waitFor({ state: "visible" });
      if ((await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true") {
        throw new Error("Selecting a sidebar file did not expand its diff card");
      }
      const stagedText = (await staged.locator(".diff-code").allTextContents()).join("\n");
      if (!stagedText.includes("'initial'") || !stagedText.includes("'staged'")) {
        throw new Error("The staged card did not show the staged comparison");
      }

      const longCard = page.locator('main .diff-card[data-layer="untracked"][data-path="src/long-line.ts"]');
      await longCard.locator(".diff-card-toggle").click();
      await longCard.locator(".diff-row").waitFor({ state: "visible" });
      const wrapped = await page.evaluate(() => {
        const pane = document.querySelector('main .diff-card[data-path="src/long-line.ts"] .diff-scroll');
        if (!(pane instanceof HTMLElement)) throw new Error("Long-line code pane is missing");
        return { paneWidth: pane.clientWidth, contentWidth: pane.scrollWidth };
      });
      if (wrapped.contentWidth > wrapped.paneWidth + 2) {
        throw new Error(`Code did not wrap inside its pane: ${JSON.stringify(wrapped)}`);
      }
      await page.getByRole("button", { name: "Wrap: on" }).click();
      const widths = await page.evaluate(() => {
        const pane = document.querySelector('main .diff-card[data-path="src/long-line.ts"] .diff-scroll');
        if (!(pane instanceof HTMLElement)) throw new Error("Long-line code pane is missing");
        return {
          paneWidth: pane.clientWidth,
          contentWidth: pane.scrollWidth,
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      if (widths.contentWidth <= widths.paneWidth || widths.pageWidth > widths.viewportWidth + 2) {
        throw new Error(`Code did not scroll inside its pane: ${JSON.stringify(widths)}`);
      }

      const mixedCard = page.locator('main .diff-card[data-layer="untracked"][data-path="src/wide-mixed.ts"]');
      await mixedCard.locator(".diff-card-toggle").click();
      await mixedCard.locator(".diff-row").first().waitFor({ state: "visible" });
      const scrolled = await page.evaluate(() => {
        const pane = document.querySelector('main .diff-card[data-path="src/wide-mixed.ts"] .diff-scroll');
        const content = pane?.querySelector(".diff-scroll-content");
        const rows = pane?.querySelectorAll(".diff-row");
        if (!(pane instanceof HTMLElement) || !(content instanceof HTMLElement) || rows?.length !== 2) throw new Error("Mixed-width diff is missing");
        const shortRow = rows[1];
        if (!(shortRow instanceof HTMLElement)) throw new Error("Short diff row is missing");
        pane.scrollLeft = pane.scrollWidth;
        const numbers = shortRow.querySelectorAll(".diff-number");
        const sign = shortRow.querySelector(".diff-sign");
        const hunkLabel = pane.querySelector(".diff-hunk-label span");
        const first = numbers[0];
        const second = numbers[1];
        const code = shortRow.querySelector(".diff-code");
        if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement) || !(sign instanceof HTMLElement) || !(hunkLabel instanceof HTMLElement) || !(code instanceof HTMLElement)) throw new Error("Diff row parts are missing");
        return {
          scrollLeft: pane.scrollLeft,
          paneLeft: pane.getBoundingClientRect().left,
          firstDisplay: getComputedStyle(first).display,
          secondDisplay: getComputedStyle(second).display,
          signDisplay: getComputedStyle(sign).display,
          codeLeft: code.getBoundingClientRect().left,
          codePadding: parseFloat(getComputedStyle(code).paddingLeft),
          rowLeft: shortRow.getBoundingClientRect().left,
          hunkLabelLeft: hunkLabel.getBoundingClientRect().left,
          contentRight: content.getBoundingClientRect().right,
          shortRight: shortRow.getBoundingClientRect().right,
          rowHeight: shortRow.getBoundingClientRect().height,
          background: getComputedStyle(shortRow).backgroundColor,
        };
      });
      if (scrolled.scrollLeft <= 0 || Math.abs(scrolled.shortRight - scrolled.contentRight) > 2 ||
          scrolled.signDisplay !== "none" || scrolled.firstDisplay !== "none" || scrolled.secondDisplay !== "none" ||
          Math.abs(scrolled.codeLeft - scrolled.rowLeft) > 2 || Math.abs(scrolled.codePadding - 8) > 2 ||
          Math.abs(scrolled.hunkLabelLeft - scrolled.paneLeft - 12) > 2 ||
          scrolled.rowHeight <= 0 || scrolled.rowHeight > 26 || scrolled.background === "rgba(0, 0, 0, 0)") {
        throw new Error(`Horizontal diff alignment or compact row height failed: ${JSON.stringify(scrolled)}`);
      }
      await page.getByRole("button", { name: "Wrap: off" }).click();
      const rewrapped = await page.evaluate(() => {
        const pane = document.querySelector('main .diff-card[data-path="src/wide-mixed.ts"] .diff-scroll');
        if (!(pane instanceof HTMLElement)) throw new Error("Mixed-width diff is missing after wrapping");
        const rows = pane.querySelectorAll(".diff-row");
        return {
          width: pane.clientWidth,
          scrollWidth: pane.scrollWidth,
          longHeight: rows[0]?.getBoundingClientRect().height ?? 0,
          shortHeight: rows[1]?.getBoundingClientRect().height ?? 0,
        };
      });
      if (rewrapped.scrollWidth > rewrapped.width + 2 || rewrapped.shortHeight <= 0 || rewrapped.shortHeight > 26 ||
          rewrapped.longHeight <= rewrapped.shortHeight) throw new Error(`Wrapped diff alignment failed: ${JSON.stringify(rewrapped)}`);
      console.log(`Short diff row: ${scrolled.rowHeight.toFixed(1)}px without wrap, ${rewrapped.shortHeight.toFixed(1)}px with wrap; long wrapped row: ${rewrapped.longHeight.toFixed(1)}px.`);
      await page.getByRole("button", { name: "Wrap: on" }).click();

      const tallCard = page.locator('main .diff-card[data-layer="untracked"][data-path="src/tall-review.ts"]');
      await tallCard.locator(".diff-card-toggle").click();
      await tallCard.locator(".diff-row").first().waitFor({ state: "visible" });
      const sticky = await page.evaluate(() => {
        const card = document.querySelector('main .diff-card[data-path="src/tall-review.ts"]');
        const topbar = document.querySelector(".topbar");
        const header = card?.querySelector(".diff-card-toggle");
        if (!(card instanceof HTMLElement) || !(topbar instanceof HTMLElement) || !(header instanceof HTMLElement)) throw new Error("Tall review card is missing");
        window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top + 360);
        return { topbarBottom: topbar.getBoundingClientRect().bottom, headerTop: header.getBoundingClientRect().top, cardBottom: card.getBoundingClientRect().bottom };
      });
      if (Math.abs(sticky.headerTop - sticky.topbarBottom) > 3 || sticky.cardBottom < sticky.headerTop + 200) {
        throw new Error(`Long-file header did not stick below the top bar: ${JSON.stringify(sticky)}`);
      }

      const cCard = page.locator('main .diff-card[data-layer="untracked"][data-path="src/math.c"]');
      await cCard.locator(".diff-card-toggle").click();
      await cCard.locator(".syntax-token-type").first().waitFor({ state: "visible" });
      const languageSelect = cCard.getByLabel("Language");
      await languageSelect.selectOption("cpp");
      await cCard.locator(".diff-language-row > span").getByText("cpp").waitFor({ state: "visible" });

      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: "Wrap: off" }).waitFor({ state: "visible" });
      await longCard.locator(".diff-row").waitFor({ state: "visible" });
      if ((await longCard.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true") {
        throw new Error("The expanded card was not restored after reload");
      }
      await cCard.locator(".diff-row").waitFor({ state: "visible" });
      if (await cCard.getByLabel("Language").inputValue() !== "cpp") throw new Error("Language override was not restored after reload");
      if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
      console.log("Mobile diff navigation, staged content, C highlighting, language override, gutter-free compact rows, horizontal scrolling, wrap, sticky long-file header, and reload passed.");
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
