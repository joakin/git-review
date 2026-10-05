import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type Locator, type Page } from "playwright-core";
import { parseReviewBackup } from "../src/client/backup.ts";
import { responseBody } from "../src/client/api.ts";
import { validateCommentStore, type CommentStore } from "../src/client/comments.ts";
import { parseProjectResponse } from "../src/shared/api.ts";
import { selectCodeText } from "./select-code-text.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-selected-feedback.ts <fixture URL>");
const origin = appUrl(rawUrl).origin;
const path = "src/selection-feedback.ts";
const location = resolve("qa/.artifacts/inventory-fixture", path);
const first = "export const repeated = 'again' + 'again' + '🦊';";
const long = `const long = '${"read code with me; ".repeat(12)}';`;
const original = `${first}\n\tconst spanning = repeated + 1;\n${long}\n   \nlast`;
const project = parseProjectResponse(
  await responseBody(
    await fetch(`${origin}/api/projects/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "inventory-fixture" }),
    }),
  ),
);
const key = `git-review:comments:v1:${project.id}`;
const fileUrl = `${origin}/?${new URLSearchParams({ section: "files", project: project.path, file: path })}`;
const previous = await readFile(location, "utf8").catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
  throw error;
});
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function range(code: Locator, start: number, end: number): Promise<void> {
  await code.scrollIntoViewIfNeeded();
  await code.evaluate(
    (element, offsets) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let startNode: Text | null = null;
      let endNode: Text | null = null;
      let startOffset = 0;
      let endOffset = 0;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (!(node instanceof Text)) continue;
        const next = offset + node.length;
        if (startNode === null && offsets.start < next) {
          startNode = node;
          startOffset = offsets.start - offset;
        }
        if (offsets.end <= next) {
          endNode = node;
          endOffset = offsets.end - offset;
          break;
        }
        offset = next;
      }
      if (startNode === null || endNode === null) throw new Error("Unavailable code range");
      const selected = document.createRange();
      selected.setStart(startNode, startOffset);
      selected.setEnd(endNode, endOffset);
      const selection = document.getSelection();
      if (selection === null) throw new Error("Unavailable native selection");
      selection.removeAllRanges();
      selection.addRange(selected);
    },
    { start, end },
  );
}
async function readStore(page: Page): Promise<CommentStore> {
  const raw: unknown = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
    key,
  );
  const store = validateCommentStore(raw, project.id);
  if (store === null) throw new Error("Invalid selection store");
  return store;
}
async function preview(page: Page): Promise<void> {
  await page.locator(".feedback-launch").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".feedback-dialog[open]") !== null &&
      document.querySelector(".feedback-dialog .review-status") === null,
  );
}
async function save(page: Page, body: string): Promise<void> {
  await page.getByPlaceholder("Add a question, note, or suggestion…").fill(body);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.locator(".comment-editor").waitFor({ state: "detached" });
}

try {
  await writeFile(location, original);
  await withQaBrowser(async (browser) => {
    for (const view of [
      { width: 320, height: 740, touch: true },
      { width: 390, height: 844, touch: true },
      { width: 820, height: 1180, touch: true },
      { width: 1180, height: 820, touch: true },
      { width: 1440, height: 900, touch: false },
    ]) {
      await writeFile(location, original);
      await withQaContext(
        browser,
        {
          viewport: { width: view.width, height: view.height },
          hasTouch: view.touch,
          isMobile: view.touch,
          permissions: ["clipboard-read", "clipboard-write"],
        },
        async (context) => {
          const page = await context.newPage();
          await page.goto(fileUrl);
          const code = page.locator('.file-code-row[data-line="1"] .file-code-line');
          await code.waitFor({ state: "visible" });
          const second = first.lastIndexOf("again");
          await range(code, second, second + 5);
          const comment = page.getByRole("button", {
            name: "Comment on selected text: again",
            exact: true,
          });
          await comment.waitFor({ state: "visible" });
          const search = page.getByRole("button", {
            name: "Search selected text: again",
            exact: true,
          });
          assert(await search.isVisible(), "Search missing beside Comment");
          for (const control of [comment, search]) {
            const box = await control.boundingBox();
            assert(
              box !== null &&
                box.height >= 44 &&
                box.width >= 44 &&
                box.x >= 0 &&
                box.x + box.width <= view.width,
              "Selection control not touch-sized or offscreen",
            );
          }
          if (view.width === 1440) {
            await comment.focus();
            await page.evaluate(() => document.getSelection()?.removeAllRanges());
            await comment.press("Enter");
          } else await comment.tap();
          await page.locator(".comment-editor[open]").waitFor({ state: "visible" });
          assert(
            (await page.locator(".comment-editor mark").textContent()) === "again",
            "Editor lost selected text",
          );
          assert(
            (await page.locator(".comment-editor .review-source").textContent()) === first,
            "Editor lost full source",
          );
          assert(
            (await page.locator(".code-selection-action").count()) === 0,
            "Selection toolbar survived editor open",
          );
          await save(page, "Explain the second occurrence");
          let store = await readStore(page);
          const subject = store.drafts[0]?.subject;
          assert(
            subject?.kind === "selection" && subject.start === second && subject.end === second + 5,
            "Repeated-text offset guessed from first occurrence",
          );

          // Spanning tokens, punctuation and exact leading/trailing whitespace.
          const start = first.indexOf(" + 'again'");
          const fragment = first.slice(start, start + 11);
          await range(code, start, start + 11);
          await page
            .getByRole("button", { name: `Comment on selected text: ${fragment}`, exact: true })
            .click();
          assert(
            (await page.locator(".comment-editor mark").textContent()) === fragment,
            "Whitespace or token boundaries changed fragment",
          );
          await save(page, "Explain this expression");
          await page.reload();
          await code.waitFor({ state: "visible" });
          assert((await readStore(page)).drafts.length === 2, "Reload lost selection comments");
          assert(
            (await page.locator(".file-line-number").first().getAttribute("aria-label"))?.includes(
              "2 comments",
            ) === true,
            "Selection comments absent from marker count",
          );
          await preview(page);
          assert(
            (await page.locator(".feedback-dialog mark").count()) === 2,
            "Preview lost selection highlights",
          );
          const exported = await page.locator("#review-export-text").inputValue();
          assert(
            exported.includes(`selected "again" (columns ${second + 1}–${second + 5})`),
            "Export lost exact occurrence",
          );
          await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
          await page.waitForFunction((key) => {
            const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
            return (
              typeof raw === "object" &&
              raw !== null &&
              "drafts" in raw &&
              Array.isArray(raw.drafts) &&
              raw.drafts.length === 0
            );
          }, key);
          assert(
            (await page.evaluate(() => navigator.clipboard.readText())) === exported,
            "Clipboard changed exported selections",
          );
          store = await readStore(page);
          assert(
            store.history[0]?.comments[0]?.subject.kind === "selection",
            "Copy history lost subject",
          );
          await page.getByRole("button", { name: "Undo last copy", exact: true }).click();
          assert((await readStore(page)).drafts.length === 2, "Undo lost selection comments");
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();

          // Longer valid selections offer Comment without submitting invalid Search.
          const longCode = page.locator('.file-code-row[data-line="3"] .file-code-line');
          await range(longCode, 0, 150);
          const longComment = page.getByRole("button", {
            name: /^Comment on selected text: const long/,
          });
          await longComment.waitFor({ state: "visible" });
          assert(
            (await page.getByRole("button", { name: /^Search selected text:/ }).count()) === 0,
            "Overlong selection offered Search",
          );
          await longComment.click();
          assert(
            (await page.locator(".comment-editor mark").textContent())?.length === 150,
            "Wrapped long selection lost range",
          );
          await save(page, "Explain the longer fragment");
          await range(code, first.indexOf("🦊"), first.indexOf("🦊") + 2);
          await page
            .getByRole("button", { name: "Comment on selected text: 🦊", exact: true })
            .click();
          assert(
            (await page.locator(".comment-editor mark").textContent()) === "🦊",
            "Unicode fragment split",
          );
          await page.getByRole("button", { name: "Close comment editor", exact: true }).click();
          await range(page.locator('.file-code-row[data-line="4"] .file-code-line'), 0, 3);
          await page.waitForTimeout(80);
          assert(
            (await page.locator(".code-selection-action").count()) === 0,
            "Whitespace offered selection action",
          );

          await range(code, second, second + 5);
          await comment.waitFor({ state: "visible" });
          await page.locator(".file-panel-head").click();
          await page.locator(".code-selection-action").waitFor({ state: "detached" });

          // A focused action cannot survive source replacement, even if the text still matches.
          await range(code, second, second + 5);
          await comment.focus();
          await page.evaluate(() => document.getSelection()?.removeAllRanges());
          await writeFile(location, original.replace(first, `${first} // changed`));
          await page.getByRole("button", { name: "Refresh", exact: true }).evaluate((element) => {
            if (!(element instanceof HTMLButtonElement)) throw new Error("Missing refresh control");
            element.click();
          });
          await page.waitForFunction(
            () =>
              document
                .querySelector('.file-code-row[data-line="1"] .file-code-line')
                ?.textContent?.endsWith("// changed") === true,
          );
          await page.locator(".code-selection-action").waitFor({ state: "detached" });
          assert(
            (await page.locator(".comment-editor").count()) === 0,
            "Refresh invoked captured comment",
          );

          await preview(page);
          assert(
            (await page
              .getByRole("button", { name: "Reattach selection", exact: true })
              .count()) === 2,
            "Changed source was not outdated",
          );
          await page
            .getByRole("button", { name: "Reattach selection", exact: true })
            .first()
            .click();
          await code.waitFor({ state: "visible" });
          await page.locator(".file-line-number").first().click();
          assert(
            (await page.locator(".comment-editor").count()) === 0,
            "Selection reattached as whole line",
          );
          assert(
            await page.locator(".reattach-banner").isVisible(),
            "Wrong subject cleared reattachment",
          );
          await range(code, first.indexOf("again"), first.indexOf("again") + 5);
          await comment.click();
          await page.locator(".reattach-banner").waitFor({ state: "detached" });
          store = await readStore(page);
          assert(
            store.drafts[0]?.subject.kind === "selection" &&
              store.drafts[0].subject.start === first.indexOf("again") &&
              store.drafts[0].body === "Explain the second occurrence",
            "Fresh selection reattachment lost body or offsets",
          );

          await writeFile(location, original);
          await page.goto(
            `${origin}/?${new URLSearchParams({ section: "search", project: project.path, q: "again", file: path, line: "1" })}`,
          );
          await code.waitFor({ state: "visible" });
          await range(code, second, second + 5);
          await comment.click();
          assert(
            (await page.locator(".comment-editor .review-anchor").textContent())?.includes(
              "Working tree",
            ) === true,
            "Search selection guessed diff source",
          );
          await save(page, "Search fragment");
          await context.storageState({
            path: `qa/.artifacts/selection-feedback-${view.width}-storage.json`,
          });
          await assertNoHorizontalOverflow(page);
          if (view.width === 390) {
            const beforeExport = await readStore(page);
            await page.locator(".project-switch").click();
            await page.locator(".sidebar-settings").click();
            await page.locator(".settings-install-data").click();
            const dataDialog = page.getByRole("dialog", { name: "Install & local data" });
            const downloading = page.waitForEvent("download");
            await dataDialog
              .getByRole("button", { name: "Export local review data", exact: true })
              .click();
            const downloadPath = await (await downloading).path();
            assert(downloadPath !== null, "Missing selection backup download");
            const bytes = await readFile(downloadPath);
            const raw: unknown = JSON.parse(bytes.toString("utf8"));
            const backup = parseReviewBackup(raw, resolve("qa/.artifacts"));
            assert(
              backup.version === 5 &&
                JSON.stringify(backup.comments[0]) === JSON.stringify(beforeExport),
              "Backup omitted selections",
            );
            await withQaContext(
              browser,
              {
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true,
              },
              async (fresh) => {
                const imported = await fresh.newPage();
                await imported.goto(origin);
                await imported.locator(".project-switch").click();
                await imported.locator(".sidebar-settings").click();
                await imported.locator(".settings-install-data").click();
                const importing = imported.getByRole("dialog", { name: "Install & local data" });
                await importing.locator('input[type="file"]').setInputFiles({
                  name: "selection-review.json",
                  mimeType: "application/json",
                  buffer: bytes,
                });
                await importing
                  .getByRole("button", { name: "Import and replace matching data", exact: true })
                  .click();
                assert(
                  JSON.stringify(await readStore(imported)) === JSON.stringify(beforeExport),
                  "Import changed selections or copy history",
                );
                await imported.goto(fileUrl);
                await imported
                  .locator('.file-code-row[data-line="1"]')
                  .waitFor({ state: "visible" });
                await preview(imported);
                assert(
                  (await imported.locator(".feedback-dialog mark").count()) ===
                    beforeExport.drafts.length,
                  "Imported selections lost highlights",
                );
              },
            );
          }
        },
      );
      console.log(
        `${view.width}: exact range, token spans, touch/focus, save/reload, preview, native clipboard/history/Undo, long/blank ranges, stale action, reattachment, Search source passed`,
      );
    }

    // Diff anchors come from the rendered layer and side; removed rows use Old.
    await withQaContext(browser, qaProfiles.desktop, async (context) => {
      const page = await context.newPage();
      await page.goto(
        `${origin}/?${new URLSearchParams({ section: "changes", project: project.path })}`,
      );
      const card = page.locator('.diff-card[data-layer="unstaged"][data-path="src/view.ts"]');
      await card.locator(".diff-card-toggle").click();
      for (const [kind, side, text] of [
        ["removed", "old", "staged"],
        ["added", "new", "working tree"],
      ] as const) {
        const code = card.locator(`.diff-row-${kind} .diff-code`).filter({ hasText: text });
        await selectCodeText(code, text);
        await page
          .getByRole("button", { name: `Comment on selected text: ${text}`, exact: true })
          .click();
        assert(
          (await page.locator(".comment-editor .review-anchor").textContent())?.includes(
            `unstaged · ${side} line`,
          ) === true,
          "Wrong diff side/layer",
        );
        await save(page, `${side} diff fragment`);
      }
      const store = await readStore(page);
      assert(
        store.drafts.every(
          (draft) => draft.anchor.kind === "diff" && draft.subject.kind === "selection",
        ),
        "Diff selection source corrupted",
      );
      // Native selection of the synthetic diff annotation cannot become a comment.
      const untracked = page.locator(`.diff-card[data-layer="untracked"][data-path="${path}"]`);
      await untracked.locator(".diff-card-toggle").click();
      const noNewline = untracked.locator(".diff-no-newline");
      await noNewline.waitFor({ state: "visible" });
      await selectCodeText(noNewline, "No newline at end");
      await page.waitForTimeout(80);
      assert(
        (await page.locator(".code-selection-action").count()) === 0,
        "Synthetic annotation offered comment",
      );
    });
    console.log("Diff Old/New selection sources and inspection annotation boundaries passed");
  });
} finally {
  if (previous === null) await rm(location, { force: true });
  else await writeFile(location, previous);
}
