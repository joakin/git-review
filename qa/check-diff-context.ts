import type { Page } from "playwright-core";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";
import { routeUrl } from "../apps/web/src/navigation.ts";
import { selectCodeText } from "./select-code-text.ts";

const rawUrl = process.argv[2];
const folder = process.argv[3];
if (rawUrl === undefined || folder === undefined)
  throw new Error("Usage: bun qa/check-diff-context.ts <fixture URL> <fixture folder>");
const base = appUrl(rawUrl);
const url = new URL(
  routeUrl({
    section: "changes",
    projectPath: folder,
    target: { kind: "file", layer: "staged", path: "example.ts" },
  }),
  base,
);
async function waitRows(page: Page, count: number) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('main .diff-card[data-layer="staged"] .diff-row').length === count,
    count,
  );
}
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

await withQaBrowser(async (browser) => {
  for (const [name, profile] of Object.entries({
    ...qaProfiles,
    narrow: { viewport: { width: 320, height: 740 }, hasTouch: true },
  })) {
    await withQaContext(browser, profile, async (context) => {
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.goto(url.href);
      const card = page.locator('main .diff-card[data-layer="staged"][data-path="example.ts"]');
      await card.locator('.diff-context-gap[data-gap="1"]').waitFor();
      const initial = await card.locator(".diff-row").count();
      const gap = () => card.locator('.diff-context-gap[data-gap="1"]');
      const expand = async (direction: "above" | "below", expected: number) => {
        await gap()
          .getByRole("button", { name: `Show 20 lines ${direction}`, exact: true })
          .click();
        await waitRows(page, expected);
      };
      // Retry must repeat the failed edge, rather than silently expanding from the other end.
      await page.route("**/api/project/diff-context?*", async (route) => {
        await route.fulfill({ status: 503, json: { error: "Context read failed" } });
      });
      await gap().getByRole("button", { name: "Show 20 lines above", exact: true }).click();
      await page
        .locator(".notification")
        .getByRole("button", { name: "Retry", exact: true })
        .waitFor();
      await page.unroute("**/api/project/diff-context?*");
      await page
        .locator(".notification")
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await waitRows(page, initial + 20);
      await card.locator('.diff-row[data-new-line="109"]').waitFor();
      assert(
        (await card.locator('.diff-row[data-new-line="60"]').count()) === 0,
        `${name}: Retry changed direction`,
      );
      await expand("below", initial + 40);
      const numbers = await card
        .locator(".diff-row")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-new-line")).filter((line) => line !== null),
        );
      assert(
        new Set(numbers).size === numbers.length,
        `${name}: duplicate lines after mixed expansion`,
      );
      await card.locator(".diff-card-toggle").click();
      await card.locator(".diff-card-toggle").click();
      await waitRows(page, initial + 40);

      // Rehighlight, expand again, and reopen: completed replay must not erase later chunks.
      await page.route("**/api/project/diff-context?*", async (route) => {
        await route.fulfill({ status: 503, json: { error: "Context read failed" } });
      });
      await card.getByLabel("Language").selectOption("text");
      await waitRows(page, initial + 40);
      await page
        .locator(".notification")
        .getByRole("button", { name: "Retry", exact: true })
        .waitFor();
      assert(
        (await gap().locator(".diff-context-button").first().getAttribute("aria-disabled")) ===
          "true",
        `${name}: expansion allowed during failed language replay`,
      );
      await page.unroute("**/api/project/diff-context?*");
      await page
        .locator(".notification")
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await page.getByText("Updating context highlighting…").waitFor({ state: "hidden" });
      await expand("below", initial + 60);
      await card.locator(".diff-card-toggle").click();
      await card.locator(".diff-card-toggle").click();
      await waitRows(page, initial + 60);

      // A normal pending expansion can be canceled without leaving reopening stuck in loading.
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/project/diff-context?*", async (route) => {
        await gate;
        await route.fulfill({ json: { kind: "stale" } }).catch(() => {});
      });
      await gap()
        .getByRole("button", { name: /lines above/ })
        .click();
      await gap().getByText("Loading context…").waitFor();
      await card.locator(".diff-card-toggle").click();
      release();
      await page.unroute("**/api/project/diff-context?*");
      await card.locator(".diff-card-toggle").click();
      await waitRows(page, initial + 60);
      await page.waitForFunction(
        () =>
          document
            .querySelector('.diff-card[data-layer="staged"] .diff-context-button')
            ?.getAttribute("aria-disabled") === "false",
      );
      assert(
        (await page.getByRole("button", { name: /New edits/ }).count()) === 0,
        `${name}: canceled stale response affected current review`,
      );

      // Exhausting the gap must retain a visible source row and move focus off the removed control.
      await gap().scrollIntoViewIfNeeded();
      const anchor = await card.locator(".diff-row").evaluateAll((rows) => {
        const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
        const row = rows.find(
          (row) =>
            row.getBoundingClientRect().bottom > top &&
            row.getBoundingClientRect().top < window.innerHeight,
        );
        return row === undefined
          ? null
          : { line: row.getAttribute("data-new-line"), top: row.getBoundingClientRect().top };
      });
      assert(anchor !== null && anchor.line !== null, `${name}: no visible row for position check`);
      await gap()
        .getByRole("button", { name: /lines above/ })
        .click();
      await gap().waitFor({ state: "detached" });
      const position = await card
        .locator(`.diff-row[data-new-line="${anchor.line}"]`)
        .boundingBox();
      assert(
        position !== null && Math.abs(position.y - anchor.top) < 3,
        `${name}: expansion moved the reading position`,
      );
      assert(
        await page.evaluate(() => document.activeElement?.closest(".diff-row") !== null),
        `${name}: exhausted separator lost keyboard focus`,
      );
      const allNumbers = await card
        .locator(".diff-row")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-new-line")).filter((line) => line !== null),
        );
      assert(
        new Set(allNumbers).size === allNumbers.length,
        `${name}: exhaustion duplicated lines`,
      );

      // Save on newly revealed code through the touch row action, then check again after reload.
      const revealed = card.locator('.diff-row[data-new-line="60"]');
      await revealed.scrollIntoViewIfNeeded();
      await revealed.locator(".diff-mobile-line-trigger").evaluate((element) => {
        if (element instanceof HTMLElement) element.click();
      });
      await card.getByRole("button", { name: /Comment on new line 60/ }).click();
      await page
        .getByPlaceholder("Add a question, note, or suggestion…")
        .fill("Context feedback stays current.");
      await page.getByRole("button", { name: "Save comment", exact: true }).click();
      await selectCodeText(revealed.locator(".diff-code"), "export const");
      await page
        .getByRole("button", { name: "Comment on selected text: export const", exact: true })
        .click();
      await page
        .getByPlaceholder("Add a question, note, or suggestion…")
        .fill("Revealed selection stays current.");
      await page.getByRole("button", { name: "Save comment", exact: true }).click();
      await page.reload();
      await card.locator(".diff-row").first().waitFor();
      await waitRows(page, initial);
      await page
        .getByRole("button", { name: /Feedback/ })
        .last()
        .click();
      await page.getByLabel("Copyable feedback text").waitFor();
      assert(
        (await page.getByLabel("Copyable feedback text").inputValue()).includes(
          "Context feedback stays current.",
        ),
        `${name}: revealed comment was lost during fresh checking`,
      );
      assert(
        (await page.getByLabel("Copyable feedback text").inputValue()).includes(
          "Revealed selection stays current.",
        ),
        `${name}: revealed selection was lost during fresh checking`,
      );
      await page.getByRole("button", { name: "Close feedback", exact: true }).click();

      // Buttons stay on screen during unwrapped code scrolling, including narrow phones.
      await page.getByRole("button", { name: "Wrap: on", exact: true }).click();
      await card.locator(".diff-scroll").evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await gap().scrollIntoViewIfNeeded();
      const rect = await gap().locator(".diff-context-buttons").boundingBox();
      assert(
        rect !== null && rect.x >= 0 && rect.x + rect.width <= (profile.viewport?.width ?? 1440),
        `${name}: context icons scrolled out of view`,
      );
      await assertNoHorizontalOverflow(page);
      console.log(
        `${name}: mixed expansion, retries, language replay, canceled stale response, exhaustion/focus/position, revealed feedback after reload, and scrolling passed`,
      );
    });
  }
});
