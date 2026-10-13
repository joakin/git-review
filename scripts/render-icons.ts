import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const source = resolve("apps/web/src/public");
const output = resolve(source, "icons");
await mkdir(output, { recursive: true });

const icons = [
  { svg: "icon.svg", png: "icon-192.png", size: 192 },
  { svg: "icon.svg", png: "icon-512.png", size: 512 },
  { svg: "icon.svg", png: "apple-touch-icon.png", size: 180 },
  { svg: "icon-maskable.svg", png: "icon-maskable-512.png", size: 512 },
] as const;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const icon of icons) {
    const page = await browser.newPage({
      viewport: { width: icon.size, height: icon.size },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto(pathToFileURL(resolve(source, icon.svg)).href);
      await page.locator("svg").evaluate((svg) => {
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
      });
      await page.screenshot({ path: resolve(output, icon.png) });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
