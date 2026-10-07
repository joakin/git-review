import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Locator, Page } from "playwright-core";
import { testGit as git } from "../src/test-support.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-code-containment.ts <fixture app URL>");
const base = appUrl(rawUrl);
const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "code-containment-"));
const folder = basename(project);
const source = (changed: boolean, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const text = index % 7 === 0 || index === count - 1 ? "wide content ".repeat(35) : "short";
    return `export const item${index} = { value: ${changed ? index + 1 : index}, label: "${text}" };`;
  }).join("\n") + "\n";

function destination(section: "changes" | "files", file?: string): string {
  const url = new URL(base);
  url.search = new URLSearchParams({ section, project: folder }).toString();
  if (file !== undefined) url.searchParams.set("file", file);
  return url.href;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
  });
}

async function top(row: Locator): Promise<number> {
  return await row.evaluate((element) => element.getBoundingClientRect().top);
}

async function assertRendered(row: Locator): Promise<void> {
  if (
    !(await row.evaluate((element) =>
      element.querySelector("code")?.checkVisibility({ contentVisibilityAuto: true }),
    ))
  )
    throw new Error(
      "Target row stayed skipped after navigation/focus: " +
        JSON.stringify(
          await row.evaluate((element) => ({
            row: element.getBoundingClientRect().toJSON(),
            block: element.parentElement?.getBoundingClientRect().toJSON(),
            scroll: window.scrollY,
            viewport: window.innerHeight,
            style: element.parentElement?.getAttribute("style"),
          })),
        ),
    );
  const text = await row.locator("code").textContent();
  if (text === null || !text.includes("export const"))
    throw new Error("Missing target source text");
}

async function prepareReference(page: Page, reference: Page, wrap = true): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("Missing emulated viewport");
  await reference.setViewportSize(viewport);
  if (reference.url() !== page.url()) {
    await reference.goto(page.url());
    if (new URL(page.url()).searchParams.get("section") === "changes") {
      await reference.locator(".diff-card").last().waitFor({ state: "attached" });
      const expand = reference.getByRole("button", { name: "Expand all", exact: true });
      if (await expand.isEnabled()) await expand.click();
      await reference.waitForFunction(
        () => document.querySelectorAll('.diff-card[data-diff-state="ready"]').length === 3,
      );
    } else await reference.locator(".file-code-row").last().waitFor({ state: "attached" });
  }
  const fontSize = await page
    .locator(".app")
    .evaluate((app) => getComputedStyle(app).getPropertyValue("--code-font-size"));
  await reference
    .locator(".app")
    .evaluate((app, size) => app.style.setProperty("--code-font-size", size), fontSize);
  const desired = wrap ? "Wrap: off" : "Wrap: on";
  const toggle = reference.getByRole("button", { name: desired, exact: true });
  if (await toggle.count()) await toggle.click();
}

async function compareVisibleHeight(page: Page, row: Locator, reference: Page): Promise<void> {
  await assertRendered(row);
  const actual = await row.evaluate((element) => element.getBoundingClientRect().height);
  await prepareReference(page, reference);
  const target =
    new URL(page.url()).searchParams.get("section") === "changes"
      ? reference.locator('.diff-card[data-path="large.ts"] .diff-row-added').last()
      : reference.locator('.file-code-row[data-line="1000"]');
  const expected = await target.evaluate((element) => element.getBoundingClientRect().height);
  if (Math.abs(actual - expected) > 0.1)
    throw new Error(`Contained target height differs from full layout: ${actual} vs ${expected}`);
}

function disableContainment(): void {
  const supports = CSS.supports.bind(CSS);
  CSS.supports = (property: string, value?: string) =>
    property === "content-visibility"
      ? false
      : value === undefined
        ? supports(property)
        : supports(property, value);
}

