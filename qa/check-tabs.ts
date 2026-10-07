import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { appUrl, withQaBrowser, withQaContext } from "./browser-support.ts";
import { parseActiveProject } from "../src/client/storage.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-tabs.ts <local app URL>");
const url = appUrl(rawUrl);
const startUrl = new URL("/", url).href;
const rootPath = resolve("qa/.artifacts");
await mkdir(resolve(rootPath, "other-project"), { recursive: true });

async function selectFolder(page: Page, folder: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(folder) }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await page.locator(".sidebar-project-title").getByText(folder, { exact: true }).waitFor();
}

await withQaBrowser(async (browser) => {
  await withQaContext(browser, {}, async (context) => {
    context.setDefaultTimeout(10_000);
    const first = await context.newPage();
    await first.goto(url.href);
    await selectFolder(first, "inventory-fixture");

    const second = await context.newPage();
    await second.goto(url.href);
    await second.locator(".welcome h1").waitFor();
    await selectFolder(second, "other-project");

    await first.reload();
    await first
      .locator(".sidebar-project-title")
      .getByText("inventory-fixture", { exact: true })
      .waitFor();
    await second.reload();
    await second
      .locator(".sidebar-project-title")
      .getByText("other-project", { exact: true })
      .waitFor();
    await first.goto(startUrl);
    await first
      .locator(".sidebar-project-title")
      .getByText("inventory-fixture", { exact: true })
      .waitFor();
    await second.goto(startUrl);
    await second
      .locator(".sidebar-project-title")
      .getByText("other-project", { exact: true })
      .waitFor();
    if (
      new URL(first.url()).searchParams.get("project") !== "inventory-fixture" ||
      new URL(second.url()).searchParams.get("project") !== "other-project"
    )
      throw new Error("Bare / did not restore each tab's own project route");
    const state = await first.evaluate(() => ({
      shared: localStorage.getItem("git-review:workspace:v4"),
      first: sessionStorage.getItem("git-review:active-project:v2"),
    }));
    const secondActive = await second.evaluate(() =>
      sessionStorage.getItem("git-review:active-project:v2"),
    );
    if (
      state.shared === null ||
      state.shared.includes("activePath") ||
      !state.shared.includes("other-project") ||
      state.first === null ||
      !state.first.includes("inventory-fixture") ||
      secondActive === null ||
      !secondActive.includes("other-project")
    ) {
      throw new Error(
        `Projects are not independent by tab: ${JSON.stringify({ ...state, secondActive })}`,
      );
    }

    await first.evaluate(
      (approvedRoot) =>
        sessionStorage.setItem(
          "git-review:active-project:v2",
          JSON.stringify({ version: 2, rootPath: approvedRoot, activePath: "other-project" }),
        ),
      rootPath,
    );
    await first.goto(new URL("/?section=changes&project=inventory-fixture", url).href);
    await first
      .locator(".sidebar-project-title")
      .getByText("inventory-fixture", { exact: true })
      .waitFor();
    const selected: unknown = await first.evaluate(
      () => JSON.parse(sessionStorage.getItem("git-review:active-project:v2") ?? "null") as unknown,
    );
    if (
      new URL(first.url()).searchParams.get("project") !== "inventory-fixture" ||
      parseActiveProject(selected, rootPath) !== "inventory-fixture"
    )
      throw new Error("An explicit project link did not win over the conflicting tab selection");
    if (
      (await second.evaluate(() => sessionStorage.getItem("git-review:active-project:v2"))) !==
      secondActive
    )
      throw new Error("The explicit link changed another tab's selection");

    await withQaContext(browser, { serviceWorkers: "block" }, async (startup) => {
      startup.setDefaultTimeout(10_000);
      let releaseRoot = () => {};
      const rootGate = new Promise<void>((resolve) => {
        releaseRoot = resolve;
      });
      try {
        const pending = await startup.newPage();
        await pending.addInitScript(
          (approvedRoot) =>
            sessionStorage.setItem(
              "git-review:active-project:v2",
              JSON.stringify({
                version: 2,
                rootPath: approvedRoot,
                activePath: "inventory-fixture",
              }),
            ),
          rootPath,
        );
        let opens = 0;
        pending.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/project") opens += 1;
        });
        await pending.route("**/api/roots", async (route) => {
          await rootGate;
          await route.continue();
        });
        const requested = pending.waitForRequest(
          (request) => new URL(request.url()).pathname === "/api/roots",
        );
        await pending.goto(startUrl, { waitUntil: "load" });
        await requested;
        await pending.evaluate(() => {
          history.pushState(null, "", "/?section=settings");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await pending.locator("#app-theme").waitFor({ state: "visible" });
        releaseRoot();
        await pending
          .locator(".root-copy span")
          .filter({ hasText: rootPath })
          .waitFor({ state: "attached" });
        if (new URL(pending.url()).searchParams.get("section") !== "settings" || opens !== 0)
          throw new Error("Root completion replaced explicit Settings with the stored project");
        await pending.locator("#app-theme").waitFor({ state: "visible" });
      } finally {
        releaseRoot();
      }
    });

    for (const invalidPath of ["../escape", "/absolute", "safe//child", "safe/"]) {
      await withQaContext(browser, { serviceWorkers: "block" }, async (invalid) => {
        invalid.setDefaultTimeout(10_000);
        const page = await invalid.newPage();
        await page.addInitScript(
          ({ rootPath, invalidPath }) => {
            localStorage.setItem(
              "git-review:workspace:v4",
              JSON.stringify({ version: 4, rootPath, recentPaths: [invalidPath] }),
            );
            sessionStorage.setItem(
              "git-review:active-project:v2",
              JSON.stringify({ version: 2, rootPath, activePath: invalidPath }),
            );
          },
          { rootPath, invalidPath },
        );
        let lookups = 0;
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/project") lookups += 1;
        });
        await page.goto(startUrl);
        await page.locator(".folder-row", { hasText: "inventory-fixture" }).waitFor();
        await page.locator(".welcome h1").waitFor();
        if (page.url() !== new URL("/?section=projects", url).href || lookups !== 0)
          throw new Error("Invalid saved paths restored a route or attempted to open a project");
      });
    }

    await withQaContext(browser, {}, async (context) => {
      context.setDefaultTimeout(10_000);
      const page = await context.newPage();
      await context.addInitScript((approvedRoot) => {
        if (sessionStorage.getItem("qa:seeded") !== null) return;
        sessionStorage.setItem("qa:seeded", "true");
        localStorage.setItem(
          "git-review:workspace:v3",
          JSON.stringify({
            version: 3,
            rootPath: approvedRoot,
            recentPaths: ["inventory-fixture"],
          }),
        );
        sessionStorage.setItem(
          "git-review:active-project:v1",
          JSON.stringify({
            version: 1,
            rootPath: approvedRoot,
            activePath: "inventory-fixture",
          }),
        );
        localStorage.setItem("git-review:comments:v1:obsolete", "old review data");
        localStorage.setItem("unrelated", "keep");
      }, rootPath);
      await page.goto(startUrl);
      await page.locator(".welcome h1").waitFor();
      const state = await page.evaluate(() => ({
        oldWorkspace: localStorage.getItem("git-review:workspace:v3"),
        oldComments: localStorage.getItem("git-review:comments:v1:obsolete"),
        oldSession: sessionStorage.getItem("git-review:active-project:v1"),
        unrelated: localStorage.getItem("unrelated"),
      }));
      if (
        state.oldWorkspace !== null ||
        state.oldComments !== null ||
        state.oldSession !== null ||
        state.unrelated !== "keep"
      )
        throw new Error("Obsolete project data was not discarded with a scoped reset");
      await page.reload();
      await page.locator(".welcome h1").waitFor();
    });
  });
  console.log(
    "Independent project tabs, reload and bare / restoration, explicit-link priority, delayed root completion, shared recents, invalid-path recovery, and scoped obsolete-data reset passed.",
  );
});
