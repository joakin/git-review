import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { parseActiveProject } from "../src/client/storage.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun run qa:tabs <local app URL>");
const url = new URL(rawUrl);
const startUrl = new URL("/", url).href;
const rootPath = resolve("qa/.artifacts");
await mkdir(resolve(rootPath, "other-project"), { recursive: true });

async function selectFolder(page: Page, folder: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(folder) }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await page.locator(".sidebar-project-title").getByText(folder, { exact: true }).waitFor();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  try {
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
      shared: localStorage.getItem("git-review:workspace:v3"),
      first: sessionStorage.getItem("git-review:active-project:v1"),
    }));
    const secondActive = await second.evaluate(() =>
      sessionStorage.getItem("git-review:active-project:v1"),
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
          "git-review:active-project:v1",
          JSON.stringify({ version: 1, rootPath: approvedRoot, activePath: "other-project" }),
        ),
      rootPath,
    );
    await first.goto(new URL("/?section=changes&project=inventory-fixture", url).href);
    await first
      .locator(".sidebar-project-title")
      .getByText("inventory-fixture", { exact: true })
      .waitFor();
    const selected: unknown = await first.evaluate(
      () => JSON.parse(sessionStorage.getItem("git-review:active-project:v1") ?? "null") as unknown,
    );
    if (
      new URL(first.url()).searchParams.get("project") !== "inventory-fixture" ||
      parseActiveProject(selected, rootPath) !== "inventory-fixture"
    )
      throw new Error("An explicit project link did not win over the conflicting tab selection");
    if (
      (await second.evaluate(() => sessionStorage.getItem("git-review:active-project:v1"))) !==
      secondActive
    )
      throw new Error("The explicit link changed another tab's selection");

    const startup = await browser.newContext({ serviceWorkers: "block" });
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
            "git-review:active-project:v1",
            JSON.stringify({ version: 1, rootPath: approvedRoot, activePath: "inventory-fixture" }),
          ),
        rootPath,
      );
      let opens = 0;
      pending.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/projects/open") opens += 1;
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
      await startup.close();
    }

    const migration = await browser.newContext();
    migration.setDefaultTimeout(10_000);
    try {
      const migrated = await migration.newPage();
      await migrated.addInitScript((approvedRoot) => {
        if (
          localStorage.getItem("git-review:workspace:v3") === null &&
          localStorage.getItem("git-review:workspace:v2") === null
        )
          localStorage.setItem(
            "git-review:workspace:v2",
            JSON.stringify({
              version: 2,
              rootPath: approvedRoot,
              activePath: "inventory-fixture",
              recentPaths: ["inventory-fixture"],
            }),
          );
      }, rootPath);
      await migrated.goto(startUrl);
      await migrated
        .locator(".sidebar-project-title")
        .getByText("inventory-fixture", { exact: true })
        .waitFor();
      const legacy = await migrated.evaluate(() => localStorage.getItem("git-review:workspace:v2"));
      if (legacy !== null) throw new Error("Legacy shared selection was not retired");
      await migrated.goto(startUrl);
      await migrated
        .locator(".sidebar-project-title")
        .getByText("inventory-fixture", { exact: true })
        .waitFor();
      const fresh = await migration.newPage();
      await fresh.goto(startUrl);
      await fresh.locator(".welcome h1").waitFor();
    } finally {
      await migration.close();
    }
    console.log(
      "Independent project tabs, reload and bare / restoration, explicit-link priority, delayed root completion, shared recents, and deterministic legacy selection migration passed.",
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
