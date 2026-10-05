import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright-core";
import { expectRecord } from "../src/shared/validation.ts";
import { expectGitOid } from "../src/shared/git.ts";

type Outcome = "held" | "error" | "stale";
declare global {
  interface Window {
    diffLoadingQa: {
      next: Outcome | null;
      requests: number;
      statuses: number;
      held: { ready: boolean; release: () => void }[];
    };
  }
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let remaining = 6;
        const next = () => {
          remaining -= 1;
          if (remaining === 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
}

export async function checkDiffLoading(browser: Browser, base: URL): Promise<void> {
  const fixture = expectRecord(
    JSON.parse(await readFile("qa/.artifacts/history-fixture-info.json", "utf8")) as unknown,
    "history fixture",
  );
  const oid = expectGitOid(fixture["updated"]);
  for (const domain of ["working", "historical"] as const) {
    const path = domain === "working" ? "src/math.c" : "src/review.ts";
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await context.addInitScript((path) => {
        window.diffLoadingQa = { next: "held", requests: 0, statuses: 0, held: [] };
        const original = window.fetch.bind(window);
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
              location.href,
            );
            if (url.pathname.endsWith("/status")) window.diffLoadingQa.statuses += 1;
            if (!url.pathname.endsWith("/diff") || url.searchParams.get("path") !== path)
              return original(input, init);
            window.diffLoadingQa.requests += 1;
            const outcome = window.diffLoadingQa.next;
            window.diffLoadingQa.next = null;
            if (outcome === "error")
              return new Response(
                JSON.stringify({ error: { code: "internal_error", message: "Diff retry QA" } }),
                { status: 503, headers: { "Content-Type": "application/json" } },
              );
            if (outcome === "stale")
              return new Response(JSON.stringify({ kind: "stale" }), {
                headers: { "Content-Type": "application/json" },
              });
            if (outcome !== "held") return original(input, init);
            let release = () => {};
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const held = { ready: false, release };
            window.diffLoadingQa.held.push(held);
            // A fully buffered response deliberately ignores abort to test ownership.
            const response = await original(input, { ...init, signal: null });
            await response.clone().arrayBuffer();
            held.ready = true;
            await gate;
            return response;
          },
        });
      }, path);
      await page.goto(
        new URL(
          domain === "working"
            ? "/?section=changes&project=inventory-fixture"
            : `/?section=git&project=history-fixture&commit=${oid}`,
          base,
        ).href,
      );
      const card = page.locator(`main .diff-card[data-path="${path}"]`);
      const toggle = card.locator(".diff-card-toggle");
      if (domain === "working") await toggle.click();
      await page.waitForFunction(() => window.diffLoadingQa.held[0]?.ready === true);
      await card.getByText("Loading diff…", { exact: true }).waitFor({ state: "visible" });
      await toggle.click();
      await page.evaluate(() => window.diffLoadingQa.held[0]?.release());
      await settle(page);
      if ((await card.getAttribute("data-diff-state")) !== "collapsed")
        throw new Error(`${domain}: abandoned response reopened the card`);
      const collapsedRequests = await page.evaluate(() => window.diffLoadingQa.requests);
      await toggle.click();
      await card.locator(".diff-code").first().waitFor({ state: "visible" });
      if ((await page.evaluate(() => window.diffLoadingQa.requests)) !== collapsedRequests + 1)
        throw new Error(`${domain}: collapsed response entered the cache`);

      const picker = card.getByLabel("Language");
      await page.evaluate(() => {
        window.diffLoadingQa.next = "held";
      });
      await picker.selectOption("text");
      await page.waitForFunction(() => window.diffLoadingQa.held[1]?.ready === true);
      await picker.selectOption("cpp");
      await card.locator(".diff-language-row > span").getByText("cpp", { exact: true }).waitFor();
      await page.evaluate(() => window.diffLoadingQa.held[1]?.release());
      await settle(page);
      if ((await card.locator(".diff-language-row > span").innerText()) !== "cpp")
        throw new Error(`${domain}: superseded language replaced the current payload`);
      const supersededRequests = await page.evaluate(() => window.diffLoadingQa.requests);
      await picker.selectOption("text");
      await card
        .locator(".diff-language-row > span")
        .getByText("Plain text", { exact: true })
        .waitFor();
      if ((await page.evaluate(() => window.diffLoadingQa.requests)) !== supersededRequests + 1)
        throw new Error(`${domain}: superseded language response entered the cache`);

      await page.evaluate(() => {
        window.diffLoadingQa.next = "error";
      });
      await picker.selectOption("javascript");
      await card.getByRole("alert").filter({ hasText: "Diff retry QA" }).waitFor();
      await card.getByRole("button", { name: "Retry", exact: true }).click();
      await card.locator(".diff-code").first().waitFor({ state: "visible" });
      if ((await picker.inputValue()) !== "javascript")
        throw new Error(`${domain}: retry reset the language preference`);

      if (domain === "working") {
        const statuses = await page.evaluate(() => {
          window.diffLoadingQa.next = "stale";
          return window.diffLoadingQa.statuses;
        });
        await picker.selectOption("python");
        await page.waitForFunction(
          (statuses) => window.diffLoadingQa.statuses > statuses,
          statuses,
        );
        await card
          .locator(".diff-language-row > span")
          .getByText("python", { exact: true })
          .waitFor();
      }
      const saved = await picker.inputValue();
      await page.reload();
      await page.waitForFunction(() => window.diffLoadingQa.held[0]?.ready === true);
      await page.evaluate(() => window.diffLoadingQa.held[0]?.release());
      await card.locator(".diff-code").first().waitFor({ state: "visible" });
      if ((await picker.inputValue()) !== saved)
        throw new Error(`${domain}: reload lost the language preference`);
      if (errors.length > 0) throw new Error(errors.join("; "));
      console.log(
        `${domain} diff collapse, buffered late responses, language supersession, cache exclusion, retry and override reload passed.`,
      );
    } finally {
      await page
        .evaluate(() => window.diffLoadingQa.held.forEach((held) => held.release()))
        .catch(() => {});
      await context.close();
    }
  }
}
