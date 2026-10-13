import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { parseProjectResponse } from "@git-review/shared/api";
import { responseBody } from "../apps/web/src/api.ts";
import { validateCommentStore, type CommentStore } from "../apps/web/src/comments.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  projectLookupResponse,
  qaDimensions,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";
import { selectCodeRange } from "./select-code-text.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-multi-line-feedback.ts <QA fixture URL>");
const origin = appUrl(rawUrl).origin;
const project = parseProjectResponse(
  await responseBody(await projectLookupResponse(origin, "multi-line-fixture")),
);
const fixture = resolve("qa/.artifacts/multi-line-fixture");
if (project.absolutePath !== fixture) throw new Error("QA requires the owned multi-line fixture");
const path = "src/range.ts";
const source = await readFile(resolve(fixture, path), "utf8");
const lines = source.trimEnd().split("\n");
const limitsPath = resolve(fixture, "src/limits.ts");
const previous = await readFile(limitsPath, "utf8").catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
  throw error;
});
const key = project.absolutePath;
const url = (section: string, file = path) =>
  `${origin}/?${new URLSearchParams({ section, project: project.relativePath, file, ...(section === "search" ? { q: "replacement", line: "2" } : {}) })}`;
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const code = (page: Page, line: number) =>
  page.locator(`.file-code-row[data-line="${line}"] .file-code-line`);
