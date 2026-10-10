import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { parseProjectResponse } from "../src/shared/api.ts";
import { responseBody } from "../src/client/api.ts";
import {
  commentStoragePrefix,
  formatFeedback,
  validateCommentStore,
  type CommentStore,
} from "../src/client/comments.ts";
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
  throw new Error("Usage: bun qa/check-multi-line-diff-feedback.ts <QA fixture URL>");
const origin = appUrl(rawUrl).origin;
const project = parseProjectResponse(
  await responseBody(await projectLookupResponse(origin, "multi-line-fixture")),
);
const contextProject = parseProjectResponse(
  await responseBody(await projectLookupResponse(origin, "context-fixture")),
);
const fixture = resolve("qa/.artifacts/multi-line-fixture");
if (
  project.absolutePath !== fixture ||
  contextProject.absolutePath !== resolve("qa/.artifacts/context-fixture")
)
  throw new Error("QA requires owned fixtures");
const path = "src/range.ts";
const source = await readFile(resolve(fixture, path), "utf8");
const untrackedPath = resolve(fixture, "src/untracked-range.ts");
const previous = await readFile(untrackedPath, "utf8").catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
  throw error;
});
const key = commentStoragePrefix + encodeURIComponent(project.absolutePath);
const contextKey = commentStoragePrefix + encodeURIComponent(contextProject.absolutePath);
const url = (folder: string, layer: string, file: string) =>
  `${origin}/?${new URLSearchParams({ section: "changes", project: folder, layer, file })}`;
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function store(page: Page, context = false): Promise<CommentStore> {
  const raw: unknown = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
    context ? contextKey : key,
  );
  const parsed = validateCommentStore(
    raw,
    context ? contextProject.absolutePath : project.absolutePath,
  );
  if (parsed === null) throw new Error("Invalid stored diff range");
  return parsed;
}
async function comment(page: Page, touch = false) {
  const button = page.getByRole("button", { name: /^Comment on selected text:/ });
  await button.waitFor({ state: "visible" });
  assert(
    (await page.getByRole("button", { name: /^Search selected text:/ }).count()) === 0,
    "Multi-line diff offered Search",
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
  await writeFile(untrackedPath, "first 🦊\n\nlast");
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
          page.setDefaultTimeout(15_000);
          await page.goto(url(project.relativePath, "unstaged", path));
          const card = page.locator(`.diff-card[data-layer="unstaged"][data-path="${path}"]`);
          const code = (side: "old" | "new", line: number) =>
            card.locator(`.diff-row[data-${side}-line="${line}"] .diff-code`);
          await code("old", 1).waitFor();
          await selectCodeRange(code("old", 1), 7, code("old", 3), 10);
          await comment(page, view.touch);
          await save(page, "Old range");
          await selectCodeRange(code("new", 6), 2, code("new", 7), 1);
          await comment(page, view.touch);
          await save(page, "New range");
          let saved = await store(page);
          const old = saved.drafts[0];
          const next = saved.drafts[1];
          assert(
            old?.subject.kind === "range" &&
              old.anchor.kind === "diff" &&
              old.anchor.side === "old" &&
              old.subject.parts.length === 1,
            "Removed/context range chose the wrong side",
          );
          assert(
            next?.subject.kind === "range" &&
              next.anchor.kind === "diff" &&
              next.anchor.side === "new" &&
              next.subject.parts.length === 1,
            "Added/context range chose the wrong side",
          );
          await selectCodeRange(code("old", 1), 7, code("new", 7), 1, { reverse: true });
          await comment(page, view.touch);
          assert(
            (await page.locator(".comment-editor mark").count()) === 2,
            "Mixed editor dropped one side",
          );
          await save(page, "Mixed range");
          saved = await store(page);
          const mixed = saved.drafts[2];
          assert(
            mixed?.subject.kind === "range" && mixed.subject.parts.length === 2,
            "Mixed selection did not preserve both source ranges",
          );
          assert(
            mixed.subject.parts[0]?.anchors.at(-1)?.line === 6 &&
              mixed.subject.parts[1]?.anchors.at(-1)?.line === 7,
            "Mixed context line numbers were conflated",
          );
          assert(
            mixed.subject.parts[0]?.text.startsWith("function review") === true &&
              mixed.subject.parts[1]?.text.startsWith("function review") === true,
            "Partial context endpoint was lost on one side",
          );
          for (const side of ["old", "new"] as const) {
            const part = mixed.subject.parts[side === "old" ? 0 : 1];
            assert(part !== undefined, "Missing part");
            for (const anchor of part.anchors)
              assert(
                (
                  await card
                    .locator(
                      `.diff-row[data-${side}-line="${anchor.line}"] .diff-number-button[aria-label^="${side === "old" ? "Old" : "New"} line"]`,
                    )
                    .getAttribute("aria-label")
                )?.includes("comments") === true,
                "Covered diff line lacks marker",
              );
          }
          // The shared context row contains one mixed comment, even though it marks both gutters.
          await code("old", 1).scrollIntoViewIfNeeded();
          await card
            .locator('.diff-row[data-old-line="1"] .diff-mobile-line-trigger')
            .evaluate((element) => {
              if (element instanceof HTMLButtonElement) element.click();
            });
          assert(
            (await page.locator(".diff-line-action").textContent())?.includes("Comment (2)") ===
              true,
            "Mixed context draft was counted twice in row action",
          );
          await page.keyboard.press("Escape");
          await preview(page);
          const exported = await page.locator("#review-export-text").inputValue();
          assert(
            exported === formatFeedback(project.absolutePath, saved.drafts),
            "Diff range export changed source or fragment",
          );
          assert(
            exported.split("Mixed range").length === 2 &&
              exported.includes("old lines 1–6") &&
              exported.includes("new lines 1–7"),
            "Mixed export lost Old/New ranges or repeated body",
          );
          await context.storageState({
            path: `qa/.artifacts/multi-line-stage3-${view.width}-storage.json`,
          });
          await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
          await page.getByRole("button", { name: "Feedback 0", exact: true }).waitFor();
          assert(
            (await page.evaluate(() => navigator.clipboard.readText())) === exported,
            "Mixed clipboard changed export",
          );
          assert(
            (await store(page)).history[0]?.comments[2]?.subject.kind === "range",
            "History dropped nested source parts",
          );
          await page.getByRole("button", { name: "Undo last copy", exact: true }).click();
          assert(
            (await store(page)).drafts.length === 3,
            "Undo did not restore one comment per range",
          );
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();
          await page.reload();
          await code("old", 1).waitFor();
          assert((await store(page)).drafts[2]?.id === mixed.id, "Reload lost mixed range");
          await writeFile(
            resolve(fixture, path),
            source.replace(
              "const adjusted = replacement * 3;",
              "const adjusted = replacement * 4;",
            ),
          );
          await page.getByRole("button", { name: "Refresh", exact: true }).click();
          await page.waitForFunction(
            () =>
              document
                .querySelector('.diff-card[data-path="src/range.ts"] .diff-row[data-new-line="3"]')
                ?.textContent?.includes("* 4") === true,
          );
          await preview(page);
          assert(
            (await page
              .getByRole("button", { name: "Reattach selection", exact: true })
              .count()) === 1,
            "Mutation on New did not invalidate the whole mixed comment",
          );
          assert(
            !(await page.locator("#review-export-text").inputValue()).includes("Mixed range"),
            "A partially outdated mixed comment exported",
          );
          await page.getByRole("button", { name: "Reattach selection", exact: true }).click();
          await selectCodeRange(code("old", 1), 7, code("old", 1), 15);
          await page.getByRole("button", { name: /^Comment on selected text:/ }).click();
          await page.locator(".reattach-banner").waitFor({ state: "detached" });
          const moved = (await store(page)).drafts[2];
          assert(
            moved?.id === mixed.id &&
              moved.body === "Mixed range" &&
              moved.subject.kind === "selection" &&
              moved.anchor.kind === "diff" &&
              moved.anchor.side === "old",
            "Mixed-to-fragment reattachment lost body, ID or Old context",
          );
          await writeFile(resolve(fixture, path), source);

          await page.goto(url(project.relativePath, "untracked", "src/untracked-range.ts"));
          const untracked = page.locator(
            '.diff-card[data-layer="untracked"][data-path="src/untracked-range.ts"]',
          );
          await untracked.locator(".diff-code").first().waitFor();
          await selectCodeRange(
            untracked.locator(".diff-code").first(),
            0,
            untracked.locator(".diff-code").last(),
            4,
          );
          await comment(page, view.touch);
          assert(
            (await page.locator(".comment-editor mark").textContent()) === "first 🦊\n\nlast",
            "Untracked range included the no-newline annotation or lost blank source",
          );
          await save(page, "Untracked range");
          await assertNoHorizontalOverflow(page);

          // Staged context: reject hidden gaps, invalidate an action on expansion, then use revealed rows.
          await page.goto(url(contextProject.relativePath, "staged", "example.ts"));
          const staged = page.locator('.diff-card[data-layer="staged"][data-path="example.ts"]');
          const stagedCode = (line: number) =>
            staged.locator(`.diff-row[data-new-line="${line}"] .diff-code`);
          await stagedCode(55).waitFor();
          const hunks = staged.locator(".diff-hunk");
          const far = hunks.nth(1).locator(".diff-code").first();
          const farText = await far.textContent();
          assert(farText !== null, "Missing second hunk");
          await selectCodeRange(stagedCode(55), 0, far, Math.min(10, farText.length));
          await page.locator(".code-selection-reason").waitFor({ state: "visible" });
          assert(
            (await page.locator(".code-selection-reason").textContent())?.includes(
              "Reveal hidden context",
            ) === true,
            "Hidden gap lacked explanation",
          );
          await page.keyboard.press("Escape");
          await selectCodeRange(stagedCode(53), 0, stagedCode(55), 10);
          const held = page.getByRole("button", { name: /^Comment on selected text:/ });
          await held.focus();
          await page.evaluate(() => document.getSelection()?.removeAllRanges());
          const gap = staged.locator('.diff-context-gap[data-gap="1"]');
          await gap
            .getByRole("button", { name: "Show 20 lines below", exact: true })
            .evaluate((element) => {
              if (element instanceof HTMLButtonElement) element.click();
            });
          await stagedCode(58).waitFor();
          await page.locator(".code-selection-action").waitFor({ state: "detached" });
          await selectCodeRange(stagedCode(55), 0, stagedCode(58), 10);
          await comment(page, view.touch);
          await save(page, "Expanded context range");
          await gap.getByRole("button", { name: "Show 20 lines above", exact: true }).click();
          await stagedCode(109).waitFor();
          await gap.getByRole("button", { name: "Show 20 lines above", exact: true }).click();
          await stagedCode(100).waitFor();
          assert(
            !(await stagedCode(100).textContent())?.includes("200 +"),
            "Staged New context borrowed working-tree text",
          );
          await selectCodeRange(stagedCode(99), 0, stagedCode(102), 10);
          await comment(page, view.touch);
          await save(page, "Index context range");
          const contextStore = await store(page, true);
          assert(
            contextStore.drafts.every(
              (draft) =>
                draft.anchor.kind === "diff" &&
                draft.anchor.layer === "staged" &&
                draft.anchor.side === "new" &&
                draft.subject.kind === "range",
            ),
            "Context source identity drifted",
          );
          await staged.locator(".diff-card-toggle").click();
          await page.locator(".code-selection-action").waitFor({ state: "detached" });
          await preview(page);
          assert(
            await page.getByRole("button", { name: "Copy feedback", exact: true }).isEnabled(),
            "Collapsed context range was not current",
          );
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();
          await page.reload();
          await stagedCode(55).waitFor();
          assert((await stagedCode(58).count()) === 0, "Expanded context persisted after reload");
          await preview(page);
          assert(
            (await page.locator("#review-export-text").inputValue()) ===
              formatFeedback(contextProject.absolutePath, contextStore.drafts),
            "Revealed range did not check after reload",
          );
          await assertNoHorizontalOverflow(page);
          console.log(
            `${view.width}: Old/New/mixed selection, exact export, shared markers, checks, copy/history/Undo, reload, partial-side mutation, mixed-to-fragment reattach, untracked blanks/annotation, staged index, hidden gaps, expansion invalidation, revealed ranges after collapse/reload passed`,
          );
        },
      );
    }
  });
} finally {
  await writeFile(resolve(fixture, path), source);
  if (previous === null) await rm(untrackedPath, { force: true });
  else await writeFile(untrackedPath, previous);
}
