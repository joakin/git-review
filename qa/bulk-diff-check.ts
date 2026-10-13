import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright-core";
import { expectGitOid } from "@git-review/shared/git";
import { expectRecord } from "@git-review/shared/validation";
import { assertNoHorizontalOverflow, qaProfiles, withQaContext } from "./browser-support.ts";

declare global {
  interface Window {
    bulkDiffQa: {
      requests: string[];
      held: { ready: boolean; aborted: boolean; release: () => void } | null;
    };
  }
}

async function waitForCards(page: Page, expanded: boolean): Promise<void> {
  await page
    .waitForFunction((expanded) => {
      const cards = [...document.querySelectorAll("main .diff-card")];
      return (
        cards.length > 0 &&
        cards.every(
          (card) => card.getAttribute("data-diff-state") === (expanded ? "ready" : "collapsed"),
        )
      );
    }, expanded)
    .catch(async (error: unknown) => {
      const cards = await page.locator("main .diff-card").evaluateAll((elements) =>
        elements.map((element) => ({
          path: element.getAttribute("data-path"),
          state: element.getAttribute("data-diff-state"),
          message: element.querySelector(".diff-message")?.textContent,
        })),
      );
      throw new Error(
        `Expected all cards ${expanded ? "ready" : "collapsed"} at ${page.url()}: ${JSON.stringify(cards)}`,
        { cause: error },
      );
    });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 6;
        const next = () => {
          if (--frames === 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
}

export async function checkBulkDiffControls(browser: Browser, base: URL): Promise<void> {
  const info = expectRecord(
    JSON.parse(await readFile("qa/.artifacts/history-fixture-info.json", "utf8")) as unknown,
    "history fixture",
  );
  const oid = expectGitOid(info["updated"]);
  const destinations = [
    { domain: "Changes", url: new URL("/?section=changes&project=inventory-fixture", base).href },
    {
      domain: "Git",
      url: new URL(`/?section=git&project=history-fixture&commit=${oid}`, base).href,
    },
  ];
  for (const profile of [
    ...Object.values(qaProfiles),
    { ...qaProfiles.phone, viewport: { width: 320, height: 740 } },
  ]) {
    for (const destination of destinations) {
      await withQaContext(browser, profile, async (context) => {
        const page = await context.newPage();
        let reads = 0;
        let inventories = 0;
        page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (/\/diffs?$/.test(path)) reads += 1;
          if (path.endsWith("/status") || /\/git\/commits\/[a-f0-9]+$/.test(path)) inventories += 1;
        });
        await page.goto(destination.url);
        const cards = page.locator("main .diff-card");
        const expand = page.getByRole("button", { name: "Expand all", exact: true });
        const collapse = page.getByRole("button", { name: "Collapse all", exact: true });
        await cards.first().waitFor();
        if (destination.domain === "Git") await waitForCards(page, true);
        if (await collapse.isEnabled()) await collapse.click();
        await waitForCards(page, false);
        if ((await collapse.isEnabled()) || !(await expand.isEnabled()))
          throw new Error("Incorrect all-collapsed actions");
        await cards.first().locator(".diff-card-toggle").click();
        await cards.first().locator(".diff-card-body").waitFor();
        if (!(await collapse.isEnabled()) || !(await expand.isEnabled()))
          throw new Error("Mixed expansion lost an action");
        const url = page.url();
        const inventoryReads = inventories;
        await expand.click();
        await waitForCards(page, true);
        if ((await expand.isEnabled()) || !(await collapse.isEnabled()))
          throw new Error("Incorrect all-expanded actions");
        if (destination.domain === "Changes") {
          const staged = page.locator(
            'main .diff-card[data-layer="staged"][data-path="src/view.ts"][data-diff-state="ready"]',
          );
          if (
            (await staged.count()) !== 1 ||
            (await page
              .locator(
                'main .diff-card[data-layer="unstaged"][data-path="src/view.ts"][data-diff-state="ready"]',
              )
              .count()) !== 1
          )
            throw new Error("Bulk expansion lost same-path layers");
        }
        const loadedReads = reads;
        await collapse.click();
        await waitForCards(page, false);
        await expand.click();
        await waitForCards(page, true);
        await settle(page);
        if (reads !== loadedReads) throw new Error("Bulk re-expansion fetched cached cards");
        if (inventories !== inventoryReads || page.url() !== url)
          throw new Error("Bulk action refreshed or navigated the review");
        await assertNoHorizontalOverflow(page);
        for (const control of [expand, collapse]) {
          const box = await control.boundingBox();
          if (box === null || box.height < 44 || box.width < 44)
            throw new Error("Bulk action lost its touch target");
        }
        if (destination.domain === "Changes") {
          await page.reload();
          await waitForCards(page, true);
          await collapse.click();
          await waitForCards(page, false);
          await page.waitForFunction(() => {
            return window.reviewDataQa.cardsRecords().every(([, raw]) => {
              const value: unknown = JSON.parse(raw);
              return (
                typeof value === "object" &&
                value !== null &&
                "keys" in value &&
                Array.isArray(value.keys) &&
                value.keys.length === 0
              );
            });
          });
          await page.reload();
          await waitForCards(page, false);
          // A selected URL stays selected even after explicitly closing its card.
          await page.goto(
            new URL(
              "/?section=changes&project=inventory-fixture&layer=staged&file=src/view.ts",
              base,
            ).href,
          );
          await page
            .locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"] .diff-code')
            .first()
            .waitFor();
          const selectedUrl = page.url();
          await collapse.click();
          await waitForCards(page, false);
          await expand.click();
          await waitForCards(page, true);
          await settle(page);
          if (page.url() !== selectedUrl)
            throw new Error("Bulk action changed the selected file URL");
        } else {
          await collapse.click();
          await waitForCards(page, false);
          if (profile.viewport.width < 900)
            await page.getByRole("button", { name: "Open list", exact: true }).click();
          if (profile.viewport.width === 1440) {
            await page.locator(".git-commit-row", { hasText: "History checkpoint 52" }).click();
            await page.getByText("No file changes in this project scope.").waitFor();
            if ((await expand.isEnabled()) || (await collapse.isEnabled()))
              throw new Error("Empty commit enabled a bulk action");
            await page.goBack();
            await waitForCards(page, false);
          }
          await page
            .getByRole("navigation", { name: "Project views" })
            .getByRole("button", { name: "Files", exact: true })
            .click();
          await page.waitForURL((url) => url.searchParams.get("section") === "files");
          await page.goBack();
          const selected = page.locator(".git-commit-row", {
            hasText: "Improve reading and preserve historical context",
          });
          if (
            (profile.viewport.width > 600 && profile.viewport.width < 900) ||
            !(await selected.isVisible())
          )
            await page.getByRole("button", { name: "Open list", exact: true }).click();
          await selected.click();
          await waitForCards(page, false);
          await expand.click();
          await waitForCards(page, true);
          if (reads !== loadedReads)
            throw new Error("Returning to a commit lost cached bulk choices");
        }
      });
      console.log(
        `${destination.domain} bulk actions, individual toggles, disabled states, URL/cache/persistence and containment passed at ${profile.viewport.width}px.`,
      );
    }
  }

  for (const destination of destinations) {
    await withQaContext(browser, qaProfiles.desktop, async (context) => {
      await context.addInitScript(() => {
        window.bulkDiffQa = { requests: [], held: null };
        const original = window.fetch.bind(window);
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
              location.href,
            );
            if (!url.pathname.endsWith("/diffs") || typeof init?.body !== "string")
              return original(input, init);
            window.bulkDiffQa.requests.push(init.body);
            if (window.bulkDiffQa.requests.length !== 1) return original(input, init);
            let release = () => {};
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const held = { ready: false, aborted: false, release };
            window.bulkDiffQa.held = held;
            init.signal?.addEventListener(
              "abort",
              () => {
                held.aborted = true;
              },
              { once: true },
            );
            // Buffered late delivery must be harmless even if transport ignores abort.
            const response = await original(input, { ...init, signal: null });
            await response.clone().arrayBuffer();
            held.ready = true;
            await gate;
            return response;
          },
        });
      });
      const page = await context.newPage();
      try {
        await page.goto(destination.url);
        if (destination.domain === "Changes")
          await page.getByRole("button", { name: "Expand all", exact: true }).click();
        await page.waitForFunction(() => window.bulkDiffQa.held?.ready === true);
        const cardCount = await page.locator("main .diff-card").count();
        await page.getByRole("button", { name: "Collapse all", exact: true }).click();
        await waitForCards(page, false);
        await page.waitForFunction(() => window.bulkDiffQa.held?.aborted === true);
        await page.evaluate(() => window.bulkDiffQa.held?.release());
        await settle(page);
        if ((await page.evaluate(() => window.bulkDiffQa.requests.length)) !== 1)
          throw new Error("Bulk collapse left queued demand running");
        await waitForCards(page, false);
        await page.getByRole("button", { name: "Expand all", exact: true }).click();
        await waitForCards(page, true);
        const requests = await page.evaluate(() => window.bulkDiffQa.requests.slice(1));
        const delivered = requests.reduce((count, body) => {
          const request = expectRecord(JSON.parse(body) as unknown, "batch request");
          if (!Array.isArray(request["files"])) throw new Error("Invalid observed batch");
          return count + request["files"].length;
        }, 0);
        if (delivered !== cardCount) throw new Error("Abandoned bulk results entered the cache");
      } finally {
        await page.evaluate(() => window.bulkDiffQa.held?.release()).catch(() => {});
      }
    });
    console.log(
      `${destination.domain} bulk collapse aborts the active batch, drops queued demand and excludes late results from cards/cache.`,
    );
  }
}
