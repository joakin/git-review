import { resolve } from "node:path";
import type { Browser } from "playwright-core";
import { parseAgentBackup, serializeAgentBackup } from "../apps/web/src/agent-data-format.ts";
import { commentStoragePrefix, emptyCommentStore } from "../apps/web/src/comments.ts";
import { agentCatalogStorageKey } from "../apps/web/src/agent-data.ts";
import { assertNoHorizontalOverflow, qaProfiles, withQaContext } from "./browser-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function checkAgentDataActivation(
  browser: Browser,
  origins: { frontend: string; a: string; b: string },
  projectPath: string,
  captureLabel?: string,
) {
  const store = {
    ...emptyCommentStore(projectPath),
    drafts: [
      {
        id: "migration-draft",
        anchor: {
          kind: "file" as const,
          source: "worktree" as const,
          path: "notes.ts",
          line: 1,
          sourceText: "export const transportLine1 = 1;",
          before: null,
          after: "export const transportLine2 = 2;",
        },
        subject: { kind: "line" as const },
        body: "Keep feedback through the frontend move.",
        createdAt: 1,
        updatedAt: 2,
        state: "current" as const,
      },
    ],
    history: [{ id: "migration-copy", copiedAt: 3, text: "Exact history  \r\n🦊\t", comments: [] }],
  };
  const legacyKey = commentStoragePrefix + encodeURIComponent(projectPath);
  const mirror = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const response = await fetch(new URL(url.pathname + url.search, origins.frontend));
      return new Response(response.body, { status: response.status, headers: response.headers });
    },
  });
  async function capture(url: string, label: string, state: string, actions: string[]) {
    const result = Bun.spawn(
      [
        "bun",
        "run",
        "qa:capture",
        "--url",
        url,
        "--label",
        label,
        "--storage-state",
        state,
        ...actions,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ]);
    assert(code === 0, stdout + stderr);
  }
  try {
    await withQaContext(
      browser,
      { ...qaProfiles.phone, acceptDownloads: true },
      async (context) => {
        context.setDefaultTimeout(15_000);
        const page = await context.newPage();
        await context.addInitScript(
          ({ key, store, projectPath }) => {
            if (localStorage.getItem("qa-legacy-seeded") !== null) return;
            localStorage.setItem(key, JSON.stringify(store));
            localStorage.setItem(
              "git-review:workspace:v4",
              JSON.stringify({ version: 4, rootPath: projectPath, recentPaths: [""] }),
            );
            localStorage.setItem("qa-legacy-seeded", "yes");
          },
          { key: legacyKey, store, projectPath },
        );
        let agentRequests = 0;
        page.on("request", (request) => {
          if ([origins.a, origins.b].includes(new URL(request.url()).origin)) agentRequests += 1;
        });
        await page.goto(origins.frontend + "/?section=settings");
        await page
          .getByRole("heading", { name: "Choose the host for your saved reviews" })
          .waitFor();
        assert(agentRequests === 0, "Migration gate contacted an agent before assignment");
        assert(
          await page.evaluate((key) => localStorage.getItem(key) === null, agentCatalogStorageKey),
          "Migration gate created authoritative data",
        );
        await page.getByLabel("Agent URL", { exact: true }).fill(origins.b);
        await page.getByRole("button", { name: "Preview conversion", exact: true }).tap();
        await page.locator(".install-preview").waitFor();
        await assertNoHorizontalOverflow(page);
        assert(agentRequests === 0, "Preview contacted an agent");
        if (captureLabel !== undefined) {
          const state = resolve("qa/.artifacts/" + captureLabel + "-legacy.json");
          await context.storageState({ path: state });
          await capture(
            origins.frontend + "/?section=settings",
            captureLabel + "-conversion",
            state,
            [
              "--ready",
              ".local-data-setup",
              "--fill",
              ".agent-endpoint-field input",
              origins.b,
              "--click",
              'button:has-text("Preview conversion")',
              "--after-click-ready",
              ".install-preview",
            ],
          );
        }
        // Force a real UI conversion write failure, leaving the original source and no marker.
        await page.evaluate(() => {
          const original = Storage.prototype.setItem;
          let failed = false;
          Storage.prototype.setItem = function (key, value) {
            if (!failed && key.startsWith("git-review:agents:v1:reviews:")) {
              failed = true;
              throw new DOMException("QA quota", "QuotaExceededError");
            }
            original.call(this, key, value);
          };
        });
        await page.getByRole("button", { name: "Assign reviews and continue" }).tap();
        await page.getByRole("alert").filter({ hasText: "could not save" }).waitFor();
        assert(
          await page.evaluate((key) => localStorage.getItem(key) === null, agentCatalogStorageKey),
          "Failed conversion published a catalog",
        );
        await page.getByRole("button", { name: "Assign reviews and continue" }).tap();
        await page.locator("#code-font-size").waitFor();
        assert(
          await page.evaluate(({ key, value }) => localStorage.getItem(key) === value, {
            key: legacyKey,
            value: JSON.stringify(store),
          }),
          "Conversion changed its legacy source",
        );
        // Offline agents must not disable backup controls.
        await context.route("**/api/**", (route) => route.abort());
        await page.reload();
        await page.locator("#code-font-size").waitFor();
        await page.locator(".settings-install-data").tap();
        const dialog = page.getByRole("dialog", { name: "Install & local data" });
        await dialog.getByRole("button", { name: "Export local review data" }).waitFor();
        const downloading = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Export local review data" }).tap();
        const downloaded = await (await downloading).path();
        assert(downloaded !== null, "Backup did not download");
        const text = await Bun.file(downloaded).text();
        const backup = parseAgentBackup(JSON.parse(text) as unknown);
        assert(
          backup.reviews.length === 1 &&
            backup.reviews[0]?.project.endpoint === origins.b &&
            JSON.stringify(backup.reviews[0].comments) ===
              JSON.stringify(
                parseAgentBackup({
                  ...backup,
                  reviews: [{ ...backup.reviews[0], comments: store }],
                }).reviews[0]?.comments,
              ),
          "Conversion changed feedback or assigned the wrong host",
        );
        // Simulate a later save by an old tab. Completed migration must ignore it.
        await page.evaluate(
          (key) => localStorage.setItem(key, "{old tab invalid data}"),
          legacyKey,
        );
        await page.reload();
        await page.locator("#code-font-size").waitFor();

        await withQaContext(
          browser,
          { ...qaProfiles.phone, acceptDownloads: true },
          async (fresh) => {
            await fresh.route("**/api/**", (route) => route.abort());
            const target = await fresh.newPage();
            await target.goto(mirror.url.origin + "/?section=settings");
            await target.locator("#code-font-size").waitFor();
            await target.locator(".settings-install-data").tap();
            const nextDialog = target.getByRole("dialog", { name: "Install & local data" });
            const input = nextDialog.locator('input[type="file"]');
            await input.setInputFiles({
              name: "agent-backup.json",
              mimeType: "application/json",
              buffer: Buffer.from(text),
            });
            await nextDialog
              .getByRole("button", { name: "Import and replace matching data" })
              .waitFor();
            await assertNoHorizontalOverflow(target);
            if (captureLabel !== undefined) {
              const state = resolve("qa/.artifacts/" + captureLabel + "-new-origin.json");
              await fresh.storageState({ path: state });
              const file = resolve("qa/.artifacts/" + captureLabel + "-backup.json");
              await Bun.write(file, text);
              await capture(
                mirror.url.origin + "/?section=settings",
                captureLabel + "-import",
                state,
                [
                  "--ready",
                  "#code-font-size",
                  "--click",
                  ".notification-dismiss",
                  "--click",
                  ".settings-install-data",
                  "--file",
                  'input[type="file"]',
                  file,
                  "--after-click-ready",
                  ".install-preview",
                  "--scroll-to",
                  ".install-preview",
                  "--scroll-offset",
                  "0",
                ],
              );
            }
            await nextDialog
              .getByRole("button", { name: "Import and replace matching data" })
              .tap();
            await target.locator("#code-font-size").waitFor();
            const current = await target.evaluate(() => window.reviewDataQa.commentRecords());
            assert(
              current.some(
                ([, comments]) =>
                  comments.includes("Keep feedback through the frontend move.") &&
                  comments.includes("Exact history"),
              ),
              "New-origin import lost its saved feedback/history",
            );

            const legacyBackup = {
              version: 7,
              rootPath: projectPath,
              workspace: { version: 4, rootPath: projectPath, recentPaths: [""] },
              comments: [store],
              openCards: [],
              languages: [],
              ...backup.catalog.global,
            };
            await target.locator(".settings-install-data").tap();
            await input.setInputFiles({
              name: "legacy-backup.json",
              mimeType: "application/json",
              buffer: Buffer.from(JSON.stringify(legacyBackup)),
            });
            await nextDialog
              .getByText("This backup does not record a host.", { exact: false })
              .waitFor();
            assert(
              (await nextDialog
                .getByRole("button", { name: "Import and replace matching data" })
                .count()) === 0,
              "Legacy backup skipped assignment",
            );
            await nextDialog.getByLabel("Agent URL", { exact: true }).fill(origins.a);
            await nextDialog.getByRole("button", { name: "Preview host assignment" }).tap();
            await nextDialog
              .getByRole("button", { name: "Import and replace matching data" })
              .tap();
            await target.locator("#code-font-size").waitFor();
            const records = await target.evaluate(
              ({ a, b, path }) => [
                window.reviewDataQa.readComments(path, a),
                window.reviewDataQa.readComments(path, b),
              ],
              { a: origins.a, b: origins.b, path: projectPath },
            );
            assert(
              records.every((record) => record.drafts[0]?.id === "migration-draft"),
              "Legacy import overwrote another endpoint",
            );
            await target.locator(".settings-install-data").tap();
            const again = target.waitForEvent("download");
            await nextDialog.getByRole("button", { name: "Export local review data" }).tap();
            const result = await (await again).path();
            assert(result !== null, "Second export missing");
            const exported = parseAgentBackup(JSON.parse(await Bun.file(result).text()) as unknown);
            assert(
              exported.reviews.length === 2 &&
                serializeAgentBackup(exported).includes("Exact history"),
              "Global export omitted an offline host",
            );
          },
        );
      },
    );
    console.log(
      "Activated data browser check passed: explicit conversion, failed-write retry, preserved legacy source, old-tab isolation, offline-agent export, real origin transfer, and legacy/new backup previews.",
    );
  } finally {
    mirror.stop(true);
  }
}
