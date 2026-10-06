import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStatusResponse } from "../src/shared/api.ts";
import type { Locator } from "playwright-core";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-change-stats.ts <local app URL>");
const base = appUrl(rawUrl);
const fixture = resolve("qa/.artifacts/line-counts-fixture/src/view.ts");
const original = await Bun.file(fixture).text();

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkInlineTotals(heading: Locator, name: string) {
  const position = await heading.evaluate((element) => {
    const totals = element.querySelector(".change-group-stats")?.getBoundingClientRect();
    const files = element.querySelector(".change-count")?.getBoundingClientRect();
    if (totals === undefined || files === undefined) throw new Error("Missing heading totals");
    return {
      gap: files.left - totals.right,
      aligned: Math.abs((totals.top + totals.bottom) / 2 - (files.top + files.bottom) / 2),
    };
  });
  assert(
    position.gap >= 7 && position.aligned <= 2,
    `${name}: section totals are not inline before file counts: ${JSON.stringify(position)}`,
  );
}

try {
  await withQaBrowser(async (browser) => {
    for (const [name, options] of Object.entries({
      ...qaProfiles,
      narrowPhone: { ...qaProfiles.phone, viewport: { width: 320, height: 844 } },
    })) {
      await withQaContext(browser, { ...options, serviceWorkers: "block" }, async (context) => {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const requests: string[] = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.includes("/api/projects/"))
            requests.push(request.url());
        });
        await page.goto(new URL("/?section=changes&project=line-counts-fixture", base).href);
        const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
        await card.waitFor({ state: "visible" });
        assert(
          (await card.locator(".line-added").innerText()) === "+3",
          `${name}: staged additions missing while collapsed`,
        );
        assert(
          (await card.locator(".line-deleted").innerText()) === "−1",
          `${name}: staged deletions missing`,
        );
        assert(
          requests.filter((url) => /\/diffs?$/.test(new URL(url).pathname)).length === 0,
          `${name}: collapsed counts loaded patches`,
        );
        assert(
          requests.filter(
            (url) => new URL(url).pathname.endsWith("/status") && new URL(url).search === "",
          ).length === 1,
          `${name}: metadata/counts used multiple initial requests`,
        );
        assert(
          !requests.some((url) => url.includes("change-stats")),
          `${name}: separate statistics request`,
        );
        const staged = page.locator(
          "main .diff-section-staged .diff-section-heading .change-group-stats",
        );
        assert(
          (await staged.locator(".line-added").innerText()) === "+3",
          `${name}: staged total mismatch`,
        );
        assert(
          (await staged.locator(".line-deleted").innerText()) === "−3",
          `${name}: staged deletion total mismatch`,
        );
        const untracked = page.locator("main .diff-section-untracked .diff-section-heading");
        assert(
          (await untracked.innerText()).includes("Known"),
          `${name}: partial total lacks known label`,
        );
        assert(
          (await untracked.innerText()).includes("1 binary") &&
            (await untracked.innerText()).includes("1 unavailable"),
          `${name}: excluded entries missing from summary`,
        );
        assert(
          (await page
            .locator('main .diff-card[data-path="binary.dat"] .change-stats-state')
            .innerText()) === "Binary",
          `${name}: binary counted as text`,
        );
        assert(
          (await page
            .locator('main .diff-card[data-path="large.txt"] .change-stats-state')
            .innerText()) === "Stats unavailable",
          `${name}: read limit hidden`,
        );
        await assertNoHorizontalOverflow(page);
        await checkInlineTotals(page.locator("main .diff-section-staged h3"), name);
        const sectionStyle = await page
          .locator("main .diff-section-staged .diff-section-heading")
          .evaluate((element) => ({
            radius: getComputedStyle(element).borderRadius,
            shadow: getComputedStyle(element).boxShadow,
          }));
        assert(
          sectionStyle.radius === "0px" && sectionStyle.shadow === "none",
          `${name}: section heading is not flat: ${JSON.stringify(sectionStyle)}`,
        );
        assert(
          (await page.locator("main .diff-card-layer").count()) === 0,
          `${name}: redundant working-copy layer pills remain`,
        );
        await card.locator(".diff-card-toggle").click();
        await card.locator(".diff-row-added").first().waitFor({ state: "visible" });
        assert(
          (await card.locator(".line-added").innerText()) === "+3",
          `${name}: count changed on expansion`,
        );
        if ((options.viewport?.width ?? 0) < 900)
          await page.getByRole("button", { name: "Open list", exact: true }).click();
        const row = page.getByRole("button", {
          name: "Open staged diff for src/view.ts",
          exact: true,
        });
        await row.waitFor({ state: "visible" });
        assert(
          (await row.locator(".line-added").innerText()) === "+3" &&
            (await row.locator(".line-deleted").innerText()) === "−1",
          `${name}: sidebar differs from content`,
        );
        const sidebarTotals = page.locator(".change-group-staged h2 .change-group-stats");
        assert(
          (await sidebarTotals.locator(".line-deleted").innerText()) === "−3",
          `${name}: sidebar group differs from content`,
        );
        await assertNoHorizontalOverflow(page);
        await checkInlineTotals(page.locator(".change-group-staged h2"), name);
        await row.click();
        await card.waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const card = document.querySelector(
            'main .diff-card[data-layer="staged"][data-path="src/view.ts"]',
          );
          const heading = card?.closest(".diff-section")?.querySelector(".diff-section-heading");
          if (!card || !heading) return false;
          const gap = card.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
          return gap >= 0 && gap <= 48;
        });
        const before = await page
          .locator('main .diff-card[data-layer="unstaged"][data-path="src/view.ts"] .line-added')
          .innerText();
        if (name === "phone") {
          await writeFile(fixture, original + "export const another = 4;\n");
          const checked = page.waitForResponse(
            (response) => new URL(response.url()).searchParams.get("mode") === "check",
          );
          await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
          const body: unknown = await (await checked).json();
          assert(
            typeof body === "object" && body !== null && !("entries" in body),
            "Polling returned the full review payload",
          );
          await page.locator(".changes-update").waitFor({ state: "visible" });
          assert(
            (await page
              .locator(
                'main .diff-card[data-layer="unstaged"][data-path="src/view.ts"] .line-added',
              )
              .innerText()) === before,
            "Polling replaced displayed counts",
          );
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname.endsWith("/status") &&
              new URL(response.url()).search === "",
          );
          await page.locator(".changes-update").click();
          const snapshot = parseStatusResponse(await (await refreshed).json());
          assert(snapshot.kind === "git", "Update lost the Git inventory");
          await page.waitForFunction(
            () =>
              document.querySelector(
                'main .diff-card[data-layer="unstaged"][data-path="src/view.ts"] .line-added',
              )?.textContent === "+3",
          );
          assert(
            (await card.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
            "Update collapsed an open card",
          );
          await writeFile(fixture, original);
          // Restoring the fixture changes its metadata token too. Accept that snapshot
          // before opening another card under the stricter diff source checks.
          const restored = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname.endsWith("/status") &&
              new URL(response.url()).search === "",
          );
          await page.getByRole("button", { name: "Refresh", exact: true }).click();
          await restored;
          await card.locator(".diff-row-added").first().waitFor({ state: "visible" });
        }
        if (name === "narrowPhone") {
          await page.route(
            (url) => url.pathname.endsWith("/status") && url.search === "",
            async (route) => {
              const response = await route.fetch();
              const snapshot = parseStatusResponse(await response.json());
              assert(snapshot.kind === "git", "Large-count layout lost its inventory");
              const entries = snapshot.entries.map((entry) =>
                entry.layer === "staged" && entry.path === "src/view.ts"
                  ? { ...entry, stats: { kind: "text", added: 1_000_000, deleted: 1_234_567 } }
                  : entry,
              );
              await route.fulfill({ response, json: { ...snapshot, entries } });
            },
          );
          await page.getByRole("button", { name: "Refresh", exact: true }).click();
          const largeAdded = await page.evaluate(
            () => `+${new Intl.NumberFormat().format(1_000_000)}`,
          );
          await card.locator(".line-added").filter({ hasText: largeAdded }).waitFor();
          await assertNoHorizontalOverflow(page);
          await page.getByRole("button", { name: "Open list", exact: true }).click();
          assert(
            (await row.locator(".line-added").innerText()) === largeAdded,
            "Large counts did not use shared localized formatting",
          );
          await assertNoHorizontalOverflow(page);
          await row.click();
        }
        const tall = page.locator(
          'main .diff-card[data-layer="untracked"][data-path="src/new feature.ts"]',
        );
        if ((options.viewport?.width ?? 0) < 900)
          await page.getByRole("button", { name: "Open list", exact: true }).click();
        await page
          .getByRole("button", { name: "Open untracked diff for src/new feature.ts", exact: true })
          .click();
        await tall.locator(".diff-row").first().waitFor({ state: "visible" });
        await tall.evaluate((element) =>
          window.scrollTo({
            top: window.scrollY + element.getBoundingClientRect().top + 240,
            behavior: "instant",
          }),
        );
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
        const sticky = await tall.evaluate((element) => {
          const section = element.closest(".diff-section");
          const heading = section?.querySelector(".diff-section-heading");
          const card = element.querySelector(".diff-card-toggle");
          const topbar = document.querySelector(".topbar");
          if (!heading || !card || !topbar) throw new Error("Missing sticky headings");
          const rect = heading.getBoundingClientRect();
          return {
            sectionTop: rect.top,
            sectionBottom: rect.bottom,
            cardTop: card.getBoundingClientRect().top,
            topbarBottom: topbar.getBoundingClientRect().bottom,
          };
        });
        assert(
          Math.abs(sticky.sectionTop - sticky.topbarBottom) <= 2 &&
            Math.abs(sticky.cardTop - sticky.sectionBottom) <= 2,
          `${name}: section/card headings overlap or do not stick: ${JSON.stringify(sticky)}`,
        );
        await page.waitForFunction(() => {
          const heading = document.querySelector(
            'main .diff-card[data-path="src/new feature.ts"] .diff-card-toggle',
          );
          return heading !== null && getComputedStyle(heading).borderRadius === "0px";
        });
        const beforeJump = page.url();
        const diffReads = requests.filter((url) => /\/diffs?$/.test(new URL(url).pathname)).length;
        const jump = page.getByRole("button", {
          name: "Go to start of untracked changes",
          exact: true,
        });
        if (name === "desktop") {
          await jump.focus();
          await jump.press("Enter");
        } else await jump.click();
        const afterJump = await page
          .locator("main .diff-section-untracked")
          .evaluate((element) => ({
            top: element.getBoundingClientRect().top,
            barBottom: document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0,
          }));
        assert(
          Math.abs(afterJump.top - afterJump.barBottom) <= 2,
          `${name}: section heading did not return to its section start`,
        );
        await page.waitForFunction(() => {
          const heading = document.querySelector(
            'main .diff-card[data-path="src/new feature.ts"] .diff-card-toggle',
          );
          return (
            heading !== null && Number.parseFloat(getComputedStyle(heading).borderTopLeftRadius) > 0
          );
        });
        assert(
          page.url() === beforeJump &&
            requests.filter((url) => /\/diffs?$/.test(new URL(url).pathname)).length ===
              diffReads &&
            (await tall.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
          `${name}: section jump changed navigation, expansion or data`,
        );
        await page
          .getByRole("button", { name: "Go to start of unstaged changes", exact: true })
          .evaluate((element) => {
            if (!(element instanceof HTMLElement)) throw new Error("Missing section control");
            element.click();
          });
        const activeHeading = await page.evaluate(() => {
          const bar = document.querySelector(".topbar")?.getBoundingClientRect();
          const heading = document
            .querySelector("main .diff-section-unstaged .diff-section-heading")
            ?.getBoundingClientRect();
          if (!bar || !heading) throw new Error("Missing unstaged section");
          return document
            .elementFromPoint(heading.left + 16, bar.bottom + 12)
            ?.closest(".diff-section")
            ?.classList.contains("diff-section-unstaged");
        });
        assert(activeHeading === true, `${name}: section heading did not hand off to unstaged`);
        await assertNoHorizontalOverflow(page);
        console.log(
          `${name}: bundled counts, collapsed/expanded headings, sidebar totals, partial states and containment pass.`,
        );
      });
    }
  });
} finally {
  await writeFile(fixture, original);
}
