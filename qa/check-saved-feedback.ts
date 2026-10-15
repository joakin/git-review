import { resolve } from "node:path";
import type { Browser } from "playwright-core";
import { parseAgentBackup } from "../apps/web/src/agent-data-format.ts";
import { emptyCommentStore, type CommentStore } from "../apps/web/src/comments.ts";
import { formatAgentFeedback } from "../apps/web/src/agent-feedback.ts";
import { withQaContext, qaProfiles, assertNoHorizontalOverflow } from "./browser-support.ts";
import type { AgentStateFixture } from "./agent-state-fixture.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
declare global {
  interface Window {
    savedRecoveryQa: { started: number; release: () => void };
    savedHistoryText: string | null;
  }
}
export async function checkSavedFeedback(
  browser: Browser,
  origins: { frontend: string; a: string; b: string },
  projectPath: string,
  fixture: AgentStateFixture,
  captureLabel?: string,
) {
  const unknown = "https://unconfigured.example.ts.net";
  const store: CommentStore = {
    ...emptyCommentStore(projectPath),
    drafts: [
      {
        id: "current",
        anchor: {
          kind: "file",
          source: "worktree",
          path: "notes.ts",
          line: 1,
          sourceText: "export const transportLine1 = 1;",
          before: null,
          after: "export const transportLine2 = 2;",
        },
        subject: { kind: "line" },
        body: "Keep this cloud workspace question.",
        createdAt: 1,
        updatedAt: 2,
        state: "current",
      },
      {
        id: "outdated",
        anchor: {
          kind: "file",
          source: "worktree",
          path: "notes.ts",
          line: 1,
          sourceText: "old captured code",
          before: null,
          after: null,
        },
        subject: { kind: "line" },
        body: "Keep this outdated question too.",
        createdAt: 1,
        updatedAt: 2,
        state: "outdated",
      },
    ],
    history: [{ id: "original", copiedAt: 3, text: "Exact old history  \r\n🦊\t", comments: [] }],
  };
  const url = (endpoint: string, path = projectPath) =>
    origins.frontend +
    "/?" +
    new URLSearchParams({ agent: endpoint, section: "changes", project: path });
  async function capture(state: string, suffix: string, actions: string[]) {
    const process = Bun.spawn(
      [
        "bun",
        "run",
        "qa:capture",
        "--publish",
        "--url",
        url(origins.a),
        "--label",
        captureLabel + "-" + suffix,
        "--storage-state",
        state,
        "--ready",
        ".saved-review-summary h2",
        "--click",
        ".notification-dismiss",
        ...actions,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, out, err] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    assert(code === 0, out + err);
  }
  try {
    fixture.agentUnavailable = true;
    await withQaContext(
      browser,
      { ...qaProfiles.phone, acceptDownloads: true },
      async (context) => {
        context.setDefaultTimeout(15_000);
        await context.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: origins.frontend,
        });
        await context.addInitScript(
          ({ frontend, a, b, unknown, store }) => {
            if (location.origin !== frontend || localStorage.getItem("qa-recovery-seeded") !== null)
              return;
            window.reviewDataQa.writeComments(store, a);
            window.reviewDataQa.writeComments(
              {
                ...store,
                drafts: [{ ...store.drafts[0], body: "Other host question" }],
                history: [],
              },
              b,
            );
            window.reviewDataQa.writeComments(store, unknown);
            localStorage.setItem("qa-recovery-seeded", "yes");
          },
          { ...origins, unknown, store },
        );
        const page = await context.newPage();
        let sourceRequests = 0;
        let unknownRequests = 0;
        page.on("request", (request) => {
          const target = new URL(request.url());
          if (target.origin === unknown) unknownRequests += 1;
          if (
            [origins.a, origins.b].includes(target.origin) &&
            target.pathname.startsWith("/api/project/")
          )
            sourceRequests += 1;
        });
        let releaseStartup = () => {};
        const startup = new Promise<void>((resolve) => {
          releaseStartup = resolve;
        });
        await page.route("**/api/**", async (route) => {
          await startup;
          await route.continue().catch(() => {});
        });
        const text = formatAgentFeedback(
          { endpoint: origins.a, projectPath },
          store.drafts,
          "recovery",
        );
        try {
          await page.goto(url(origins.a));
          await page.getByRole("heading", { name: "Opening live project…", exact: true }).waitFor();
          await page
            .getByRole("button", { name: "Open saved feedback & history", exact: true })
            .click();
          assert(
            (await page.locator("#review-export-text").inputValue()) === text,
            "Saved review waited for live metadata before opening",
          );
          assert(sourceRequests === 0, "Pending-project recovery requested source");
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();
        } finally {
          releaseStartup();
          await page.unroute("**/api/**");
        }
        await page
          .getByRole("heading", { name: "Live project unavailable", exact: true })
          .waitFor();
        assert(
          (await page.locator(".saved-review-summary").innerText()).includes(
            "2 saved drafts · 1 copy history entry",
          ),
          "Unavailable project lost saved counts",
        );
        const recoveryState = await context.storageState();
        for (const [name, profile] of Object.entries({
          ...qaProfiles,
          narrowPhone: { ...qaProfiles.phone, viewport: { width: 320, height: 780 } },
        })) {
          await withQaContext(
            browser,
            { ...profile, storageState: recoveryState },
            async (layout) => {
              const screen = await layout.newPage();
              for (const target of ["all", "list"]) {
                await screen.goto(url(origins.a) + (target === "list" ? "&target=list" : ""));
                await screen
                  .getByRole("heading", { name: "Live project unavailable", exact: true })
                  .waitFor();
                const summary = screen.locator("main .saved-review-summary");
                assert(
                  await summary.isVisible(),
                  `${name}/${target}: recovery was hidden by pane selection`,
                );
                assert(
                  !(await screen.locator(".workspace > .sidebar").isVisible()),
                  `${name}/${target}: empty contextual sidebar remained visible`,
                );
                assert(
                  (await screen
                    .getByRole("button", { name: "Choose another project", exact: true })
                    .count()) === 1,
                  `${name}/${target}: unavailable project actions were duplicated`,
                );
                const bounds = await summary.boundingBox();
                const header = await screen.locator(".topbar").boundingBox();
                assert(
                  bounds !== null &&
                    header !== null &&
                    bounds.width <= 800 &&
                    bounds.y >= header.y + header.height,
                  `${name}/${target}: recovery escaped its readable content area`,
                );
                for (const button of await summary.getByRole("button").all()) {
                  const buttonBounds = await button.boundingBox();
                  assert(
                    buttonBounds !== null && buttonBounds.height >= 44,
                    `${name}/${target}: recovery control lacked a touch target`,
                  );
                }
                await assertNoHorizontalOverflow(screen);
              }
              await screen
                .getByRole("button", { name: "Choose another project", exact: true })
                .click();
              await screen.waitForURL(
                (destination) => destination.searchParams.get("section") === "projects",
              );
              assert(
                (await screen.locator(".saved-review-summary").count()) === 0,
                `${name}: recovery remained after leaving the project`,
              );
            },
          );
        }
        if (captureLabel !== undefined) {
          const state = resolve("qa/.artifacts/" + captureLabel + "-state.json");
          await context.storageState({ path: state });
          await capture(state, "summary", []);
          await capture(state, "dialog", [
            "--click",
            ".saved-review-summary button:first-child",
            "--after-click-ready",
            "#review-export-text",
          ]);
        }
        const before = sourceRequests;
        await page
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        const dialog = page.locator(".feedback-dialog");
        assert(
          (await page.locator("#review-export-text").inputValue()) === text,
          "Recovery preview lost captured feedback",
        );
        assert(
          await dialog.getByRole("button", { name: "Check lines", exact: true }).isDisabled(),
          "Unavailable project allowed a source check",
        );
        assert(
          await dialog.getByRole("button", { name: "Reattach to line", exact: true }).isDisabled(),
          "Unavailable project allowed reattachment",
        );
        await dialog.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        await page.waitForFunction(
          (text) => navigator.clipboard.readText().then((value) => value === text),
          text,
        );
        assert(sourceRequests === before, "Recovery requested live sources");
        const retained = await page.evaluate(
          ({ projectPath, a }) => window.reviewDataQa.readComments(projectPath, a),
          { projectPath, a: origins.a },
        );
        assert(
          JSON.stringify(retained) === JSON.stringify(store),
          "Recovery copy mutated saved drafts/history",
        );
        await dialog.locator(".review-history summary").click();
        const historical = await dialog.locator(".review-history textarea").inputValue();
        const exactHistory = store.history[0]?.text;
        assert(typeof exactHistory === "string", "Missing history fixture");
        assert(
          historical === exactHistory.replace(/\r\n/g, "\n"),
          "Archived history display changed",
        );
        await page.evaluate(() => {
          const native = navigator.clipboard.writeText.bind(navigator.clipboard);
          window.savedHistoryText = null;
          Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: (text: string) => {
              window.savedHistoryText = text;
              return native(text);
            },
          });
        });
        await dialog.getByRole("button", { name: "Copy again", exact: true }).click();
        await page.waitForFunction(
          (text) => navigator.clipboard.readText().then((value) => value === text),
          historical,
        );
        assert(
          (await page.evaluate(() => window.savedHistoryText)) === exactHistory,
          "History clipboard write regenerated the archived text",
        );
        const download = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Export project review", exact: true }).click();
        const file = await (await download).path();
        assert(file !== null, "Project export did not download");
        const backup = parseAgentBackup(JSON.parse(await Bun.file(file).text()) as unknown);
        assert(
          backup.reviews.length === 1 && backup.reviews[0]?.project.endpoint === origins.a,
          "Project export mixed hosts",
        );
        assert(
          JSON.stringify(backup.reviews[0]?.comments) === JSON.stringify(store),
          "Project export changed feedback/history",
        );
        await page.evaluate(() =>
          Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: () => Promise.reject(new Error("Controlled clipboard denied")),
          }),
        );
        await dialog.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        await page.getByText("Controlled clipboard denied", { exact: true }).waitFor();
        await dialog.getByRole("button", { name: "Select text", exact: true }).click();
        assert(
          await page
            .locator("#review-export-text")
            .evaluate(
              (element) =>
                element instanceof HTMLTextAreaElement &&
                element.selectionEnd - element.selectionStart === element.value.length,
            ),
          "Clipboard failure lost selectable text",
        );
        await assertNoHorizontalOverflow(page);
        await page.reload();
        await page
          .getByRole("heading", { name: "Live project unavailable", exact: true })
          .waitFor();
        // Root failure can trigger a second canonical metadata attempt. Restore the fixture only
        // once startup has settled, so this scenario tests explicit Retry rather than that attempt.
        await page.waitForLoadState("networkidle");
        fixture.agentUnavailable = false;
        await page.getByRole("button", { name: "Retry live access", exact: true }).click();
        await page.locator(".diff-card").first().waitFor();
        await page.getByRole("button", { name: "Feedback 2", exact: true }).click();
        await dialog.getByRole("button", { name: "Copy feedback", exact: true }).waitFor();
        await page.waitForFunction(() => {
          const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>(".feedback-dialog button"),
          );
          return buttons.some(
            (button) => button.textContent?.trim() === "Copy feedback" && !button.disabled,
          );
        });
        const checked = await page.locator("#review-export-text").inputValue();
        assert(
          checked.includes(origins.a) && !checked.includes("Keep this outdated question too."),
          "Reconnection failed to restore checked-copy rules",
        );
        const held = fixture.holdNext("feedback");
        await dialog.getByRole("button", { name: "Check lines", exact: true }).click();
        await held;
        fixture.agentUnavailable = true;
        await dialog
          .getByRole("button", { name: "Recover saved feedback without checking", exact: true })
          .click();
        await dialog.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        await page.waitForFunction(
          (text) => navigator.clipboard.readText().then((value) => value === text),
          text,
        );
        fixture.release("feedback");
        assert(
          (await page.locator("#review-export-text").inputValue()) === text,
          "Late check replaced recovery text",
        );
        await page.evaluate(() => {
          window.savedRecoveryQa = { started: 0, release: () => {} };
          Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: () => {
              window.savedRecoveryQa.started += 1;
              return new Promise<void>((resolve) => {
                window.savedRecoveryQa.release = resolve;
              });
            },
          });
        });
        await dialog.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        await page.waitForFunction(() => window.savedRecoveryQa.started === 1);
        await page.evaluate((url) => {
          history.pushState({}, "", url);
          dispatchEvent(new PopStateEvent("popstate"));
        }, url(origins.b));
        await page
          .getByRole("heading", { name: "Live project unavailable", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        await dialog.getByRole("button", { name: "Copy saved feedback", exact: true }).click();
        await page.evaluate((url) => {
          history.pushState({}, "", url);
          dispatchEvent(new PopStateEvent("popstate"));
        }, url(unknown));
        await page.getByRole("heading", { name: "Host connection needed", exact: true }).waitFor();
        await page.evaluate(() => window.savedRecoveryQa.release());
        await page
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        assert(
          (await page.locator("#review-export-text").inputValue()).includes(unknown),
          "Unconfigured host lost its saved feedback ownership",
        );
        assert(unknownRequests === 0, "Saved unconfigured review made an agent request");
        assert(
          (await page.evaluate(() => window.savedRecoveryQa.started)) === 1,
          "A canceled queued copy reached the clipboard",
        );
        assert(
          (await page.locator(".notification-message").allTextContents()).every(
            (message) => !message.includes("Saved feedback copied"),
          ),
          "Late recovery completion notified another destination",
        );
        const final = await page.evaluate(
          ({ projectPath, a, b }) => ({
            a: window.reviewDataQa.readComments(projectPath, a),
            b: window.reviewDataQa.readComments(projectPath, b),
          }),
          { projectPath, ...origins },
        );
        assert(
          JSON.stringify(final.a) === JSON.stringify(store) &&
            final.b.drafts[0]?.body === "Other host question",
          "Clipboard navigation crossed project ownership",
        );
        const missingPath = projectPath + "-missing";
        await page.goto(url(origins.a, missingPath));
        await page.locator(".project-open-error").waitFor({ state: "attached" });
        assert(
          (await page.locator(".saved-review-summary").count()) === 0 &&
            (await page.locator(".feedback-launch").count()) === 0,
          "An unsaved unavailable project showed an empty recovery panel",
        );
        const historyPath = projectPath + "-history";
        await page.evaluate(
          ({ path, owner, store }) =>
            window.reviewDataQa.writeComments({ ...store, projectPath: path, drafts: [] }, owner),
          { path: historyPath, owner: origins.a, store },
        );
        await page.goto(url(origins.a, historyPath));
        await page
          .getByRole("heading", { name: "Live project unavailable", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Open saved feedback & history", exact: true })
          .click();
        assert(
          await dialog
            .getByRole("button", { name: "Copy saved feedback", exact: true })
            .isDisabled(),
          "Empty drafts produced recovery text",
        );
        await dialog.locator(".review-history summary").click();
        assert(
          (await dialog.locator(".review-history textarea").inputValue()) ===
            (store.history[0]?.text ?? "").replace(/\r\n/g, "\n"),
          "History-only review was inaccessible",
        );
      },
    );
    console.log(
      "Saved-feedback recovery passed: initial failure, offline quotes/history, native copy and project export, clipboard fallback, reconnect, held-check recovery, queued-copy cancellation and unconfigured-host isolation.",
    );
  } finally {
    fixture.agentUnavailable = false;
    fixture.releaseAll();
  }
}
