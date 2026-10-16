import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Locator } from "playwright-core";
import { testGit as git } from "./test-support.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const value = process.argv[2];
if (value === undefined)
  throw new Error("Usage: bun qa/check-card-collapse.ts <QA app URL rooted at qa/.artifacts>");
const base = appUrl(value);
const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "card-collapse-"));
const folder = basename(project);
const captures = resolve(artifacts, "screenshots", folder);
await mkdir(captures, { recursive: true });

async function writeSource(version: number): Promise<void> {
  for (const path of ["01-normal.ts", "02-review.ts", "03-following.ts"])
    await writeFile(
      resolve(project, path),
      Array.from(
        { length: path === "01-normal.ts" ? 1 : 180 },
        (_, index) => `export const item${index} = ${index + version};\n`,
      ).join(""),
    );
}

async function settle(card: Locator): Promise<void> {
  await card
    .page()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
}

async function assertCollapsedInView(card: Locator): Promise<void> {
  await card.locator('.diff-card-toggle[aria-expanded="false"]').waitFor();
  await settle(card);
  const geometry = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topbar = document.querySelector(".topbar");
    const section = element.closest(".diff-section")?.querySelector(".diff-section-heading");
    const obscured = Math.max(
      topbar?.getBoundingClientRect().bottom ?? 0,
      section?.getBoundingClientRect().bottom ?? 0,
    );
    const desiredTop = parseFloat(getComputedStyle(element).scrollMarginTop);
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    return {
      top: rect.top,
      bottom: rect.bottom,
      obscured,
      desiredTop,
      atEnd,
      viewport: innerHeight,
    };
  });
  if (
    geometry.top < geometry.obscured - 2 ||
    geometry.bottom > geometry.viewport + 2 ||
    (!geometry.atEnd && Math.abs(geometry.top - geometry.desiredTop) > 2)
  )
    throw new Error(`Collapsed sticky card lost its reading position: ${JSON.stringify(geometry)}`);
}

try {
  git(project, "init", "-q");
  await writeSource(0);
  git(project, "add", ".");
  git(project, "commit", "-qm", "Collapse fixture baseline");
  await writeSource(1);
  git(project, "add", ".");
  git(project, "commit", "-qm", "Collapse fixture changes");
  const oid = git(project, "rev-parse", "HEAD").toString().trim();
  await writeSource(2);
  await withQaBrowser(async (browser) => {
    for (const [name, profile] of Object.entries(qaProfiles)) {
      for (const destination of [
        {
          section: "changes",
          route: `/?section=changes&project=${folder}`,
        },
        {
          section: "git",
          route: `/?section=git&project=${folder}&commit=${oid}`,
        },
      ]) {
        await withQaContext(browser, profile, async (context) => {
          const page = await context.newPage();
          await page.goto(new URL(destination.route, base).href);
          await page.locator("main .diff-card").first().waitFor();
          const expand = page.getByRole("button", { name: "Expand all", exact: true });
          if (await expand.isEnabled()) await expand.click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll("main .diff-card")].every(
              (card) => card.getAttribute("data-diff-state") === "ready",
            ),
          );
          const tall = page.locator('main .diff-card[data-path="02-review.ts"]');
          const toggle = tall.locator(".diff-card-toggle");
          await toggle.waitFor();
          if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
          await tall.locator(".diff-row").first().waitFor();

          // A normal heading must not jump to the top when its card is collapsed.
          const normal = page.locator("main .diff-card").first();
          const normalToggle = normal.locator(".diff-card-toggle");
          if ((await normalToggle.getAttribute("aria-expanded")) === "false")
            await normalToggle.click();
          await normal.locator(".diff-card-body").waitFor();
          await normal.evaluate((card) =>
            card.scrollIntoView({ block: "center", behavior: "instant" }),
          );
          await settle(normal);
          const beforeNormal = await page.evaluate(() => window.scrollY);
          await normalToggle.click();
          await settle(normal);
          if (Math.abs((await page.evaluate(() => window.scrollY)) - beforeNormal) > 2)
            throw new Error("Collapsing a normal card unexpectedly scrolled the page");

          for (const keyboard of [false, true]) {
            if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
            await tall.locator(".diff-row").first().waitFor();
            await toggle.focus();
            const pinned = await tall.evaluate((card) => {
              window.scrollTo({
                top: window.scrollY + card.getBoundingClientRect().top + 360,
                behavior: "instant",
              });
              const heading = card.querySelector(".diff-card-heading");
              return {
                cardTop: card.getBoundingClientRect().top,
                headingTop: heading?.getBoundingClientRect().top ?? 0,
              };
            });
            if (pinned.cardTop >= 0 || pinned.headingTop < 0)
              throw new Error(
                `Expected an offscreen card with a visible sticky heading: ${JSON.stringify(pinned)}`,
              );
            const route = page.url();
            if (keyboard) await toggle.press("Enter");
            else await toggle.click();
            await assertCollapsedInView(tall);
            if (page.url() !== route) throw new Error("Collapsing a card changed the route");
          }
          await assertNoHorizontalOverflow(page);
          await page.screenshot({ path: resolve(captures, `${name}-${destination.section}.png`) });
        });
        console.log(
          `${name} ${destination.section}: sticky pointer/keyboard collapse stays visible; normal collapse preserves scroll.`,
        );
      }
    }
  });
  await writeFile(
    resolve(captures, "manifest.json"),
    JSON.stringify({ url: base.href, fixture: folder, profiles: qaProfiles }, null, 2) + "\n",
  );
  console.log(`Collapse screenshots: ${captures}`);
} finally {
  await rm(project, { recursive: true, force: true });
}
