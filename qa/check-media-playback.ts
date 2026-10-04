import { chromium, type Page } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000/");
const activePath = process.argv[3] ?? "media-av-fixture";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function seek(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor();
  await page.waitForFunction((query) => {
    const element = document.querySelector<HTMLMediaElement>(query);
    return (
      element !== null &&
      element.readyState >= 1 &&
      Number.isFinite(element.duration) &&
      element.duration > 1
    );
  }, selector);
  const time = await page
    .locator(selector)
    .first()
    .evaluate(async (element) => {
      if (!(element instanceof HTMLMediaElement)) throw new Error("Expected media controls");
      element.currentTime = 1;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Media did not seek")), 5000);
        element.addEventListener(
          "seeked",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      return element.currentTime;
    });
  if (Math.abs(time - 1) > 0.15)
    throw new Error(`${selector} sought to ${time} instead of 1 second`);
}

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(
    new URL(`/?section=changes&project=${encodeURIComponent(activePath)}`, base).href,
  );
  await page
    .locator('.diff-card[data-layer="staged"][data-path="clip.mp4"] .diff-card-toggle')
    .click();
  await page
    .locator('.diff-card[data-layer="staged"][data-path="sound.wav"] .diff-card-toggle')
    .click();
  await seek(page, '.diff-card[data-layer="staged"][data-path="clip.mp4"] video');
  await seek(page, '.diff-card[data-layer="staged"][data-path="sound.wav"] audio');
  const raw = await page
    .locator('.diff-card[data-layer="staged"][data-path="clip.mp4"] .media-preview-head a')
    .first()
    .getAttribute("href");
  if (raw === null) throw new Error("Video raw link missing");
  const range = await page.evaluate(async (path) => {
    const response = await fetch(path, { headers: { range: "bytes=0-31" } });
    return {
      status: response.status,
      contentRange: response.headers.get("content-range"),
      byteLength: (await response.arrayBuffer()).byteLength,
    };
  }, raw);
  if (
    range.status !== 206 ||
    range.contentRange?.startsWith("bytes 0-31/") !== true ||
    range.byteLength !== 32
  )
    throw new Error("Raw video range failed");
  await page.getByRole("button", { name: "Open list" }).click();
  await page.locator(".sidebar-project-tabs").getByRole("button", { name: "Files" }).click();
  await page.locator('.file-tree-row[title="clip.mp4"]').click();
  await seek(page, ".file-panel video");
  await page.getByRole("button", { name: "Open list" }).click();
  await page.locator('.file-tree-row[title="sound.wav"]').click();
  await seek(page, ".file-panel audio");
  console.log(
    "Audio and video loaded and sought in staged cards and Files; raw video range returned 206.",
  );
} finally {
  await browser.close();
}
