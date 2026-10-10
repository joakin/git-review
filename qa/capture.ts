import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { qaDimensions } from "./browser-support.ts";
import { selectCodeText, selectCodeRange } from "./select-code-text.ts";

type CaptureOptions = {
  url: URL;
  label: string;
  ready: string | null;
  actions: Array<
    { kind: "click"; selector: string } | { kind: "fill"; selector: string; value: string }
  >;
  afterClickReady: string | null;
  fullPage: boolean;
  storageState: string | null;
  activePath: string | null;
  scrollTo: string | null;
  scrollOffset: number;
  scrollXToEnd: string | null;
  selectText: { selector: string; text: string } | null;
  selectRange: { first: string; start: number; last: string; end: number } | null;
  fakeMicrophone: boolean;
  mediaReady: boolean;
  revealList: boolean;
};

type ParsedArgs = { kind: "help" } | { kind: "capture"; options: CaptureOptions };

type View = {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
};

const views: readonly View[] = [
  { name: "desktop", ...qaDimensions.desktop, isMobile: false, hasTouch: false },
  { name: "tablet-landscape", ...qaDimensions.tabletLandscape, isMobile: true, hasTouch: true },
  { name: "tablet-portrait", ...qaDimensions.tabletPortrait, isMobile: true, hasTouch: true },
  { name: "mobile", ...qaDimensions.phone, isMobile: true, hasTouch: true },
];

