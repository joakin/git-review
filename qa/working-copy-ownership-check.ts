import type { Browser, BrowserContext, Page } from "playwright-core";

type HeldOutcome = "real" | "not_git" | "error";
type HeldRead = { ready: boolean; settled: boolean; release: () => void };

declare global {
  interface Window {
    workingCopyOwnershipQa: {
      next: HeldOutcome | null;
      held: HeldRead[];
      nextDiff: boolean;
      diffs: HeldRead[];
    };
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createContext(browser: Browser, first: HeldOutcome | null): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 600 },
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(10_000);
  try {
    await context.addInitScript((first) => {
      window.workingCopyOwnershipQa = { next: first, held: [], nextDiff: false, diffs: [] };
      const originalFetch = window.fetch.bind(window);
      // Complete fully buffered responses despite abort, exercising ownership
      // checks even in the window before effect cleanup cancels the old read.
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = new URL(
            input instanceof Request ? input.url : input.toString(),
            location.href,
          );
          const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
          const includesTall =
            typeof body === "object" &&
            body !== null &&
            "files" in body &&
            Array.isArray(body.files) &&
            body.files.some(
              (file: unknown) =>
                typeof file === "object" &&
                file !== null &&
                "path" in file &&
                file.path === "src/tall-review.ts",
            );
          const isDiff =
            window.workingCopyOwnershipQa.nextDiff &&
            /^\/api\/projects\/[^/]+\/diffs?$/u.test(url.pathname) &&
            (url.searchParams.get("path") === "src/tall-review.ts" || includesTall);
          const outcome = isDiff ? "real" : window.workingCopyOwnershipQa.next;
          if (
            !isDiff &&
            (!/^\/api\/projects\/[^/]+\/status$/u.test(url.pathname) || outcome === null)
          )
            return originalFetch(input, init);
          if (isDiff) window.workingCopyOwnershipQa.nextDiff = false;
          else window.workingCopyOwnershipQa.next = null;
          let release = () => {};
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const held = { ready: false, settled: false, release };
          (isDiff ? window.workingCopyOwnershipQa.diffs : window.workingCopyOwnershipQa.held).push(
            held,
          );
          const response = await originalFetch(input, { ...init, signal: null });
          await response.clone().arrayBuffer();
          held.ready = true;
          await gate;
          held.settled = true;
          if (outcome === "error") throw new Error("Abandoned working-copy status failure");
          return outcome === "real"
            ? response
            : new Response(JSON.stringify({ kind: "not_git" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
        },
      });
    }, first);
    return context;
  } catch (error: unknown) {
    await context.close();
    throw error;
  }
}

async function settleView(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        let remaining = 6;
        let frame = 0;
        const timer = window.setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error("View effects did not settle"));
        }, 2_000);
        const next = (): void => {
          remaining -= 1;
          if (remaining === 0) {
            window.clearTimeout(timer);
            resolve();
          } else frame = requestAnimationFrame(next);
        };
        frame = requestAnimationFrame(next);
      }),
  );
}

async function releaseStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held = window.workingCopyOwnershipQa.held[0];
    if (held === undefined) throw new Error("Missing held status response");
    held.release();
  });
  await page.waitForFunction(() => window.workingCopyOwnershipQa.held[0]?.settled === true);
  await settleView(page);
}

async function closeContext(context: BrowserContext, page: Page): Promise<void> {
  await page
    .evaluate(() =>
      [...window.workingCopyOwnershipQa.held, ...window.workingCopyOwnershipQa.diffs].forEach(
        (held) => held.release(),
      ),
    )
    .catch(() => {});
  await context.close();
}

async function openTallFile(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Project views" })
    .getByRole("button", { name: "Files", exact: true })
    .click();
  await page.locator('.file-tree-row[title="src"]').click();
  await page.locator('.file-tree-row[title="src/tall-review.ts"]').click();
  await page
    .locator('.file-panel[data-path="src/tall-review.ts"] .file-code-row')
    .first()
    .waitFor({ state: "visible" });
  await settleView(page);
}