async function store(page: Page): Promise<CommentStore> {
  const raw: unknown = await page.evaluate((key) => window.reviewDataQa.readComments(key), key);
  const parsed = validateCommentStore(raw, project.absolutePath);
  if (parsed === null) throw new Error("Invalid stored range");
  return parsed;
}
async function comment(page: Page, touch = false) {
  const button = page.getByRole("button", { name: /^Comment on selected text:/ });
  await button.waitFor({ state: "visible" });
  const box = await button.boundingBox();
  assert(box !== null && box.height >= 44 && box.width >= 44, "Range control lost touch target");
  assert(
    (await page.getByRole("button", { name: /^Search selected text:/ }).count()) === 0,
    "Multi-line selection offered Search",
  );
  if (touch) await button.tap();
  else await button.click();
  await page.locator(".comment-editor[open]").waitFor();
}
async function save(page: Page, body: string) {
  await page.getByPlaceholder("Add a question, note, or suggestion…").fill(body);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.locator(".comment-editor").waitFor({ state: "detached" });
}
async function preview(page: Page) {
  await page.locator(".feedback-launch").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".feedback-dialog[open]") !== null &&
      document.querySelector(".feedback-dialog .review-status") === null,
  );
}
try {
  await writeFile(
    limitsPath,
    Array.from({ length: 210 }, (_, i) => `export const limit${i + 1} = ${i};`).join("\n"),
  );
  await withQaBrowser(async (browser) => {
    for (const view of [
      { width: 320, height: 740, touch: true },
      { ...qaDimensions.phone, touch: true },
      { ...qaDimensions.tabletPortrait, touch: true },
      { ...qaDimensions.tabletLandscape, touch: true },
      { ...qaDimensions.desktop, touch: false },
    ]) {
      await writeFile(resolve(fixture, path), source);
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
          await page.goto(url("files"));
          await code(page, 2).waitFor();
          const last = lines[5];
          assert(last !== undefined, "Missing fixture line");
          await selectCodeRange(code(page, 2), 2, code(page, 6), last.length - 1, {
            reverse: view.width === 1440,
          });
          await comment(page, view.touch);
          const selected = [lines[1]?.slice(2), ...lines.slice(2, 5), last.slice(0, -1)].join("\n");
          assert(
            (await page.locator(".comment-editor mark").textContent()) === selected,
            "Range lost exact source fragment or blank interior line",
          );
          await save(page, "Explain this range");
          let saved = await store(page);
          const draft = saved.drafts[0];
          assert(
            draft?.subject.kind === "range" && draft.subject.parts[0]?.anchors.length === 5,
            "Range did not persist all rows",
          );
          for (let line = 2; line <= 6; line++)
            assert(
              (
                await page
                  .locator(`.file-code-row[data-line="${line}"] .file-line-number`)
                  .getAttribute("aria-label")
              )?.includes("1 comments") === true,
              "Covered line has no marker",
            );
          await page.reload();
          await code(page, 2).waitFor();
          assert((await store(page)).drafts[0]?.id === draft.id, "Reload lost range");
          await preview(page);
          const exported = await page.locator("#review-export-text").inputValue();
          assert(
            exported.includes("lines 2–6") && exported.includes(JSON.stringify(selected)),
            "Export lost range or exact selected text",
          );
          await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
          await page.getByRole("button", { name: "Feedback 0", exact: true }).waitFor();
          assert(
            (await page.evaluate(() => navigator.clipboard.readText())) === exported,
            "Clipboard changed range",
          );
          assert(
            (await store(page)).history[0]?.comments[0]?.subject.kind === "range",
            "History lost range",
          );
          await page.getByRole("button", { name: "Undo last copy", exact: true }).click();
          assert((await store(page)).drafts[0]?.id === draft.id, "Undo lost range");
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();

          // Element endpoints and an end at the untouched next row's start.
          const line2 = lines[1];
          assert(line2 !== undefined, "Missing source");
          await selectCodeRange(code(page, 2), 0, code(page, 4), 0, { elementBoundaries: true });
          await comment(page, view.touch);
          await save(page, "Only two touched lines");
          const normalized = (await store(page)).drafts[1];
          assert(
            normalized?.subject.kind === "range" &&
              normalized.subject.parts[0]?.anchors.at(-1)?.line === 3,
            "Untouched endpoint row gained a marker",
          );
          await selectCodeRange(code(page, 4), 0, code(page, 6), 0, { elementBoundaries: true });
          await comment(page, view.touch);
          await page.getByRole("button", { name: "Close comment editor", exact: true }).click();

          // Captured endpoints remain equal while an interior source row changes.
          await selectCodeRange(code(page, 2), 2, code(page, 6), last.length - 1);
          const button = page.getByRole("button", { name: /^Comment on selected text:/ });
          await button.focus();
          await page.evaluate(() => document.getSelection()?.removeAllRanges());
          const changed = source.replace(
            "const adjusted = replacement * 3;",
            "const adjusted = replacement * 4;",
          );
          await writeFile(resolve(fixture, path), changed);
          await page.getByRole("button", { name: "Refresh", exact: true }).evaluate((element) => {
            if (element instanceof HTMLButtonElement) element.click();
          });
          await page.waitForFunction(
            () =>
              document
                .querySelector('.file-code-row[data-line="3"] .file-code-line')
                ?.textContent?.includes("* 4") === true,
          );
          await page.locator(".code-selection-action").waitFor({ state: "detached" });
          assert(
            (await page.locator(".comment-editor").count()) === 0,
            "Source refresh invoked stale action",
          );
          await preview(page);
          assert(
            (await page
              .getByRole("button", { name: "Reattach selection", exact: true })
              .count()) === 2,
            "Middle mutation did not invalidate both saved ranges",
          );
          assert(
            (await page.locator("#review-export-text").count()) === 0 &&
              (await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled()),
            "Outdated range exported",
          );
          await page
            .getByRole("button", { name: "Reattach selection", exact: true })
            .first()
            .click();
          await selectCodeRange(code(page, 2), 2, code(page, 4), 10);
          await page.getByRole("button", { name: /^Comment on selected text:/ }).click();
          await page.locator(".reattach-banner").waitFor({ state: "detached" });
          saved = await store(page);
          assert(
            saved.drafts[0]?.id === draft.id &&
              saved.drafts[0]?.body === draft.body &&
              saved.drafts[0]?.subject.kind === "range" &&
              saved.drafts[0]?.state === "current",
            "Reattachment lost identity, body or current state",
          );
          await page.goto(url("search"));
          await code(page, 2).waitFor();
          await selectCodeRange(code(page, 2), 0, code(page, 3), 10);
          await comment(page, view.touch);
          assert(
            (await page.locator(".comment-editor .review-anchor").textContent())?.includes(
              "Working tree",
            ) === true,
            "Search range guessed diff source",
          );
          await save(page, "Search range");
          await context.storageState({
            path: `qa/.artifacts/multi-line-stage2-${view.width}-storage.json`,
          });
          await assertNoHorizontalOverflow(page);

          // Cross a render block boundary with a blank row and a Unicode endpoint.
          await page.goto(url("files", "src/long.ts"));
          await code(page, 63).waitFor();
          const text = await code(page, 68).textContent();
          assert(text !== null, "Missing long source");
          const end = text.indexOf("🦊") + 2;
          await selectCodeRange(code(page, 63), 7, code(page, 68), end, { reverse: true });
          await comment(page, view.touch);
          assert(
            (await page.locator(".comment-editor mark").textContent())?.endsWith("🦊") === true,
            "Block crossing split Unicode endpoint",
          );
          await save(page, "Across source render blocks");
          await page.goto(url("files", "src/limits.ts"));
          await code(page, 1).waitFor();
          await selectCodeRange(code(page, 1), 0, code(page, 205), 10);
          await page.locator(".code-selection-reason").waitFor({ state: "visible" });
          assert(
            (await page.locator(".code-selection-reason").textContent())?.includes("200") ===
              true && (await page.locator(".code-selection-comment").count()) === 0,
            "Oversized selection lacked actionable limit",
          );
          await assertNoHorizontalOverflow(page);
          console.log(
            `${view.width}: Files/Search range, exact fragments, blank/wrapped/reverse/element endpoints, touched-row normalization, markers, reload, checks, clipboard/history/Undo, middle-source invalidation, reattach, blocks, Unicode and limits passed`,
          );
        },
      );
    }
  });
} finally {
  await writeFile(resolve(fixture, path), source);
  if (previous === null) await rm(limitsPath, { force: true });
  else await writeFile(limitsPath, previous);
}