try {
  git(project, "init", "-q");
  for (const [name, count] of [
    ["a.ts", 40],
    ["large.ts", 1_000],
    ["z.ts", 40],
  ] as const)
    await writeFile(resolve(project, name), source(false, count));
  git(project, "add", ".");
  git(project, "commit", "-qm", "Containment fixture");
  for (const [name, count] of [
    ["a.ts", 40],
    ["large.ts", 1_000],
    ["z.ts", 40],
  ] as const)
    await writeFile(resolve(project, name), source(true, count));

  await withQaBrowser(async (browser) => {
    for (const [name, profile] of Object.entries(qaProfiles)) {
      await withQaContext(browser, profile, async (context) => {
        const page = await context.newPage();
        const reference = await context.newPage();
        await reference.addInitScript(disableContainment);
        page.setDefaultTimeout(30_000);
        await page.goto(destination("changes"));
        await page.getByRole("button", { name: "Expand all", exact: true }).click();
        await page.waitForFunction(
          () => document.querySelectorAll('.diff-card[data-diff-state="ready"]').length === 3,
        );
        await settle(page);
        const pane = page.locator('.diff-card[data-path="large.ts"] .diff-scroll');
        const last = pane.locator(".diff-row-added").last();
        if (
          await last.evaluate((row) =>
            row.querySelector("code")?.checkVisibility({ contentVisibilityAuto: true }),
          )
        )
          throw new Error("Long diff did not defer off-screen rows");
        if ((await pane.locator(".diff-row").count()) !== 2_000)
          throw new Error("Containment removed source rows from the DOM");
        await last.locator("..").scrollIntoViewIfNeeded();
        await settle(page);
        await last.scrollIntoViewIfNeeded();
        await settle(page);
        await assertRendered(last);
        await compareVisibleHeight(page, last, reference);
        const before = await top(last);
        await page.evaluate(() => {
          const files = [
            ...document.querySelectorAll<HTMLButtonElement>(".sidebar-project-tabs button"),
          ].find((button) => button.textContent?.trim() === "Files");
          if (files === undefined) throw new Error("Missing Files destination");
          files.click();
        });
        await page.waitForURL((url) => url.searchParams.get("section") === "files");
        await page.goBack();
        await page.waitForFunction(
          () => document.querySelectorAll('.diff-card[data-diff-state="ready"]').length === 3,
        );
        await settle(page);
        const after = await top(last);
        if (Math.abs(after - before) > 2)
          throw new Error(`Cached Back changed the reading position: ${before} vs ${after}`);
        await assertRendered(last);

        // A different layout must discard sizes remembered for the previous width and font.
        await page.setViewportSize({ width: name === "phone" ? 820 : 390, height: 844 });
        await settle(page);
        await last.scrollIntoViewIfNeeded();
        await settle(page);
        await compareVisibleHeight(page, last, reference);
        await page
          .locator(".app")
          .evaluate((app) => app.style.setProperty("--code-font-size", "20px"));
        await settle(page);
        await last.scrollIntoViewIfNeeded();
        await settle(page);
        await compareVisibleHeight(page, last, reference);
        await page.getByRole("button", { name: "Wrap: on", exact: true }).click();
        await settle(page);
        await pane.scrollIntoViewIfNeeded();
        await settle(page);
        const width = await pane.evaluate((element) => element.scrollWidth);
        await prepareReference(page, reference, false);
        const referenceWidth = await reference
          .locator('.diff-card[data-path="large.ts"] .diff-scroll')
          .evaluate((element) => element.scrollWidth);
        if (Math.abs(width - referenceWidth) > 1 || width < 2_000)
          throw new Error(`Unwrapped horizontal extent changed: ${width} vs ${referenceWidth}`);
        await assertNoHorizontalOverflow(page);
        await page.getByRole("button", { name: "Wrap: off", exact: true }).click();
        const farCard = page.locator('.diff-card[data-path="z.ts"]');
        await farCard.scrollIntoViewIfNeeded();
        await settle(page);
        await assertRendered(farCard.locator(".diff-row").first());

        await page.goto(destination("files", "large.ts") + "&line=1000");
        const fileLast = page.locator('.file-code-row[data-line="1000"]');
        await fileLast.waitFor({ state: "attached" });
        await settle(page);
        await assertRendered(fileLast);
        await compareVisibleHeight(page, fileLast, reference);
        if ((await top(fileLast)) < 0 || (await top(fileLast)) > 844)
          throw new Error("Direct file-line navigation did not bring the target into view");
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await settle(page);
        await fileLast.locator("button").focus();
        await settle(page);
        await assertRendered(fileLast);
        await assertNoHorizontalOverflow(page);
        console.log(
          `${name}: skipped rows, complete DOM, deep Back, rotation, font size, wrapping, horizontal extent, card jump, file-line navigation and far-line focus passed`,
        );
      });
    }
    await withQaContext(browser, qaProfiles.phone, async (context) => {
      await context.addInitScript(disableContainment);
      const page = await context.newPage();
      await page.goto(destination("files", "large.ts"));
      await page.locator(".file-code-row").last().waitFor({ state: "attached" });
      if ((await page.locator("[data-code-contained]").count()) !== 0)
        throw new Error("Unsupported browser did not use ordinary rendering");
      await page.locator(".file-code-row").last().scrollIntoViewIfNeeded();
      await assertRendered(page.locator(".file-code-row").last());
      console.log("Unsupported CSS: ordinary rendering passed");
    });
  });
} finally {
  await rm(project, { recursive: true, force: true });
}