export async function checkWorkingCopyOwnership(browser: Browser, base: URL): Promise<void> {
  const changesUrl = new URL("/?section=changes&project=inventory-fixture", base).href;
  const nonGit = await createContext(browser, "not_git");
  const first = await nonGit.newPage();
  const errors: string[] = [];
  first.on("pageerror", (error) => errors.push(error.message));
  try {
    await first.goto(changesUrl);
    await first.waitForFunction(() => window.workingCopyOwnershipQa.held[0]?.ready === true);
    await openTallFile(first);
    const selectedUrl = first.url();
    await releaseStatus(first);
    await first.waitForFunction(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('[aria-label="Project views"] button'),
      ].find((candidate) => candidate.textContent === "Changes");
      return button?.disabled === true;
    });
    assert(
      first.url() === selectedUrl,
      "A held non-Git status redirected the selected Files destination back to its list",
    );
    assert(
      await first
        .locator('.file-panel[data-path="src/tall-review.ts"] .file-code-row')
        .first()
        .isVisible(),
      "A held non-Git status discarded the selected file",
    );
    console.log("Held non-Git status preserves the latest selected Files destination.");
  } finally {
    await closeContext(nonGit, first);
  }

  for (const destination of ["Files", "Settings"] as const) {
    const context = await createContext(browser, null);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(changesUrl);
      const card = page.locator(
        'main .diff-card[data-layer="untracked"][data-path="src/tall-review.ts"]',
      );
      await card.locator(".diff-card-toggle").click();
      await card.locator(".diff-row").first().waitFor({ state: "visible" });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settleView(page);
      await card.evaluate((element) =>
        window.scrollTo({
          top: element.getBoundingClientRect().top + scrollY + 350,
          behavior: "instant",
        }),
      );
      assert(
        await card.evaluate((element) => element.getBoundingClientRect().top < -300),
        "Refresh did not start from a meaningful Changes reading position",
      );
      await page.evaluate(() => {
        window.workingCopyOwnershipQa.next = "real";
      });
      // Keep the reading position: Playwright's pointer click would scroll the
      // offscreen Refresh button into view before the app captures its position.
      await page
        .locator(".changes-actions")
        .getByRole("button", { name: "Refresh", exact: true })
        .evaluate((element) => {
          if (!(element instanceof HTMLButtonElement) || element.disabled)
            throw new Error("Refresh is not available");
          element.click();
        });
      await page.waitForFunction(() => window.workingCopyOwnershipQa.held[0]?.ready === true);
      if (destination === "Files") await openTallFile(page);
      else {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.locator("#app-theme").waitFor({ state: "visible" });
        await settleView(page);
      }
      await page.evaluate(() => window.scrollTo({ top: 250, behavior: "instant" }));
      const marker = page.locator(
        destination === "Files" ? '.file-panel[data-path="src/tall-review.ts"]' : ".settings-view",
      );
      const before = await marker.evaluate((element) => ({
        scroll: scrollY,
        top: element.getBoundingClientRect().top,
      }));
      assert(before.scroll > 40, `${destination} does not have a meaningful reading position`);
      const destinationUrl = page.url();
      await releaseStatus(page);
      const after = await marker.evaluate((element) => ({
        scroll: scrollY,
        top: element.getBoundingClientRect().top,
      }));
      assert(
        page.url() === destinationUrl,
        `A late Changes refresh replaced ${destination}'s route`,
      );
      assert(
        Math.abs(after.scroll - before.scroll) <= 2 && Math.abs(after.top - before.top) <= 2,
        `A late Changes refresh moved ${destination}'s reading position: ${JSON.stringify({ before, after })}`,
      );
      console.log(`Held Changes refresh preserves the latest ${destination} reading position.`);
    } finally {
      await closeContext(context, page);
    }
  }

  const waitingDiff = await createContext(browser, null);
  const settings = await waitingDiff.newPage();
  settings.on("pageerror", (error) => errors.push(error.message));
  try {
    await settings.goto(changesUrl);
    const card = settings.locator(
      'main .diff-card[data-layer="untracked"][data-path="src/tall-review.ts"]',
    );
    await card.locator(".diff-card-toggle").click();
    await card.locator(".diff-row").first().waitFor({ state: "visible" });
    await settings.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settleView(settings);
    await card.evaluate((element) =>
      window.scrollTo({
        top: element.getBoundingClientRect().top + scrollY + 350,
        behavior: "instant",
      }),
    );
    assert(
      await card.evaluate((element) => element.getBoundingClientRect().top < -300),
      "Renewed-diff check did not begin at a meaningful Changes reading position",
    );
    await settings.evaluate(() => {
      window.workingCopyOwnershipQa.nextDiff = true;
    });
    await settings
      .locator(".changes-actions")
      .getByRole("button", { name: "Refresh", exact: true })
      .evaluate((element) => {
        if (!(element instanceof HTMLButtonElement) || element.disabled)
          throw new Error("Refresh is not available");
        element.click();
      });
    await settings.waitForFunction(() => window.workingCopyOwnershipQa.diffs[0]?.ready === true);
    // The native status has been accepted, but restoration must still wait for
    // this renewed diff's body. Allow that waiting observer to become active.
    await settings
      .locator(".changes-actions")
      .getByRole("button", { name: "Refresh", exact: true })
      .waitFor({ state: "visible" });
    await settleView(settings);
    assert(
      (await card.getAttribute("data-diff-state")) === "loading",
      "The renewed tall diff was not held after status acceptance",
    );
    await settings.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.locator("#app-theme").waitFor({ state: "visible" });
    await settleView(settings);
    await settings.evaluate(() => window.scrollTo({ top: 250, behavior: "instant" }));
    const marker = settings.locator(".settings-view");
    const before = await marker.evaluate((element) => ({
      scroll: scrollY,
      top: element.getBoundingClientRect().top,
    }));
    assert(
      before.scroll > 40,
      "Settings has no meaningful reading position while the old diff is held",
    );
    const settingsUrl = settings.url();
    await settings.evaluate(() => window.workingCopyOwnershipQa.diffs[0]?.release());
    await settings.waitForFunction(() => window.workingCopyOwnershipQa.diffs[0]?.settled === true);
    // Settings retains hidden Changes cards. Require the real diff to render so
    // the assertion observes the mutation that could wake an abandoned observer.
    await settings.waitForFunction(
      () =>
        document
          .querySelector('main .diff-card[data-layer="untracked"][data-path="src/tall-review.ts"]')
          ?.getAttribute("data-diff-state") === "ready",
    );
    await settleView(settings);
    const after = await marker.evaluate((element) => ({
      scroll: scrollY,
      top: element.getBoundingClientRect().top,
    }));
    assert(settings.url() === settingsUrl, "A renewed Changes diff replaced the Settings route");
    assert(
      Math.abs(after.scroll - before.scroll) <= 2 && Math.abs(after.top - before.top) <= 2,
      `A renewed Changes diff moved Settings after navigation: ${JSON.stringify({ before, after })}`,
    );
    console.log(
      "Settings reading position survives a renewed diff completing after status acceptance and navigation.",
    );
  } finally {
    await closeContext(waitingDiff, settings);
  }

  for (const outcome of ["not_git", "error"] as const) {
    const context = await createContext(browser, outcome);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(changesUrl);
      await page.waitForFunction(() => window.workingCopyOwnershipQa.held[0]?.ready === true);
      const replacementUrl = new URL("/?section=files&project=other-project", base).href;
      // Dispatch real SPA navigation and release in one browser task, before
      // passive cleanup can abort the abandoned project's status controller.
      await page.evaluate((replacementUrl) => {
        history.pushState(null, "", replacementUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.workingCopyOwnershipQa.held[0]?.release();
      }, replacementUrl);
      await page.waitForFunction(() => window.workingCopyOwnershipQa.held[0]?.settled === true);
      await settleView(page);
      assert(
        page.url() === replacementUrl,
        `Abandoned ${outcome} status redirected back to its old project`,
      );
      await page
        .locator(".sidebar-project-title")
        .getByText("other-project", { exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByRole("heading", { name: "Browse files", exact: true })
        .waitFor({ state: "visible" });
      assert(
        (await page.locator("main [role=alert]").count()) === 0,
        `Abandoned ${outcome} status left an error on the replacement project`,
      );
      console.log(
        `Status ${outcome} completing during a project switch cannot acquire the replacement route or show an old error.`,
      );
    } finally {
      await closeContext(context, page);
    }
  }
  assert(errors.length === 0, errors.join("; "));
}