const usage = `Usage: bun run qa:capture --url <http(s) URL> --label <milestone> [options]

Options:
  --ready <CSS selector>  Wait for a visible element before each screenshot
  --click <CSS selector>  Click a control after the page is ready; repeat to click in sequence
  --fill <CSS selector> <value>  Fill an input in sequence with clicks
  --after-click-ready <CSS selector> Wait for content after the click
  --storage-state <file> Use a saved Playwright browser state for every viewport
  --active-path <path>  Select this host-relative project in each viewport tab
  --scroll-to <CSS selector> Scroll an element to the top before capture
  --scroll-offset <pixels> Adjust position after --scroll-to (default: 320; negative scrolls up)
  --scroll-x-to-end <CSS selector> Scroll a code pane fully right before capture
  --select-text <CSS selector> <text> Select code text and show its contextual action
  --select-range <first selector> <start offset> <last selector> <end offset> Select source rows
  --fake-microphone       Grant Chrome's synthetic microphone for recording UI captures
  --media-ready           Wait for audio/video metadata before each screenshot
  --reveal-list           Open the contextual list drawer on narrow tablets
  --full-page             Capture the entire page instead of the viewport
  --help                  Show this help

Output: qa/screenshots/<milestone>/{desktop,tablet-landscape,tablet-portrait,mobile}.png
The milestone directory must not already exist, so earlier captures are preserved.`;

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  if (args.includes("--help")) return { kind: "help" };

  let rawUrl: string | null = null;
  let label: string | null = null;
  let ready: string | null = null;
  const actions: CaptureOptions["actions"] = [];
  let afterClickReady: string | null = null;
  let fullPage = false;
  let storageState: string | null = null;
  let activePath: string | null = null;
  let scrollTo: string | null = null;
  let scrollOffset = 320;
  let scrollXToEnd: string | null = null;
  let selectText: CaptureOptions["selectText"] = null;
  let selectRange: CaptureOptions["selectRange"] = null;
  let fakeMicrophone = false;
  let mediaReady = false;
  let revealList = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--url":
        rawUrl = readValue(args, index, flag);
        index += 1;
        break;
      case "--label":
        label = readValue(args, index, flag);
        index += 1;
        break;
      case "--ready":
        ready = readValue(args, index, flag);
        index += 1;
        break;
      case "--click":
        actions.push({ kind: "click", selector: readValue(args, index, flag) });
        index += 1;
        break;
      case "--fill":
        actions.push({
          kind: "fill",
          selector: readValue(args, index, flag),
          value: readValue(args, index + 1, flag),
        });
        index += 2;
        break;
      case "--after-click-ready":
        afterClickReady = readValue(args, index, flag);
        index += 1;
        break;
      case "--storage-state":
        storageState = readValue(args, index, flag);
        index += 1;
        break;
      case "--active-path":
        activePath = readValue(args, index, flag);
        index += 1;
        break;
      case "--scroll-to":
        scrollTo = readValue(args, index, flag);
        index += 1;
        break;
      case "--scroll-offset": {
        const parsed = Number(readValue(args, index, flag));
        if (!Number.isSafeInteger(parsed) || parsed < -5000 || parsed > 5000)
          throw new Error("--scroll-offset must be an integer from -5000 to 5000");
        scrollOffset = parsed;
        index += 1;
        break;
      }
      case "--scroll-x-to-end":
        scrollXToEnd = readValue(args, index, flag);
        index += 1;
        break;
      case "--select-text":
        selectText = {
          selector: readValue(args, index, flag),
          text: readValue(args, index + 1, flag),
        };
        index += 2;
        break;
      case "--select-range": {
        const first = readValue(args, index, flag);
        const start = Number(readValue(args, index + 1, flag));
        const last = readValue(args, index + 2, flag);
        const end = Number(readValue(args, index + 3, flag));
        if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < 0)
          throw new Error("--select-range needs nonnegative integer offsets");
        selectRange = { first, start, last, end };
        index += 4;
        break;
      }
      case "--full-page":
        fullPage = true;
        break;
      case "--fake-microphone":
        fakeMicrophone = true;
        break;
      case "--media-ready":
        mediaReady = true;
        break;
      case "--reveal-list":
        revealList = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag ?? "(missing)"}`);
    }
  }

  if (rawUrl === null || label === null) {
    throw new Error("Both --url and --label are required");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(label)) {
    throw new Error("--label must be 1–64 lowercase letters, numbers, hyphens, or underscores");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("--url must be an absolute HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--url must use HTTP or HTTPS");
  }

  if (afterClickReady !== null && !actions.some((action) => action.kind === "click"))
    throw new Error("--after-click-ready requires --click");
  if (scrollTo === null && scrollOffset !== 320)
    throw new Error("--scroll-offset requires --scroll-to");
  return {
    kind: "capture",
    options: {
      url,
      label,
      ready,
      actions,
      afterClickReady,
      fullPage,
      storageState,
      activePath,
      scrollTo,
      scrollOffset,
      scrollXToEnd,
      selectText,
      selectRange,
      fakeMicrophone,
      mediaReady,
      revealList,
    },
  };
}

async function capture(options: CaptureOptions): Promise<void> {
  const directory = resolve("qa/screenshots", options.label);
  await mkdir(directory);
  const captureUrl = new URL(options.url);
  if (options.activePath !== null) {
    captureUrl.pathname = "/";
    captureUrl.search = "";
    captureUrl.searchParams.set("section", "changes");
    captureUrl.searchParams.set("project", options.activePath);
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: options.fakeMicrophone
      ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
      : [],
  });
  const results: Array<{
    name: string;
    file: string;
    viewport: { width: number; height: number };
    documentWidth: number;
    clientWidth: number;
    horizontalOverflow: boolean;
  }> = [];

  try {
    for (const view of views) {
      const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        isMobile: view.isMobile,
        hasTouch: view.hasTouch,
        deviceScaleFactor: 1,
        ...(options.storageState === null ? {} : { storageState: options.storageState }),
      });
      try {
        const page = await context.newPage();
        const response = await page.goto(captureUrl.href, {
          waitUntil: "load",
          timeout: 15_000,
        });
        if (response === null || !response.ok()) {
          throw new Error(
            `${view.name}: page load returned ${response?.status() ?? "no response"}`,
          );
        }
        if (options.revealList && view.width > 600 && view.width < 900) {
          const back = page.getByRole("button", { name: "Open list" });
          await back.waitFor({ state: "visible", timeout: 15_000 });
          await back.click();
        }
        if (options.ready !== null) {
          await page.locator(options.ready).first().waitFor({ state: "visible", timeout: 15_000 });
        }
        for (const action of options.actions) {
          if (action.kind === "click") await page.locator(action.selector).click();
          else await page.locator(action.selector).fill(action.value);
        }
        if (options.afterClickReady !== null) {
          await page
            .locator(options.afterClickReady)
            .first()
            .waitFor({ state: "visible", timeout: 15_000 });
        }
        if (options.mediaReady) {
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll<HTMLMediaElement>("audio, video")].every(
                (element) => element.readyState >= 1 || element.error !== null,
              ),
            null,
            { timeout: 15_000 },
          );
        }
        if (options.scrollTo !== null) {
          await page.locator(options.scrollTo).evaluate((element, offset) => {
            element.scrollIntoView({ block: "start", behavior: "instant" });
            window.scrollBy(0, offset);
          }, options.scrollOffset);
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          );
        }
        if (options.scrollXToEnd !== null) {
          await page.locator(options.scrollXToEnd).evaluate((element) => {
            if (!(element instanceof HTMLElement))
              throw new Error("Horizontal scroll target must be an element");
            element.scrollLeft = element.scrollWidth;
          });
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          );
        }
        if (options.selectText !== null) {
          await selectCodeText(
            page.locator(options.selectText.selector).first(),
            options.selectText.text,
          );
          await page
            .locator(".code-selection-action")
            .waitFor({ state: "visible", timeout: 5_000 });
        }
        if (options.selectRange !== null) {
          const range = options.selectRange;
          await selectCodeRange(
            page.locator(range.first).first(),
            range.start,
            page.locator(range.last).first(),
            range.end,
          );
          await page
            .locator(".code-selection-action")
            .waitFor({ state: "visible", timeout: 5_000 });
        }
        await page.evaluate(async () => document.fonts.ready);

        const widths = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const file = `${view.name}.png`;
        await page.screenshot({
          path: resolve(directory, file),
          fullPage: options.fullPage,
          animations: "disabled",
        });

        const horizontalOverflow = widths.documentWidth > widths.clientWidth + 2;
        results.push({
          name: view.name,
          file,
          viewport: { width: view.width, height: view.height },
          documentWidth: widths.documentWidth,
          clientWidth: widths.clientWidth,
          horizontalOverflow,
        });
        console.log(
          `${view.name}: ${resolve(directory, file)}${horizontalOverflow ? " (page overflow)" : ""}`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(
    resolve(directory, "manifest.json"),
    `${JSON.stringify(
      {
        url: captureUrl.href,
        capturedAt: new Date().toISOString(),
        fullPage: options.fullPage,
        views: results,
      },
      null,
      2,
    )}\n`,
  );

  if (results.some((result) => result.horizontalOverflow)) {
    throw new Error("Page-wide horizontal overflow detected; inspect the screenshots");
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === "help") {
    console.log(usage);
    return;
  }
  await capture(parsed.options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
