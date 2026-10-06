import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";
import {
  parseActiveProject,
  validateSavedWorkspace,
  workspaceStorageKey,
} from "../src/client/storage.ts";

declare global {
  interface Window {
    projectOpeningQa: Array<{
      aborted: boolean;
      ready: boolean;
      completed: boolean;
      release: () => void;
    }>;
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function pickerReady(page: Page, pickerUrl: string): Promise<void> {
  await page.waitForURL(pickerUrl);
  await page
    .getByRole("button", { name: /Open this folder/ })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForFunction(
    () => {
      const button = document.querySelector(".open-button");
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    null,
    { timeout: 5_000 },
  );
  assert(
    (await page.locator(".folder-name-row strong").textContent()) === "inventory-fixture",
    "Back changed the picker directory",
  );
}

async function selectedStorage(page: Page): Promise<string> {
  return page.evaluate(
    (key) =>
      JSON.stringify({
        workspace: localStorage.getItem(key),
        active: sessionStorage.getItem("git-review:active-project:v2"),
      }),
    workspaceStorageKey,
  );
}

async function settle(page: Page, index: number): Promise<void> {
  await page.evaluate((index) => {
    const request = window.projectOpeningQa[index];
    if (request === undefined) throw new Error("Missing held project request");
    request.release();
  }, index);
  await page.waitForFunction((index) => window.projectOpeningQa[index]?.completed === true, index);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

export async function checkProjectOpeningCancellation(browser: Browser, base: URL): Promise<void> {
  const pickerUrl = new URL("/?section=projects&dir=inventory-fixture", base).href;
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width <= 600,
      hasTouch: viewport.width < 1200,
      serviceWorkers: "block",
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let opens = 0;
      await page.route("**/api/project?*", async (route) => {
        opens += 1;
        if (opens === 1) await gate;
        await route.continue();
      });
      await page.goto(pickerUrl);
      await pickerReady(page, pickerUrl);
      const opening = page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/project",
      );
      await page.locator(".open-button").click();
      const abandoned = await opening;
      const canceled = page.waitForEvent("requestfailed", {
        predicate: (request) => request === abandoned,
      });
      await page.goBack();
      await pickerReady(page, pickerUrl);
      release();
      await canceled;
      await page.locator(".open-button").click();
      await page
        .locator(".sidebar-project-title")
        .getByText("inventory-fixture")
        .waitFor({ state: "attached" });
      if (viewport.width <= 600)
        await page
          .getByRole("button", { name: "Review all changes", exact: true })
          .waitFor({ state: "visible" });
      else await page.locator("main .diff-card").first().waitFor();
      assert(opens === 2, `Cancel/retry sent ${opens} requests instead of two`);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
        ),
        "Cancel/retry widened the page",
      );
      assert(errors.length === 0, errors.join("; "));
      console.log(`Project-open cancellation and same-folder retry passed at ${viewport.width}px.`);
    } finally {
      release();
      await context.close();
    }
  }

  for (const { outcome, releaseAt } of [
    { outcome: "success", releaseAt: "popstate" },
    { outcome: "success", releaseAt: "pending" },
    { outcome: "success", releaseAt: "ready" },
    { outcome: "error", releaseAt: "pending" },
    { outcome: "error", releaseAt: "ready" },
  ] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    try {
      // Model a transport that completes despite cancellation, so these checks
      // exercise stale-result guards rather than relying on native fetch abort.
      await context.addInitScript((outcome) => {
        window.projectOpeningQa = [];
        const originalFetch = window.fetch.bind(window);
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = input instanceof Request ? input.url : input.toString();
            if (new URL(url, window.location.origin).pathname !== "/api/project")
              return originalFetch(input, init);
            let release = () => {};
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const request = { aborted: false, ready: false, completed: false, release };
            window.projectOpeningQa.push(request);
            const signal = init?.signal;
            signal?.addEventListener(
              "abort",
              () => {
                request.aborted = true;
              },
              { once: true },
            );
            const response = await originalFetch(input, { ...init, signal: null });
            await response.clone().arrayBuffer();
            request.ready = true;
            await gate;
            request.completed = true;
            if (outcome === "error" && window.projectOpeningQa[0] === request)
              throw new Error("Abandoned project-open failure");
            return response;
          },
        });
      }, outcome);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pickerUrl);
      await pickerReady(page, pickerUrl);
      const beforeStorage = await selectedStorage(page);
      await page.locator(".open-button").click();
      await page.waitForFunction(() => window.projectOpeningQa[0]?.ready === true);
      if (releaseAt === "popstate") {
        await page.evaluate(() =>
          window.addEventListener("popstate", () => window.projectOpeningQa[0]?.release(), {
            once: true,
          }),
        );
      }
      await page.goBack();
      await pickerReady(page, pickerUrl);
      await page.waitForFunction(() => window.projectOpeningQa[0]?.aborted === true);
      if (releaseAt === "popstate") {
        await settle(page, 0);
        assert(
          (await selectedStorage(page)) === beforeStorage,
          "Completion during Back acquired abandoned project ownership",
        );
      }
      const replacement = outcome === "success" ? "other-project" : "inventory-fixture";
      if (replacement !== "inventory-fixture") {
        await page.getByRole("button", { name: "Go to parent folder" }).click();
        await page.locator(".folder-row", { hasText: replacement }).click();
        await page.getByRole("button", { name: /Open this folder/ }).waitFor();
      }
      await page.locator(".open-button").click();
      await page.waitForFunction(() => window.projectOpeningQa.length === 2);
      const replacementUrl = page.url();
      if (releaseAt === "pending") {
        await settle(page, 0);
        assert(page.url() === replacementUrl, "Abandoned completion changed the replacement route");
        assert(
          (await selectedStorage(page)) === beforeStorage,
          "Abandoned completion acquired persisted project ownership",
        );
        assert(
          (await page.locator(".sidebar-project-title").count()) === 0,
          "Abandoned completion replaced the pending project",
        );
        assert(
          (await page.locator("main [role=alert], .sidebar [role=alert]").count()) === 0,
          "Abandoned failure appeared on the replacement route",
        );
      }
      await settle(page, 1);
      await page
        .locator(".sidebar-project-title")
        .getByText(replacement)
        .waitFor({ state: "attached" });
      await page
        .getByRole("button", { name: "Review all changes", exact: true })
        .waitFor({ state: "visible" });
      assert(page.url() === replacementUrl, "Replacement completion changed its route");
      const replacementStorage = await selectedStorage(page);
      assert(
        replacementStorage !== beforeStorage,
        "Completed replacement did not save its selection",
      );
      if (releaseAt === "ready") {
        await settle(page, 0);
        assert(
          page.url() === replacementUrl,
          "Abandoned completion changed the opened project's route",
        );
        assert(
          (await selectedStorage(page)) === replacementStorage,
          "Abandoned completion changed the opened project's persistence",
        );
        assert(
          (await page.locator(".sidebar-project-title").textContent()) === replacement,
          "Abandoned completion replaced the opened project",
        );
      }
      assert(errors.length === 0, errors.join("; "));
      console.log(
        `Canceled ${outcome} released at ${releaseAt} preserves ${replacement} and its persisted ownership.`,
      );
    } finally {
      await context.close();
    }
  }

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(10_000);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL("/?section=changes&project=other-project", base).href);
    await page
      .getByRole("button", { name: "Feedback 0", exact: true })
      .waitFor({ state: "visible" });
    const beforeStorage = await selectedStorage(page);
    assert(
      beforeStorage.includes("other-project"),
      "The initial project was not accepted and persisted",
    );
    let opens = 0;
    await page.route("**/api/project?*", async (route) => {
      opens += 1;
      if (opens === 1)
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "invalid_request", message: "Controlled project-open failure" },
          }),
        });
      else await route.continue();
    });
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("button", { name: "Choose a project", exact: true }).click();
    await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
    await pickerReady(page, pickerUrl);
    await page.locator(".open-button").click();
    await page
      .locator(".sidebar [role=alert]")
      .filter({ hasText: "Controlled project-open failure" })
      .waitFor();
    assert(
      (await selectedStorage(page)) === beforeStorage,
      "Failed opening replaced the last accepted tab selection or recents",
    );
    await page.getByRole("button", { name: "Choose another project" }).click();
    await page.locator(".folder-row", { hasText: "inventory-fixture" }).click();
    await pickerReady(page, pickerUrl);
    await page.locator(".open-button").click();
    await page
      .getByRole("button", { name: "Review all changes", exact: true })
      .waitFor({ state: "visible" });
    assert(opens === 2, "Failure recovery did not send exactly one retry");
    const recovered = await page.evaluate(
      (key) => ({
        active: JSON.parse(
          sessionStorage.getItem("git-review:active-project:v2") ?? "null",
        ) as unknown,
        workspace: JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
      }),
      workspaceStorageKey,
    );
    const approvedRoot = resolve("qa/.artifacts");
    const workspace = validateSavedWorkspace(recovered.workspace, approvedRoot);
    assert(
      parseActiveProject(recovered.active, approvedRoot) === "inventory-fixture" &&
        workspace?.recentPaths[0] === "inventory-fixture" &&
        workspace.recentPaths.includes("other-project"),
      "Successful recovery did not select inventory-fixture and retain the prior recent project",
    );
    assert(errors.length === 0, errors.join("; "));
    console.log(
      "Non-aborted project-open failure preserves the accepted tab selection and recents; explicit recovery/retry passed.",
    );
  } finally {
    await context.close();
  }
}
