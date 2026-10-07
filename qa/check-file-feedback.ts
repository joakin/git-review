import { projectApiUrl } from "../src/shared/project-path.ts";
import { projectLookupResponse } from "./browser-support.ts";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type Page } from "playwright-core";
import { parseReviewBackup } from "../src/client/backup.ts";
import { responseBody } from "../src/client/api.ts";
import { anchorForLine, validateCommentStore, type CommentStore } from "../src/client/comments.ts";
import { parseDiffResponse, parseProjectResponse, parseStatusResponse } from "../src/shared/api.ts";
import { selectCodeText } from "./select-code-text.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaDimensions,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const url = process.argv[2];
const plainUrl = process.argv[3];
if (url === undefined || plainUrl === undefined)
  throw new Error("Usage: bun qa/check-file-feedback.ts <fixture URL> <plain/clean fixture URL>");
const origin = appUrl(url).origin;
const plainOrigin = appUrl(plainUrl).origin;
const path = "src/feedback notes β.txt";
const location = resolve("qa/.artifacts/inventory-fixture", path);
const original = "const lesson = 'source';\r\n\r\nconst answer = 42;\r\n// last line\r\n";
const project = parseProjectResponse(
  await responseBody(await projectLookupResponse(origin, "inventory-fixture")),
);
const status = parseStatusResponse(
  await responseBody(await fetch(origin + projectApiUrl("/status", project.absolutePath))),
);
if (status.kind !== "git") throw new Error("Expected Git fixture");
const diff = parseDiffResponse(
  await responseBody(
    await fetch(
      origin +
        projectApiUrl("/diff", project.absolutePath, {
          layer: "staged",
          path: "src/view.ts",
          revision: status.revision,
          changeToken: status.changeToken,
          language: "text",
        }),
    ),
  ),
);
if (diff.kind !== "text" || diff.hunks[0] === undefined) throw new Error("Missing diff fixture");
const anchor = anchorForLine(
  "staged",
  "src/view.ts",
  diff.hunks[0],
  diff.hunks[0].lines.findIndex((line) => line.kind === "added"),
  "new",
);
if (anchor === null) throw new Error("Missing diff anchor");
const savedDraft = {
  id: "saved",
  anchor,
  subject: { kind: "line" },
  body: "Existing diff feedback",
  createdAt: 1,
  updatedAt: 1,
  state: "current",
};
const seed = {
  version: 4,
  projectPath: project.absolutePath,
  drafts: [savedDraft],
  history: [
    {
      id: "old-copy",
      copiedAt: 2,
      text: "Previously copied text stays exact.\n  ",
      comments: [savedDraft],
    },
  ],
};
const key = `git-review:comments:v2:${encodeURIComponent(project.absolutePath)}`;
const fileUrl = `${origin}/?${new URLSearchParams({ section: "files", project: project.relativePath, file: path })}`;
const views = [
  { width: 320, height: 740, touch: true },
  { ...qaDimensions.phone, touch: true },
  { ...qaDimensions.tabletPortrait, touch: true },
  { ...qaDimensions.tabletLandscape, touch: true },
  { ...qaDimensions.desktop, touch: false },
];
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function readStore(page: Page): Promise<CommentStore> {
  const raw: unknown = await page.evaluate(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown,
    key,
  );
  const store = validateCommentStore(raw, project.absolutePath);
  if (store === null) throw new Error("Invalid saved comments");
  return store;
}
async function preview(page: Page): Promise<string> {
  await page.locator(".feedback-launch").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".feedback-dialog[open]") !== null &&
      document.querySelector(".feedback-dialog .review-status") === null,
  );
  return await page.locator("#review-export-text").inputValue();
}
async function closePreview(page: Page) {
  await page.getByRole("button", { name: "Close feedback", exact: true }).click();
}
async function comment(page: Page, line: number, body: string, touch: boolean) {
  const row = page.locator(`.file-code-row[data-line="${line}"]`);
  await row.scrollIntoViewIfNeeded();
  if (touch) await row.locator(".file-code-line").tap();
  else await row.locator(".file-code-line").click();
  const action = page.getByRole("button", {
    name: `Working tree line ${line}. Comment`,
    exact: true,
  });
  await action.waitFor({ state: "visible" });
  const box = await action.boundingBox();
  assert(
    box !== null && box.height >= 44 && box.x >= 0,
    "Comment action is not touch-sized or contained",
  );
  assert(
    !(await page.getByRole("navigation", { name: "Browsing history" }).isVisible()),
    "History covers a line action",
  );
  await action.click();
  await page
    .getByText(`Working tree · line ${line}`, { exact: true })
    .waitFor({ state: "visible" });
  await page.getByPlaceholder("Add a question, note, or suggestion…").fill(body);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.locator(".comment-editor").waitFor({ state: "detached" });
}
try {
  await writeFile(location, original);
  await withQaBrowser(async (browser) => {
    for (const view of views) {
      await writeFile(location, original);
      const options = {
        viewport: { width: view.width, height: view.height },
        isMobile: view.touch,
        hasTouch: view.touch,
        deviceScaleFactor: 1,
      };
      await withQaContext(browser, options, async (context) => {
        await context.addInitScript(
          ({ storageKey, legacy, appOrigin }) => {
            if (window.location.origin !== appOrigin) return;
            localStorage.setItem(storageKey, JSON.stringify(legacy));
          },
          { storageKey: key, legacy: seed, appOrigin: origin },
        );
        // Seed only once so reload tests the saved expanded store.
        const page = await context.newPage();
        page.setDefaultTimeout(12_000);
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.goto(fileUrl, { waitUntil: "load" });
        await page.locator('.file-code-row[data-line="1"]').waitFor({ state: "visible" });
        assert(
          (await page.locator(".file-code-row").count()) === 4,
          "CRLF created extra file lines",
        );
        const saved: unknown = await page.evaluate(
          (storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown,
          key,
        );
        assert(
          typeof saved === "object" && saved !== null && "version" in saved && saved.version === 4,
          "Current store did not load",
        );
        assert(
          (await readStore(page)).history[0]?.text === seed.history[0]?.text,
          "Loading rewrote saved history text",
        );
        await comment(page, 1, "Explain the lesson source.", view.touch);
        // Keyboard-accessible direct line button also works on a blank line.
        const blank = page.getByRole("button", { name: "Line 2. Add comment", exact: true });
        await blank.focus();
        await blank.press("Enter");
        await page
          .getByPlaceholder("Add a question, note, or suggestion…")
          .fill("Why leave a blank line here?");
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await comment(page, 4, "Note on the last line.", view.touch);
        assert((await readStore(page)).drafts.length === 4, "File comments were not persisted");
        await context.storageState({
          path: `qa/.artifacts/file-feedback-${view.width}-storage.json`,
        });
      });
      // Disable the seed script by using a new page in a fresh state-only context for reload.
      await withQaContext(
        browser,
        {
          ...options,
          storageState: `qa/.artifacts/file-feedback-${view.width}-storage.json`,
        },
        async (restored) => {
          await restored.grantPermissions(["clipboard-read", "clipboard-write"]);
          const p = await restored.newPage();
          p.setDefaultTimeout(12_000);
          await p.goto(fileUrl, { waitUntil: "load" });
          await p.reload({ waitUntil: "load" });
          await p.locator(".file-code-row").first().waitFor({ state: "visible" });
          await p
            .getByRole("button", { name: "Line 1, 1 comments. Add comment", exact: true })
            .waitFor({ state: "visible" });
          const text = await preview(p);
          assert(
            text.includes('[worktree] "src/feedback notes β.txt"') &&
              text.includes("Explain the lesson source.") &&
              text.includes('[staged] "src/view.ts"'),
            "Mixed feedback preview lost its source labels",
          );
          await p.getByRole("button", { name: "Copy feedback", exact: true }).click();
          await p
            .getByRole("button", { name: "Feedback 0", exact: true })
            .waitFor({ state: "visible" });
          assert(
            (await p.evaluate(() => navigator.clipboard.readText())) === text,
            "Clipboard differs from preview",
          );
          assert((await readStore(p)).history.length === 2, "Copy did not archive mixed feedback");
          await p.getByRole("button", { name: "Undo last copy", exact: true }).click();
          await p
            .getByRole("button", { name: "Feedback 4", exact: true })
            .waitFor({ state: "visible" });
          await closePreview(p);
          // Search and Files share working-tree anchor identity and marker count.
          await p.goto(
            `${origin}/?${new URLSearchParams({ section: "search", project: project.relativePath, q: "lesson", file: path, line: "1" })}`,
            { waitUntil: "load" },
          );
          await p
            .getByRole("button", { name: "Line 1, 1 comments. Add comment", exact: true })
            .waitFor({ state: "visible" });
          await comment(p, 1, "Second question from Search.", view.touch);
          await p
            .getByRole("button", { name: "Line 1, 2 comments. Add comment", exact: true })
            .waitFor({ state: "visible" });
          const code = p.locator('.file-code-row[data-line="1"] .file-code-line');
          await selectCodeText(code, "lesson");
          await p
            .getByRole("button", { name: "Search selected text: lesson", exact: true })
            .waitFor({ state: "visible" });
          assert(
            (await p.locator(".file-line-action").count()) === 0,
            "Comment action displaced native selection",
          );
          await p.evaluate(() => document.getSelection()?.removeAllRanges());
          await p.locator(".code-selection-action").waitFor({ state: "detached" });
          await assertNoHorizontalOverflow(p);
          await restored.storageState({
            path: `qa/.artifacts/file-feedback-${view.width}-mixed-storage.json`,
          });
          if (view.width === 390) {
            // Export a mixed backup through the UI, import it into an empty browser, then read its file feedback.
            await p.locator(".project-switch").click();
            await p.locator(".sidebar-settings").click();
            await p.locator(".settings-install-data").click();
            const dataDialog = p.getByRole("dialog", { name: "Install & local data" });
            const downloading = p.waitForEvent("download");
            await dataDialog
              .getByRole("button", { name: "Export local review data", exact: true })
              .click();
            const download = await downloading;
            const downloadPath = await download.path();
            assert(downloadPath !== null, "Mixed backup download did not complete");
            const bytes = await Bun.file(downloadPath).arrayBuffer();
            const backup = parseReviewBackup(
              JSON.parse(new TextDecoder().decode(bytes)) as unknown,
              resolve("qa/.artifacts"),
            );
            assert(
              backup.version === 6 &&
                backup.comments[0]?.drafts.some((draft) => draft.anchor.kind === "file") === true &&
                backup.comments[0]?.drafts.some((draft) => draft.anchor.kind === "diff") === true,
              "Export omitted mixed comment sources",
            );
            await withQaContext(
              browser,
              {
                viewport: qaDimensions.phone,
                isMobile: true,
                hasTouch: true,
              },
              async (imported) => {
                const fresh = await imported.newPage();
                fresh.setDefaultTimeout(12_000);
                await fresh.goto(origin, { waitUntil: "load" });
                await fresh.locator(".project-switch").click();
                await fresh.locator(".sidebar-settings").click();
                await fresh.locator(".settings-install-data").click();
                const importing = fresh.getByRole("dialog", { name: "Install & local data" });
                await importing.locator('input[type="file"]').setInputFiles({
                  name: "mixed-review.json",
                  mimeType: "application/json",
                  buffer: Buffer.from(bytes),
                });
                await importing
                  .getByRole("button", { name: "Import and replace matching data", exact: true })
                  .click();
                assert(
                  JSON.stringify(await readStore(fresh)) === JSON.stringify(backup.comments[0]),
                  "Mixed import changed draft anchors or history",
                );
                await fresh.goto(fileUrl, { waitUntil: "load" });
                await fresh
                  .getByRole("button", { name: "Line 1, 2 comments. Add comment", exact: true })
                  .waitFor({ state: "visible" });
                const importedText = await preview(fresh);
                assert(
                  importedText.includes("Explain the lesson source.") &&
                    importedText.includes("Existing diff feedback"),
                  "Imported mixed feedback was not reviewable",
                );
              },
            );
            await p.goto(fileUrl, { waitUntil: "load" });
            await p.locator('.file-code-row[data-line="1"]').waitFor({ state: "visible" });
            await writeFile(location, original.replace("'source'", "'changed'"));
            const staleText = await preview(p);
            assert(
              !staleText.includes("Explain the lesson source.") &&
                !staleText.includes("Second question from Search.") &&
                staleText.includes("Note on the last line."),
              "Changed anchors entered export or unrelated lines became stale",
            );
            const old = (await readStore(p)).drafts.find(
              (draft) => draft.body === "Explain the lesson source.",
            );
            assert(
              old !== undefined && old.state === "outdated",
              "Changed file did not become outdated",
            );
            const item = p
              .locator(".review-item")
              .filter({ has: p.getByText("Explain the lesson source.", { exact: true }) });
            await item.getByRole("button", { name: "Reattach to line", exact: true }).click();
            await p.locator(".reattach-banner").waitFor({ state: "visible" });
            // A file comment cannot be converted into a diff comment by browsing away during reattachment.
            await p.getByRole("button", { name: "Open list", exact: true }).click();
            await p.getByRole("button", { name: "Changes", exact: true }).click();
            // Feedback checked the edited file independently; accept a fresh Changes snapshot too.
            await p.getByRole("button", { name: "Review all changes", exact: true }).click();
            const [refreshed] = await Promise.all([
              p.waitForResponse((response) => {
                const url = new URL(response.url());
                return (
                  url.pathname === "/api/project/status" &&
                  !url.searchParams.has("mode") &&
                  url.searchParams.get("projectPath") === project.absolutePath &&
                  response.ok()
                );
              }),
              p.getByRole("button", { name: "Refresh", exact: true }).click(),
            ]);
            assert(
              parseStatusResponse(await refreshed.json()).kind === "git",
              "Changes refresh did not load the edited fixture",
            );
            await p
              .getByRole("button", { name: "Refresh", exact: true })
              .waitFor({ state: "visible" });
            await p.getByRole("button", { name: "Open list", exact: true }).click();
            const stagedCard = p.locator(
              'main .diff-card[data-layer="staged"][data-path="src/view.ts"]',
            );
            await p
              .getByRole("button", { name: "Open staged diff for src/view.ts", exact: true })
              .click();
            await stagedCard.locator(".diff-row-added .diff-code").tap();
            await stagedCard.getByRole("button", { name: /Comment on new line 1/ }).click();
            await p
              .getByText("Choose a line from the same feedback source", { exact: false })
              .waitFor({ state: "visible" });
            assert(
              (await readStore(p)).drafts.find((draft) => draft.id === old.id)?.anchor.kind ===
                "file" && (await p.locator(".reattach-banner").isVisible()),
              "Reattachment changed a file anchor into a diff anchor",
            );
            await p.locator(".feedback-launch").click();
            await p
              .locator(".review-item")
              .filter({ has: p.getByText("Explain the lesson source.", { exact: true }) })
              .getByRole("button", { name: "Reattach to line", exact: true })
              .click();
            assert(
              new URL(p.url()).searchParams.get("section") === "files",
              "File reattachment opened a diff",
            );
            await p
              .locator('.file-code-row[data-line="1"] .file-code-line')
              .filter({ hasText: "changed" })
              .waitFor({ state: "visible" });
            await p.locator('.file-code-row[data-line="3"] .file-code-line').tap();
            await p
              .getByRole("button", { name: "Working tree line 3. Comment", exact: true })
              .click();
            await p.locator(".reattach-banner").waitFor({ state: "detached" });
            const moved = (await readStore(p)).drafts.find((draft) => draft.id === old.id);
            assert(
              moved !== undefined &&
                moved.anchor.kind === "file" &&
                moved.anchor.line === 3 &&
                moved.body === old.body &&
                moved.createdAt === old.createdAt,
              "Reattachment lost file comment identity",
            );
            await preview(p);
            await closePreview(p);
            const beforeFailure = await readStore(p);
            await p.route("**/api/project/file?*", async (route) => {
              await route.fulfill({
                status: 403,
                json: { error: { code: "forbidden", message: "Test read denied" } },
              });
            });
            await p.locator(".feedback-launch").click();
            await p.getByText("Could not check", { exact: false }).waitFor({ state: "visible" });
            assert(
              JSON.stringify(await readStore(p)) === JSON.stringify(beforeFailure),
              "Read failure changed drafts",
            );
            assert(
              !(await p.getByRole("button", { name: "Copy feedback", exact: true }).isEnabled()),
              "Read failure allowed copy",
            );
            await p.unroute("**/api/project/file?*");
            await p.getByRole("button", { name: "Retry", exact: true }).click();
            await p.locator("#review-export-text").waitFor({ state: "visible" });
            await closePreview(p);
            await rm(location);
            await preview(p);
            assert(
              (await readStore(p)).drafts
                .filter((draft) => draft.anchor.kind === "file")
                .every((draft) => draft.state === "outdated"),
              "Missing file anchors were not outdated",
            );
            await closePreview(p);
            await writeFile(location, original);
          }
        },
      );
      console.log(
        `File feedback, current storage, reload, mixed preview/copy/Undo, Search identity, selection and containment passed at ${view.width}px`,
      );
    }
    // Real unchanged Git and non-Git text require no status call for their file-only feedback.
    for (const projectPath of ["plain-folder", "clean-git"]) {
      await withQaContext(
        browser,
        {
          viewport: qaDimensions.phone,
          isMobile: true,
          hasTouch: true,
        },
        async (context) => {
          const p = await context.newPage();
          p.setDefaultTimeout(12_000);
          await p.goto(
            `${plainOrigin}/?${new URLSearchParams({ section: "files", project: projectPath, file: "readme.txt" })}`,
            { waitUntil: "load" },
          );
          await p.locator('.file-code-row[data-line="1"]').waitFor({ state: "visible" });
          await comment(p, 1, `Read ${projectPath} without a diff.`, true);
          let statusRequests = 0;
          await p.route("**/api/project/status?*", async (route) => {
            statusRequests += 1;
            await route.abort();
          });
          const text = await preview(p);
          assert(
            text.includes(`[worktree] "readme.txt"`) &&
              text.includes(`Read ${projectPath} without a diff.`),
            "File-only preview failed",
          );
          assert(statusRequests === 0, "File-only feedback depends on Git status");
        },
      );
      console.log(`Real ${projectPath} file-only feedback passed without Git status`);
    }
  });
} finally {
  await writeFile(location, original);
}
