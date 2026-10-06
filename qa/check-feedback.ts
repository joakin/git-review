import type { Route } from "playwright-core";
import { appUrl, qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";
import { validateCommentStore } from "../src/client/comments.ts";
import { parseDiffResponse } from "../src/shared/api.ts";
import {
  parseChangeDiffBatchRequest,
  changeDiffBatchSource,
  changeDiffRequestKey,
} from "../src/shared/change-diff-batch.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-feedback.ts <local app URL>");
const base = appUrl(rawUrl);
const url = base.href;

await withQaBrowser(async (browser) => {
  const { preview, activeSession } = await withQaContext(
    browser,
    qaProfiles.phone,
    async (context) => {
      await context.addInitScript(() => {
        Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(url, { waitUntil: "load" });
      if ((await page.evaluate(() => typeof crypto.randomUUID)) !== "undefined")
        throw new Error("The insecure-origin UUID regression setup failed");
      await page.getByRole("button", { name: /inventory-fixture/ }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      await page.getByRole("button", { name: "Review all changes", exact: true }).click();
      const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
      await card.waitFor({ state: "visible" });
      await card.locator(".diff-card-toggle").click();
      await card.locator(".diff-row-added").first().tap();
      await card.getByRole("button", { name: /staged added line.*Comment on new line 1/ }).click();
      await page.waitForFunction(() => document.documentElement.style.overflow === "hidden");
      await page
        .getByPlaceholder("Add a question, note, or suggestion…")
        .fill("Please explain the staged value.");
      await page.getByRole("button", { name: "Save comment" }).click();
      await page.locator(".comment-editor").waitFor({ state: "detached" });
      await page.waitForFunction(() => document.documentElement.style.overflow !== "hidden");
      await card.locator(".diff-row-added").first().tap();
      await card.getByRole("button", { name: /staged added line.*Comment on new line 1/ }).click();
      await page.locator(".comment-editor[open]").waitFor({ state: "visible" });
      await page.mouse.click(5, 100);
      await page.locator(".comment-editor").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
      await page.reload({ waitUntil: "load" });
      await page.getByRole("button", { name: "Feedback 1" }).click();
      const copy = page.getByRole("button", { name: "Copy feedback" });
      await copy.waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector(".feedback-dialog .review-status"));
      const preview = await page.locator("#review-export-text").inputValue();
      if (
        !preview.includes('[staged] "src/view.ts"') ||
        !preview.includes("new line 1  \"export const view = 'staged';\"") ||
        !preview.includes("Please explain the staged value.")
      )
        throw new Error(`Incorrect feedback preview: ${preview}`);
      await context.storageState({ path: "qa/.artifacts/feedback-storage.json" });
      const activeSession = await page.evaluate(() =>
        sessionStorage.getItem("git-review:active-project:v1"),
      );
      if (activeSession === null) throw new Error("Expected an active project in this tab");
      await copy.click();
      await page.getByRole("button", { name: "Feedback 0" }).waitFor({ state: "visible" });
      if ((await page.locator(".review-history-item").count()) !== 1)
        throw new Error("Successful copy did not create history");
      await page.getByRole("button", { name: "Undo last copy" }).click();
      await page.getByRole("button", { name: "Feedback 1" }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Close feedback" }).click();

      return { preview, activeSession };
    },
  );

  await withQaContext(
    browser,
    { ...qaProfiles.phone, storageState: "qa/.artifacts/feedback-storage.json" },
    async (fallback) => {
      await fallback.addInitScript(
        ({ origin, activeSession }) => {
          if (location.origin === origin)
            sessionStorage.setItem("git-review:active-project:v1", activeSession);
        },
        { origin: base.origin, activeSession },
      );
      await fallback.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      });
      const fallbackPage = await fallback.newPage();
      fallbackPage.setDefaultTimeout(10_000);
      await fallbackPage.goto(url, { waitUntil: "load" });
      await fallbackPage.getByRole("button", { name: "Feedback 1" }).click();
      await fallbackPage.getByRole("button", { name: "Copy feedback" }).click();
      await fallbackPage
        .getByText("Clipboard access is unavailable here", { exact: false })
        .waitFor({ state: "visible" });
      if ((await fallbackPage.getByRole("button", { name: "Feedback 1" }).count()) !== 1)
        throw new Error("Clipboard failure cleared a draft");
      if ((await fallbackPage.locator("#review-export-text").inputValue()) !== preview)
        throw new Error("Clipboard failure removed selectable text");
      await fallbackPage.getByRole("button", { name: "Close feedback" }).click();
      const emptyStatus = async (route: Route): Promise<void> => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            kind: "git",
            revision: "00000000000000000000",
            changeToken: "00000000000000000000",
            entries: [],
          }),
        });
      };
      await fallbackPage.route("**/api/projects/*/status", emptyStatus);
      await fallbackPage.getByRole("button", { name: "Feedback 1" }).click();
      await fallbackPage
        .getByText("Line changed or disappeared.", { exact: false })
        .waitFor({ state: "visible" });
      if (await fallbackPage.getByRole("button", { name: "Copy feedback" }).isEnabled())
        throw new Error("Outdated feedback remained copyable");
      if ((await fallbackPage.locator("#review-export-text").count()) !== 0)
        throw new Error("Outdated feedback remained selectable for export");

      const storedKey = await fallbackPage.evaluate(() =>
        Object.keys(localStorage).find((key) => key.startsWith("git-review:comments:v1:")),
      );
      if (storedKey === undefined) throw new Error("Missing persisted review for reattachment");
      const commentKey: string = storedKey;
      async function savedStore() {
        const value: unknown = await fallbackPage.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
          commentKey,
        );
        const store = validateCommentStore(
          value,
          commentKey.slice("git-review:comments:v1:".length),
        );
        if (store === null) throw new Error("Reattachment produced an invalid persisted review");
        return store;
      }
      const original = (await savedStore()).drafts[0];
      if (original === undefined) throw new Error("Missing outdated draft");
      // A controlled diff supplies both side-specific rows and shared context without changing the Git fixture.
      const reattachmentDiff = parseDiffResponse({
        kind: "text",
        syntax: { kind: "plain", reason: "selected" },
        hunks: [
          {
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 2,
            lines: [
              { kind: "context", oldLine: 1, newLine: 1, text: "export const stable = true;" },
              { kind: "removed", oldLine: 2, newLine: null, text: "export const before = 'old';" },
              { kind: "added", oldLine: null, newLine: 2, text: "export const after = 'new';" },
            ].map((line) => ({
              ...line,
              tokens: [{ text: line.text, role: "plain" }],
              detail: { kind: "none" },
              noNewlineAtEnd: false,
            })),
          },
        ],
      });
      await fallbackPage.route("**/api/projects/*/diff?*", async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get("layer") === "staged" && params.get("path") === "src/view.ts")
          await route.fulfill({ json: reattachmentDiff });
        else await route.continue();
      });
      await fallbackPage.route("**/api/projects/*/diffs", async (route) => {
        const request = parseChangeDiffBatchRequest(route.request().postDataJSON() as unknown);
        if (request.files.every((file) => file.layer === "staged" && file.path === "src/view.ts")) {
          const id = new URL(route.request().url()).pathname.split("/")[3];
          if (id === undefined) throw new Error("Missing project identity");
          await route.fulfill({
            json: {
              kind: "ready",
              source: changeDiffBatchSource(id, request.revision, request.changeToken),
              results: request.files.map((file) => ({
                key: changeDiffRequestKey(file),
                kind: "ready",
                value: reattachmentDiff,
              })),
            },
          });
        } else await route.continue();
      });
      await fallbackPage.unroute("**/api/projects/*/status", emptyStatus);
      await fallbackPage.reload({ waitUntil: "load" });
      await fallbackPage.getByRole("button", { name: "Feedback 1", exact: true }).click();
      await fallbackPage.getByRole("button", { name: "Reattach to line", exact: true }).click();
      const reattach = fallbackPage
        .getByRole("status")
        .filter({ hasText: "Choose a line from this feedback source, then Comment to reattach." });
      await reattach.waitFor({ state: "visible" });
      await reattach.getByRole("button", { name: "Cancel", exact: true }).click();
      await reattach.waitFor({ state: "detached" });
      if (JSON.stringify((await savedStore()).drafts[0]) !== JSON.stringify(original))
        throw new Error("Cancel reattachment changed the outdated draft");

      await fallbackPage.getByRole("button", { name: "Feedback 1", exact: true }).click();
      await fallbackPage.getByRole("button", { name: "Reattach to line", exact: true }).click();
      const fallbackCard = fallbackPage.locator(
        'main .diff-card[data-layer="staged"][data-path="src/view.ts"]',
      );
      await fallbackCard.locator(".diff-row-removed .diff-code").tap();
      await fallbackCard.getByRole("button", { name: /Comment on old line 2/ }).click();
      await reattach.waitFor({ state: "detached" });
      const moved = (await savedStore()).drafts[0];
      if (
        moved?.id !== original.id ||
        moved.body !== original.body ||
        moved.createdAt !== original.createdAt ||
        moved.anchor.kind !== "diff" ||
        moved.anchor.side !== "old" ||
        moved.anchor.line !== 2 ||
        moved.state !== "current"
      )
        throw new Error("Removed-row reattachment lost the draft or its Old-side anchor");
      await fallbackPage.getByRole("button", { name: "Feedback 1", exact: true }).click();
      await fallbackPage.locator("#review-export-text").waitFor({ state: "visible" });
      const removedPreview = await fallbackPage.locator("#review-export-text").inputValue();
      if (
        !removedPreview.includes("old line 2  \"export const before = 'old';\"") ||
        !removedPreview.includes(original.body)
      )
        throw new Error("Checked export did not use the reattached removed-row anchor");

      await fallbackPage.getByRole("button", { name: "Close feedback", exact: true }).click();
      await fallbackPage.route("**/api/projects/*/status", emptyStatus);
      await fallbackPage.getByRole("button", { name: "Feedback 1", exact: true }).click();
      await fallbackPage
        .getByRole("button", { name: "Reattach to line", exact: true })
        .waitFor({ state: "visible" });
      await fallbackPage.unroute("**/api/projects/*/status", emptyStatus);
      await fallbackPage.getByRole("button", { name: "Reattach to line", exact: true }).click();
      await fallbackCard.locator(".diff-row-context .diff-code").tap();
      await fallbackCard.getByRole("button", { name: /Comment on old line 1/ }).click();
      await reattach.waitFor({ state: "detached" });
      await fallbackPage.getByRole("button", { name: "Feedback 1", exact: true }).click();
      await fallbackPage.locator("#review-export-text").waitFor({ state: "visible" });
      const contextPreview = await fallbackPage.locator("#review-export-text").inputValue();
      if (
        !contextPreview.includes('old line 1  "export const stable = true;"') ||
        contextPreview.includes("new line 1") ||
        !contextPreview.includes(original.body)
      )
        throw new Error("Context reattachment did not preserve the draft's Old side");
      await fallbackPage.getByRole("button", { name: "Edit", exact: true }).click();
      await fallbackPage
        .getByPlaceholder("Add a question, note, or suggestion…")
        .fill("This unsaved edit must disappear with Delete.");
      await fallbackPage.getByRole("button", { name: "Delete", exact: true }).click();
      await fallbackPage.locator(".comment-editor").waitFor({ state: "detached" });
      await fallbackPage.reload({ waitUntil: "load" });
      await fallbackPage
        .getByRole("button", { name: "Feedback 0", exact: true })
        .waitFor({ state: "visible" });
      if ((await savedStore()).drafts.length !== 0)
        throw new Error("Delete saved the edited draft again or failed to persist its removal");
    },
  );
  console.log(
    "Mobile comment, reload, preview, copy history, Undo, clipboard fallback, outdated exclusion, Cancel/Old-side reattachment with checked export, and persistent Delete passed.",
  );
});
