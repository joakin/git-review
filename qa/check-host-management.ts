import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";
import { emptyCommentStore, type CommentStore } from "../apps/web/src/comments.ts";
import { formatAgentFeedback } from "../apps/web/src/agent-feedback.ts";
import { agentCatalogStorageKey } from "../apps/web/src/agent-data.ts";
import { parseAgentCatalog } from "../apps/web/src/agent-data-format.ts";
import { qaProfiles, withQaContext, assertNoHorizontalOverflow } from "./browser-support.ts";
import type { AgentStateFixture } from "./agent-state-fixture.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function checkHostManagement(
  browser: Browser,
  origins: { frontend: string; a: string; b: string },
  projectPath: string,
  fixture: AgentStateFixture,
  requests: readonly { agent: string; path: string }[],
  captureLabel?: string,
) {
  const destination = (endpoint: string, section = "changes") =>
    origins.frontend +
    "/?" +
    new URLSearchParams({
      agent: endpoint,
      section,
      ...(section === "changes" ? { project: projectPath } : {}),
    });
  const hubUrl = origins.frontend + "/?section=hosts";
  const store: CommentStore = {
    ...emptyCommentStore(projectPath),
    drafts: [
      {
        id: "a-feedback",
        anchor: {
          kind: "file",
          source: "worktree",
          path: "notes.ts",
          line: 1,
          sourceText: "Saved cloud A source",
          before: null,
          after: null,
        },
        subject: { kind: "line" },
        body: "Keep cloud A feedback after removal.",
        createdAt: 1,
        updatedAt: 1,
        state: "outdated",
      },
    ],
    history: [
      { id: "a-history", copiedAt: 2, text: "Exact old cloud A history\r\n🦊\t", comments: [] },
    ],
  };
  async function openHosts(page: Page) {
    await openWorkspaceMenu(page);
    await page.getByRole("button", { name: "Hosts & saved reviews", exact: true }).click();
    await page.locator(".hosts-dialog").waitFor();
  }
  async function openWorkspaceMenu(page: Page) {
    if (
      (page.viewportSize()?.width ?? 1440) < 1200 &&
      (await page
        .getByRole("button", { name: "Open workspace menu", exact: true })
        .getAttribute("aria-expanded")) !== "true"
    )
      await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector(".menu-project")?.getBoundingClientRect().left ?? -1) >= 0,
    );
  }
  function recentProject(page: Page, label: string) {
    return page.locator(".menu-recents button", {
      has: page.getByText(label, { exact: true }),
    });
  }
  async function addHost(page: Page, endpoint: string, label: string) {
    await page.getByLabel("Agent URL", { exact: true }).fill(endpoint);
    await page.getByLabel("Display name (optional)", { exact: true }).fill(label);
    await page.getByRole("button", { name: "Check host", exact: true }).click();
    await page.locator('.host-check[data-state="available"]').waitFor();
    await page.getByRole("button", { name: "Add host", exact: true }).click();
    await page.getByRole("button", { name: /^Open this folder/ }).waitFor();
  }
  async function capture(url: string, suffix: string, state: string, extra: string[] = []) {
    const child = Bun.spawn(
      [
        "bun",
        "run",
        "qa:capture",
        "--url",
        url,
        "--label",
        captureLabel + "-" + suffix,
        "--storage-state",
        state,
        "--ready",
        suffix === "menu"
          ? ".project-switch"
          : suffix === "picker"
            ? ".root-card strong"
            : "#saved-reviews-title",
        ...extra,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    assert(code === 0, out + err);
  }
  try {
    await withQaContext(
      browser,
      { ...qaProfiles.desktop, acceptDownloads: true },
      async (context) => {
        context.setDefaultTimeout(15_000);
        await context.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: origins.frontend,
        });
        const page = await context.newPage();
        const initial = requests.length;
        let fileHostApi = 0;
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (url.origin === origins.frontend && url.pathname.startsWith("/api/")) fileHostApi += 1;
        });
        await page.goto(origins.frontend);
        await page.getByRole("heading", { name: "Hosts & saved reviews", level: 1 }).waitFor();
        assert(
          (await page.getByRole("heading", { name: "Recent projects", exact: true }).count()) === 0,
          "Hosts screen contains a second recent-project list",
        );
        assert(
          requests.length === initial && fileHostApi === 0,
          "Fresh static client contacted an implicit agent",
        );
        await page.getByRole("button", { name: "Install & local data", exact: true }).click();
        await page.getByRole("heading", { name: "Install & local data", exact: true }).waitFor();
        await page
          .getByRole("button", { name: "Close install and local data", exact: true })
          .click();
        await addHost(page, origins.a, "Workspace A");
        await page.getByRole("button", { name: /^Open this folder/ }).click();
        await page.locator(".diff-card").first().waitFor();
        const activeA = page.url();
        await openHosts(page);
        const beforeBad = requests.filter((request) => request.agent === "b").length;
        await page.getByLabel("Agent URL", { exact: true }).fill(origins.b + "/api");
        await page.getByRole("button", { name: "Check host", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Use an HTTPS agent origin" }).waitFor();
        assert(
          requests.filter((request) => request.agent === "b").length === beforeBad &&
            page.url() === activeA,
          "Malformed candidate displaced active work or made a request",
        );
        await page.getByLabel("Agent URL", { exact: true }).fill(origins.b);
        await page.route(origins.b + "/api/info", (route) =>
          route.fulfill({
            status: 503,
            json: { error: { code: "unavailable", message: "Controlled host unavailable" } },
          }),
        );
        await page.getByRole("button", { name: "Check host", exact: true }).click();
        await page.locator('.host-check[data-state="unavailable"]').waitFor();
        assert(
          page.url() === activeA &&
            (await page.getByRole("button", { name: "Add host", exact: true }).count()) === 0,
          "Unreachable candidate replaced active work",
        );
        await page.unroute(origins.b + "/api/info");
        await page.route(origins.b + "/api/info", (route) =>
          route.fulfill({
            json: { application: "git-review", agentVersion: "future", protocolVersion: 99 },
          }),
        );
        await page.getByRole("button", { name: "Check host", exact: true }).click();
        await page.locator('.host-check[data-state="incompatible"]').waitFor();
        assert(
          (await page.getByRole("button", { name: "Add host", exact: true }).count()) === 0 &&
            page.url() === activeA,
          "Incompatible candidate was accepted",
        );
        await page.unroute(origins.b + "/api/info");
        let release = () => {};
        let started = () => {};
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        await page.route(origins.b + "/api/info", async (route) => {
          started();
          await held;
          await route.continue().catch(() => {});
        });
        await page.getByRole("button", { name: "Check host", exact: true }).click();
        await entered;
        await page.getByRole("button", { name: "Close hosts", exact: true }).click();
        release();
        await page.unroute(origins.b + "/api/info");
        await openHosts(page);
        assert(
          (await page.getByRole("button", { name: "Add host", exact: true }).count()) === 0 &&
            page.url() === activeA,
          "Closed check published into a new host dialog",
        );
        await addHost(page, origins.b, "Workspace B");
        await page.getByRole("button", { name: /^Open this folder/ }).click();
        await page.locator(".diff-card").first().waitFor();
        const activeB = page.url();
        assert(
          new URL(activeB).searchParams.get("agent") === origins.b,
          "Second host did not own the selected project",
        );
        const recentHub = await context.newPage();
        let hubApi = 0;
        recentHub.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/")) hubApi += 1;
        });
        await recentHub.goto(hubUrl);
        await recentHub.locator("#hosts-title").waitFor();
        assert(
          (await recentHub
            .getByRole("heading", { name: "Recent projects", exact: true })
            .count()) === 0 &&
            hubApi === 0 &&
            (await recentHub.locator(".saved-review-record").count()) === 0,
          "Host hub contains a duplicate recent-project list or fetched a host",
        );
        await recentHub.goto(destination(origins.b));
        await recentHub.locator(".diff-card").first().waitFor();
        await openWorkspaceMenu(recentHub);
        assert(
          (await recentHub.locator(".menu-recents button").count()) === 2,
          "Quick switch omitted a host, omitted projects without feedback, or duplicated an identity",
        );
        await recentProject(recentHub, "Workspace A").click();
        await recentHub.locator(".diff-card").first().waitFor();
        assert(
          new URL(recentHub.url()).searchParams.get("agent") === origins.a &&
            new URL(recentHub.url()).searchParams.get("project") === projectPath &&
            page.url() === activeB,
          "Direct recent open did not select both host and project independently of the other tab",
        );
        await recentHub.goBack();
        await recentHub.locator(".diff-card").first().waitFor();
        assert(
          new URL(recentHub.url()).searchParams.get("agent") === origins.b,
          "Back lost the previous host/project",
        );
        await openWorkspaceMenu(recentHub);
        await recentProject(recentHub, "Workspace A").click();
        await recentHub.locator(".diff-card").first().waitFor();
        await openWorkspaceMenu(recentHub);
        assert(
          (await recentHub
            .locator(".menu-recents button")
            .first()
            .locator(".menu-recent-host")
            .textContent()) === "Workspace A",
          "Reopened project did not move to the front",
        );
        await recentProject(recentHub, "Workspace B").click();
        await recentHub.locator(".diff-card").first().waitFor();
        assert(
          new URL(recentHub.url()).searchParams.get("agent") === origins.b &&
            new URL(recentHub.url()).searchParams.get("project") === projectPath,
          "Second recent opened the wrong source",
        );
        if (captureLabel !== undefined) {
          const recentStatePath = resolve("qa/.artifacts/" + captureLabel + "-recents-state.json");
          await context.storageState({ path: recentStatePath });
          await capture(destination(origins.b, "projects"), "menu", recentStatePath, [
            "--click",
            ".project-switch",
            "--after-click-ready",
            ".menu-recents button",
          ]);
        }
        await recentHub.close();
        const peer = await context.newPage();
        await peer.goto(destination(origins.a));
        await peer.locator(".diff-card").first().waitFor();
        await page.evaluate(
          ({ a, b, store }) => {
            window.reviewDataQa.writeComments(store, a);
            window.reviewDataQa.writeComments(
              {
                ...store,
                drafts: [
                  { ...store.drafts[0], id: "b-feedback", body: "Independent cloud B feedback." },
                ],
                history: [],
              },
              b,
            );
          },
          { ...origins, store },
        );
        await openHosts(peer);
        const bHost = peer.locator(".host-record", {
          has: peer.locator(".host-address", { hasText: origins.b }),
        });
        await bHost.locator('input[name="label"]').fill("Renamed workspace B");
        await bHost.getByRole("button", { name: "Save name", exact: true }).click();
        await bHost.getByText("Renamed workspace B", { exact: true }).waitFor();
        assert(
          page.url() === activeB && new URL(peer.url()).searchParams.get("agent") === origins.a,
          "Catalog update synchronized tab destinations",
        );
        await openHosts(page);
        await page.locator(".host-record").filter({ hasText: "Renamed workspace B" }).waitFor();
        await page
          .locator(".menu-recent-host")
          .filter({ hasText: "Renamed workspace B" })
          .waitFor({ state: "attached" });
        await page.getByRole("button", { name: "Close hosts", exact: true }).click();
        const aHost = peer.locator(".host-record", {
          has: peer.locator(".host-address", { hasText: origins.a }),
        });
        await aHost.getByRole("button", { name: "Remove host", exact: true }).click();
        await peer.getByRole("heading", { name: "Host connection needed", exact: true }).waitFor();
        const retained = peer.locator(".saved-review-record", {
          has: peer.locator(".host-address", { hasText: origins.a }),
        });
        await retained.getByText("Host removed or not added", { exact: false }).waitFor();
        const beforeRecovery = requests.filter((request) => request.agent === "a").length;
        await retained.getByRole("button", { name: "Open saved review", exact: true }).click();
        await peer
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        await peer.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        const recovery = formatAgentFeedback(
          { endpoint: origins.a, projectPath },
          store.drafts,
          "recovery",
        );
        await peer.waitForFunction(
          (expected) => navigator.clipboard.readText().then((actual) => actual === expected),
          recovery,
        );
        await peer.evaluate((key) => {
          window.addEventListener("storage", (event) => {
            if (event.key === key) document.body.dataset["catalogSeen"] = "yes";
          });
        }, agentCatalogStorageKey);
        await page.evaluate(() =>
          window.reviewDataQa.writeGlobal({ wrap: !window.reviewDataQa.global().wrap }),
        );
        await peer.waitForFunction(() => document.body.dataset["catalogSeen"] === "yes");
        await peer.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        assert(
          await peer.locator("#review-export-text").isVisible(),
          "Unrelated catalog update closed removed-host feedback recovery",
        );
        assert(
          requests.filter((request) => request.agent === "a").length === beforeRecovery,
          "Removed-host recovery contacted an agent",
        );
        assert(page.url() === activeB, "Removing another host moved this tab's selected project");
        await peer.reload();
        await peer.getByRole("heading", { name: "Host connection needed", exact: true }).waitFor();
        const catalog = parseAgentCatalog(
          await peer.evaluate((key) => {
            const head = JSON.parse(localStorage.getItem(key) ?? "null") as { catalog: unknown };
            return head.catalog;
          }, agentCatalogStorageKey),
        );
        assert(
          catalog.connections.length === 1 && catalog.connections[0]?.endpoint === origins.b,
          "Removal changed a peer connection or re-added the removed host",
        );
        assert(
          JSON.stringify(
            await peer.evaluate(({ a, path }) => window.reviewDataQa.readComments(path, a), {
              a: origins.a,
              path: projectPath,
            }),
          ) === JSON.stringify(store),
          "Host removal changed saved drafts/history",
        );
        const state = await context.storageState();
        const statePath = resolve("qa/.artifacts/" + captureLabel + "-state.json");
        if (captureLabel !== undefined) await context.storageState({ path: statePath });
        for (const [name, profile] of Object.entries({
          ...qaProfiles,
          narrowPhone: { ...qaProfiles.phone, viewport: { width: 320, height: 780 } },
        })) {
          await withQaContext(browser, { ...profile, storageState: state }, async (layout) => {
            const screen = await layout.newPage();
            await screen.goto(hubUrl);
            await screen.locator(".saved-review-record").first().waitFor();
            await assertNoHorizontalOverflow(screen);
            for (const button of await screen.locator(".host-manager button").all()) {
              const bounds = await button.boundingBox();
              assert(
                bounds !== null && bounds.height >= 44,
                `${name}: host control lacks a touch target`,
              );
            }
            await screen
              .locator(".saved-review-record", {
                has: screen.locator(".host-address", { hasText: origins.a }),
              })
              .getByRole("button", { name: "Open saved review", exact: true })
              .click();
            await screen
              .getByRole("button", { name: "Open saved feedback & history", exact: true })
              .click();
            await screen.locator("#review-export-text").waitFor();
            await assertNoHorizontalOverflow(screen);
            await screen.goto(destination(origins.b));
            await screen.locator(".diff-card").first().waitFor();
            await openWorkspaceMenu(screen);
            const recentButtons = screen.locator(".menu-recents button");
            assert(
              (await recentButtons.count()) === 2,
              `${name}: quick switch omitted another host`,
            );
            for (const button of await recentButtons.all()) {
              const bounds = await button.boundingBox();
              assert(
                bounds !== null && bounds.height >= 44,
                `${name}: recent project lacks a touch target`,
              );
            }
            await assertNoHorizontalOverflow(screen);
            await recentProject(screen, new URL(origins.a).host).click();
            await screen
              .getByRole("heading", { name: "Host connection needed", exact: true })
              .waitFor();
            await screen
              .getByRole("button", { name: "Open saved feedback & history", exact: true })
              .click();
            await screen.locator("#review-export-text").waitFor();
            await screen.goBack();
            await screen.locator(".diff-card").first().waitFor();
            await openWorkspaceMenu(screen);
            await recentProject(screen, "Renamed workspace B").click();
            if (profile.viewport.width < 1200)
              await screen.waitForFunction(
                () =>
                  (document.querySelector(".workspace-menu")?.getBoundingClientRect().right ??
                    Infinity) <= 0,
              );
            if (profile.viewport.width <= 600) {
              await screen.locator(".change-row-button").first().click();
            }
            await screen.locator(".diff-card:visible").first().waitFor();
            assert(
              new URL(screen.url()).searchParams.get("agent") === origins.b &&
                new URL(screen.url()).searchParams.get("project") === projectPath,
              `${name}: direct recent open lost its host or project`,
            );
            await assertNoHorizontalOverflow(screen);
          });
        }
        const beforePrefill = requests.filter((request) => request.agent === "a").length;
        await peer.goto(origins.frontend + "/?connect=" + encodeURIComponent(origins.a));
        await peer.waitForURL(hubUrl);
        assert(
          (await peer.getByLabel("Agent URL", { exact: true }).inputValue()) === origins.a,
          "Printed link lost its prefill or left a competing route",
        );
        await assertNoHorizontalOverflow(peer);
        assert(
          requests.filter((request) => request.agent === "a").length === beforePrefill,
          "Prefill automatically contacted its candidate",
        );
        await addHost(peer, origins.a, "Re-added workspace A");
        await peer.goBack();
        await peer.waitForURL(hubUrl);
        await peer.goForward();
        await peer.waitForURL(
          (url) =>
            url.searchParams.get("agent") === origins.a &&
            url.searchParams.get("section") === "projects",
        );
        const incompatible = await context.newPage();
        await incompatible.route(origins.a + "/api/info", (route) =>
          route.fulfill({
            json: { application: "git-review", agentVersion: "future", protocolVersion: 99 },
          }),
        );
        const beforeIncompatible = requests.filter(
          (request) => request.agent === "a" && request.path !== "/api/info",
        ).length;
        await incompatible.goto(destination(origins.a));
        await incompatible
          .getByRole("heading", { name: "Live project unavailable", exact: true })
          .waitFor();
        assert(
          requests.filter((request) => request.agent === "a" && request.path !== "/api/info")
            .length === beforeIncompatible,
          "Known incompatible host performed repository reads",
        );
        await incompatible
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        assert(
          (await incompatible.locator("#review-export-text").inputValue()).includes(
            "Keep cloud A feedback",
          ),
          "Incompatible known host blocked saved recovery",
        );
        await incompatible.close();
        if (captureLabel !== undefined) {
          fixture.agentUnavailable = true;
          const checkUnavailable = [
            "--click",
            ".host-record .host-actions button:first-child",
            "--after-click-ready",
            '.host-status[data-state="unavailable"]',
          ];
          await capture(hubUrl, "hosts", statePath, checkUnavailable);
          await capture(hubUrl, "saved", statePath, [
            ...checkUnavailable,
            "--scroll-to",
            "#saved-reviews-title",
            "--scroll-offset",
            "0",
          ]);
          fixture.agentUnavailable = false;
          await capture(destination(origins.b, "projects"), "picker", statePath);
        }
      },
    );
    console.log(
      "Host management passed: static bootstrap, validation, incompatible/held checks, unified recents and direct two-host opens, independent tabs, rename/remove, retained recovery, printed prefill, history and five responsive layouts.",
    );
  } finally {
    fixture.agentUnavailable = false;
    fixture.releaseAll();
  }
}
