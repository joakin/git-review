import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { appUrl, withQaBrowser, withQaContext } from "./browser-support.ts";
import { parseAgentTabSelection, agentActiveProjectKey } from "../apps/web/src/agent-tab-state.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-tabs.ts <local app URL>");
const url = appUrl(rawUrl);
const rootPath = resolve("qa/.artifacts");
await mkdir(resolve(rootPath, "other-project"), { recursive: true });
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function selectFolder(page: Page, folder: string) {
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
    await selectFolder(second, "other-project");
    for (const [page, folder] of [
      [first, "inventory-fixture"],
      [second, "other-project"],
    ] as const) {
      await page.reload();
      await page.locator(".sidebar-project-title").getByText(folder, { exact: true }).waitFor();
      await page.goto(url.href);
      await page.locator(".sidebar-project-title").getByText(folder, { exact: true }).waitFor();
      assert(
        new URL(page.url()).searchParams.get("project") === rootPath + "/" + folder,
        "Bare URL lost its canonical tab destination",
      );
    }
    const firstSelection: unknown = await first.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
      agentActiveProjectKey,
    );
    const secondSelection: unknown = await second.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
      agentActiveProjectKey,
    );
    assert(
      parseAgentTabSelection(firstSelection)?.projectPath === rootPath + "/inventory-fixture" &&
        parseAgentTabSelection(secondSelection)?.projectPath === rootPath + "/other-project",
      "Tab selections were not independent",
    );
    const recents = await first.evaluate((root) => window.reviewDataQa.workspace(root), rootPath);
    assert(
      recents.recentPaths.includes("inventory-fixture") &&
        recents.recentPaths.includes("other-project"),
      "Root recents were not shared",
    );

    await first.evaluate(
      ({ key, root, endpoint }) => {
        if (location.origin !== endpoint) return;
        sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            endpoint,
            rootPath: root,
            relativePath: "other-project",
            projectPath: root + "/other-project",
          }),
        );
      },
      { key: agentActiveProjectKey, root: rootPath, endpoint: url.origin },
    );
    await first.goto(new URL("/?section=changes&project=inventory-fixture", url).href);
    await first
      .locator(".sidebar-project-title")
      .getByText("inventory-fixture", { exact: true })
      .waitFor();
    const selected: unknown = await first.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
      agentActiveProjectKey,
    );
    assert(
      parseAgentTabSelection(selected)?.projectPath === rootPath + "/inventory-fixture",
      "Explicit URL did not win over tab restoration",
    );
    assert(
      JSON.stringify(
        await second.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
          agentActiveProjectKey,
        ),
      ) === JSON.stringify(secondSelection),
      "Explicit selection changed another tab",
    );
  });

  await withQaContext(browser, { serviceWorkers: "block" }, async (context) => {
    await context.addInitScript(
      ({ key, root, endpoint }) => {
        if (location.origin !== endpoint) return;
        sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            endpoint,
            rootPath: root,
            relativePath: "inventory-fixture",
            projectPath: root + "/inventory-fixture",
          }),
        );
      },
      { key: agentActiveProjectKey, root: rootPath, endpoint: url.origin },
    );
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await context.newPage();
    try {
      await page.route("**/api/roots", async (route) => {
        await gate;
        await route.continue().catch(() => {});
      });
      await page.route("**/api/project?*", async (route) => {
        await gate;
        await route.continue().catch(() => {});
      });
      await page.goto(url.href);
      await page.evaluate(() => {
        history.pushState(null, "", "/?section=settings");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.locator("#app-theme").waitFor();
      release();
      await page
        .locator(".root-copy span")
        .filter({ hasText: rootPath })
        .waitFor({ state: "attached" });
      assert(
        new URL(page.url()).searchParams.get("section") === "settings",
        "Late startup reads replaced explicit Settings",
      );
    } finally {
      release();
    }
  });

  for (const invalidPath of ["../escape", "/absolute", "safe//child", "safe/"]) {
    await withQaContext(browser, { serviceWorkers: "block" }, async (context) => {
      await context.addInitScript(
        ({ key, root, endpoint, path }) => {
          if (location.origin !== endpoint) return;
          sessionStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              endpoint,
              rootPath: root,
              relativePath: path,
              projectPath: root + "/" + path,
            }),
          );
        },
        { key: agentActiveProjectKey, root: rootPath, endpoint: url.origin, path: invalidPath },
      );
      const page = await context.newPage();
      let lookups = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/project") lookups += 1;
      });
      await page.goto(url.href);
      await page.locator(".welcome h1").waitFor();
      assert(lookups === 0, "Invalid tab metadata opened a project");
    });
  }
  await withQaContext(browser, {}, async (context) => {
    await context.addInitScript(() => {
      if (location.origin === "null") return;
      localStorage.setItem("git-review:workspace:v3", "retired");
      localStorage.setItem("git-review:comments:v1:obsolete", "retired");
      localStorage.setItem("unrelated", "keep");
    });
    const page = await context.newPage();
    await page.goto(url.href);
    await page.locator(".welcome h1").waitFor();
    assert(
      await page.evaluate(
        () =>
          localStorage.getItem("unrelated") === "keep" &&
          localStorage.getItem("git-review:comments:v1:obsolete") === "retired",
      ),
      "New storage touched unsupported or unrelated source keys",
    );
  });
  console.log(
    "Endpoint-owned tab restoration, canonical explicit routes, shared root recents, startup races, invalid metadata, and retained source keys passed.",
  );
});
