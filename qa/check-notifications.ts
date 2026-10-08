import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseRootResponse } from "../src/shared/api.ts";
import { responseBody } from "../src/client/api.ts";
import { routeUrl } from "../src/client/navigation.ts";
import { testGit } from "../src/test-support.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
const profileFilter = process.argv[3];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-notifications.ts <isolated fixture server URL>");
const base = appUrl(rawUrl);
const root = parseRootResponse(await responseBody(await fetch(new URL("/api/roots", base))));
const fixture = await mkdtemp(join(root.path, "notifications-"));
const projectPath = basename(fixture);
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const fileUrl = new URL(
  routeUrl({
    section: "files",
    projectPath,
    directory: "",
    target: { kind: "file", path: "sample.ts", line: null },
  }),
  base,
).href;
const settingsUrl = new URL(routeUrl({ section: "settings", projectPath }), base).href;

try {
  testGit(fixture, "init", "-q");
  await writeFile(join(fixture, "sample.ts"), "export const value = 'initial';\n");
  testGit(fixture, "add", ".");
  testGit(fixture, "commit", "-qm", "notifications baseline");
  await writeFile(join(fixture, "sample.ts"), "export const value = 'changed';\n");
  await withQaBrowser(async (browser) => {
    for (const [name, profile] of Object.entries({
      ...qaProfiles,
      narrow: { viewport: { width: 320, height: 740 }, hasTouch: true },
      keyboard: qaProfiles.phone,
      fallback: qaProfiles.phone,
    })) {
      if (profileFilter !== undefined && name !== profileFilter) continue;
      await withQaContext(browser, { ...profile, acceptDownloads: true }, async (context) => {
        if (name === "fallback")
          await context.addInitScript(() => {
            Object.defineProperty(HTMLElement.prototype, "showPopover", {
              configurable: true,
              value: undefined,
            });
          });
        if (name === "keyboard")
          await context.addInitScript(() => {
            Object.defineProperty(window, "visualViewport", {
              configurable: true,
              value: Object.assign(new EventTarget(), {
                width: 390,
                height: 460,
                offsetTop: 0,
                offsetLeft: 0,
              }),
            });
          });
        const page = await context.newPage();
        page.setDefaultTimeout(12_000);
        await page.goto(fileUrl);
        await page.locator(".file-code-line").waitFor();
        const headingTop = await page
          .locator(".changes-heading")
          .evaluate((e) => e.getBoundingClientRect().top);
        const failure = `Notifications QA: ${"long-path-segment/".repeat(8)} could not be read. Retry when the host is available.`;
        await page.route("**/api/project/file?*", async (route) => {
          await route.fulfill({
            status: 503,
            json: { error: { code: "internal_error", message: failure } },
          });
        });
        await page.locator("main").getByRole("button", { name: "Refresh", exact: true }).click();
        const error = page.locator(".notification", { hasText: failure });
        await error.waitFor();
        assert(
          (await page
            .locator(".changes-heading")
            .evaluate((e) => e.getBoundingClientRect().top)) === headingTop,
          `${name}: alert moved the heading`,
        );
        assert(
          (await page.locator("main [role=alert], .sidebar [role=alert]").count()) === 0,
          `${name}: inline alerts remain`,
        );
        const fit = await error.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const dismiss = e.querySelector(".notification-dismiss")?.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            width: innerWidth,
            height: window.visualViewport?.height ?? innerHeight,
            dismiss,
          };
        });
        assert(
          fit.left >= 0 &&
            fit.right <= fit.width &&
            fit.bottom <= fit.height &&
            (fit.dismiss?.width ?? 0) >= 44 &&
            (fit.dismiss?.height ?? 0) >= 44,
          `${name}: invalid toast geometry ${JSON.stringify(fit)}`,
        );
        await error.getByRole("button", { name: "Dismiss notification" }).click();
        await page
          .locator("main")
          .getByRole("button", { name: /^Wrap:/ })
          .click();
        assert(
          (await page.locator(".notification").count()) === 0,
          `${name}: rerender recreated a dismissed condition`,
        );
        await page.unroute("**/api/project/file?*");
        await page.locator("main").getByRole("button", { name: "Refresh", exact: true }).click();
        await page.locator(".file-code-line").waitFor();

        await page.route("**/api/project/file?*", async (route) => {
          await route.fulfill({
            status: 503,
            json: { error: { code: "internal_error", message: failure } },
          });
        });
        await page.route("**/api/project/tree?*", async (route) => {
          await route.fulfill({
            status: 503,
            json: {
              error: { code: "internal_error", message: "Notifications QA: directory read failed" },
            },
          });
        });
        await page.locator("main").getByRole("button", { name: "Refresh", exact: true }).click();
        const directoryError = page.locator(".notification", {
          hasText: "Notifications QA: directory read failed",
        });
        await error.waitFor();
        await directoryError.waitFor();
        assert(
          (await page.locator(".notification").count()) === 2,
          `${name}: simultaneous errors did not share the stack`,
        );
        await directoryError.getByRole("button", { name: "Dismiss notification" }).click();
        assert(
          (await page.locator(".notification").count()) === 1,
          `${name}: dismissal cleared another notification`,
        );
        await page.unroute("**/api/project/file?*");
        await page.unroute("**/api/project/tree?*");
        await error.getByRole("button", { name: "Retry", exact: true }).click();
        await page.locator(".file-code-line").waitFor();
        await error.waitFor({ state: "detached" });

        // A stale destination is scoped to the file and clears on navigation.
        const stale = new URL(
          routeUrl({
            section: "files",
            projectPath,
            directory: "",
            target: { kind: "file", path: "sample.ts", line: 999 },
          }),
          base,
        ).href;
        await page.goto(stale);
        await page
          .locator(".notification-warning", { hasText: "This line is no longer" })
          .waitFor();
        await page
          .locator("main")
          .getByRole("button", { name: /^Wrap:/ })
          .click();
        assert(
          (await page.locator(".notification-warning").count()) === 1,
          `${name}: duplicate stale notice`,
        );
        await page.goto(settingsUrl);
        assert(
          (await page.locator(".notification").count()) === 0,
          `${name}: old resource notice survived navigation`,
        );
        if (name === "desktop") await page.locator("#app-theme").selectOption("dark");
        await page.locator(".settings-install-data").click();
        const dialog = page.locator(".install-data-dialog[open]");
        await dialog.waitFor();
        const dialogSize = await dialog.boundingBox();
        await dialog.locator('input[type="file"]').setInputFiles({
          name: "invalid.json",
          mimeType: "application/json",
          buffer: Buffer.from("{}"),
        });
        const invalid = page.locator(".notification-error");
        await invalid.waitFor();
        assert(
          await invalid.evaluate(
            (e, fallback) =>
              e.closest("dialog")?.open === true &&
              (fallback
                ? e.closest(".notification-viewport")?.hasAttribute("popover") === false
                : e.closest(".notification-viewport")?.matches(":popover-open") === true),
            name === "fallback",
          ),
          `${name}: notification did not enter modal top layer`,
        );
        assert(
          JSON.stringify(await dialog.boundingBox()) === JSON.stringify(dialogSize),
          `${name}: toast changed dialog layout`,
        );
        const hit = await invalid.locator(".notification-dismiss").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e;
        });
        assert(hit, `${name}: modal blocked notification controls`);
        await invalid.getByRole("button", { name: "Dismiss notification" }).click();
        assert(await dialog.isVisible(), `${name}: toast dismissal closed the modal`);

        // Success remains interactive, pauses on keyboard focus, and expires afterwards.
        const download = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Export local review data" }).click();
        await download;
        const success = page.locator(".notification-success");
        await success.waitFor();
        const alignment = await success.evaluate((e) => {
          const message = e.querySelector("p")?.getBoundingClientRect();
          const icon = e.querySelector(".notification-icon")?.getBoundingClientRect();
          const dismiss = e.querySelector(".notification-dismiss")?.getBoundingClientRect();
          const card = e.getBoundingClientRect();
          const viewport = e.closest(".notification-viewport")?.getBoundingClientRect();
          const center = (rect: DOMRect | undefined) =>
            rect === undefined ? Number.NaN : rect.top + rect.height / 2;
          return {
            iconOffset: Math.abs(center(message) - center(icon)),
            dismissOffset: Math.abs(center(message) - center(dismiss)),
            shadowTop: card.top - (viewport?.top ?? card.top),
            shadowBottom: (viewport?.bottom ?? card.bottom) - card.bottom,
          };
        });
        assert(
          alignment.iconOffset <= 1 &&
            alignment.dismissOffset <= 1 &&
            alignment.shadowTop >= 24 &&
            alignment.shadowBottom >= 24,
          `${name}: misaligned or clipped confirmation ${JSON.stringify(alignment)}`,
        );
        await success.getByRole("button", { name: "Dismiss notification" }).focus();
        await page.waitForTimeout(6_200);
        assert(await success.isVisible(), `${name}: focused notification expired`);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        await success.waitFor();
        assert(
          await success.evaluate(
            (e, fallback) =>
              e.closest("dialog") === null &&
              (fallback
                ? e.closest(".notification-viewport")?.hasAttribute("popover") === false
                : e.closest(".notification-viewport")?.matches(":popover-open") === true),
            name === "fallback",
          ),
          `${name}: notice did not return to the page`,
        );
        await success.getByRole("button", { name: "Dismiss notification" }).click();

        // Existing notices are promoted when another dialog opens, without taking focus.
        const secondDownload = page.waitForEvent("download");
        await page.locator(".settings-install-data").click();
        await page
          .locator(".install-data-dialog[open]")
          .getByRole("button", { name: "Export local review data" })
          .click();
        await secondDownload;
        await success.waitFor();
        await page.getByRole("button", { name: "Close install and local data" }).click();
        await success.waitFor();
        await page.locator(".settings-install-data").click();
        await page.locator(".install-data-dialog[open]").waitFor();
        await success.waitFor();
        assert(
          await success.evaluate((e) => e.closest("dialog")?.open === true),
          `${name}: existing notice stayed below a new modal`,
        );
        await page.getByRole("button", { name: "Close install and local data" }).click();
        await page.mouse.move(1, 1);
        await success.waitFor({ state: "detached", timeout: 7_000 });
        await assertNoHorizontalOverflow(page);
        console.log(
          `${name}: notification layout, scope, modal layering, dismissal and timeout passed`,
        );
      });
    }
  });
} finally {
  await rm(fixture, { recursive: true, force: true });
}
