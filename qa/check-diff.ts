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
      await page.getByRole("button", { name: "Browse host folders" }).click();
      await page.getByRole("button", { name: new RegExp(folder) }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      const staged = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
      await staged.waitFor({ state: "visible" });

      await page.locator(".project-switch").click();
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

      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: "Wrap: off" }).waitFor({ state: "visible" });
      await longCard.locator(".diff-row").waitFor({ state: "visible" });
      if ((await longCard.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true") {
        throw new Error("The expanded card was not restored after reload");
      }
      if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
      console.log("Mobile diff navigation, staged content, wrap, horizontal containment, and reload passed.");
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
