import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";
import { parseRootResponse } from "@git-review/shared/api";
import { projectApiUrl } from "@git-review/shared/project-path";
import { responseBody } from "../apps/web/src/api.ts";

/** Selection lookup is only fixture discovery; resource requests need no registration. */
export async function projectLookupResponse(
  origin: string,
  relativePath: string,
): Promise<Response> {
  const root = parseRootResponse(await responseBody(await fetch(`${origin}/api/roots`)));
  const absolutePath =
    relativePath === "" ? root.path : `${root.path === "/" ? "" : root.path}/${relativePath}`;
  return await fetch(origin + projectApiUrl("", absolutePath));
}

export const qaDimensions = {
  phone: { width: 390, height: 844 },
  tabletPortrait: { width: 820, height: 1180 },
  tabletLandscape: { width: 1180, height: 820 },
  desktop: { width: 1440, height: 900 },
};

export const qaProfiles = {
  phone: {
    viewport: qaDimensions.phone,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  tabletPortrait: { viewport: qaDimensions.tabletPortrait, hasTouch: true },
  tabletLandscape: { viewport: qaDimensions.tabletLandscape, hasTouch: true },
  desktop: { viewport: qaDimensions.desktop },
} satisfies Record<string, BrowserContextOptions>;

export function appUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Expected an HTTP(S) app URL");
  return url;
}

export async function withQaBrowser<T>(check: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    return await check(browser);
  } finally {
    await browser.close();
  }
}

export async function withQaContext<T>(
  browser: Browser,
  options: BrowserContextOptions,
  check: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(options);
  const errors: Array<{ url: string; message: string }> = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push({ url: page.url(), message: error.message }));
  });
  try {
    const result = await check(context);
    if (errors.length > 0)
      throw new Error(
        `Page errors: ${errors.map(({ url, message }) => `${url}: ${message}`).join("; ")}`,
      );
    return result;
  } finally {
    await context.close();
  }
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  if (size.document > size.viewport + 2)
    throw new Error(`Page-wide horizontal overflow: ${JSON.stringify(size)}`);
}
