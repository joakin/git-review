import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { appUrl, assertNoHorizontalOverflow, withQaBrowser } from "./browser-support.ts";
import { parseChangeCheckResponse, parseStatusResponse } from "../src/shared/api.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-live-changes.ts <local app URL>");
const url = appUrl(rawUrl).href;

const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "live-changes-"));
const folder = basename(project);
const source = resolve(project, "src/live.ts");
const lines = Array.from(
  { length: 90 },
  (_, index) => `export const row${index + 1} = ${index + 1};`,
);
function content(value: string): string {
  return (
    lines
      .map((line, index) => (index === 40 ? `export const message = "${value}";` : line))
      .join("\n") + "\n"
  );
}
function git(...args: string[]): void {
  execFileSync("git", args, { cwd: project, stdio: "pipe" });
}

const views = [
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "tablet-portrait", width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: "tablet-landscape", width: 1180, height: 820, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;

try {
  git("init", "-q");
  await mkdir(resolve(project, "src"));
  await writeFile(source, content("base"));
  git("add", ".");
  git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");
  await writeFile(source, content("first"));
  await writeFile(
    resolve(project, "src/reading.ts"),
    Array.from(
      { length: 180 },
      (_, index) => `export const reading${index + 1} = ${index + 1};`,
    ).join("\n") + "\n",
  );

  await withQaBrowser(async (browser) => {
    const openPages = [];
    const errors: string[] = [];
    for (const view of views) {
      const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        isMobile: view.isMobile,
        hasTouch: view.hasTouch,
      });
      context.setDefaultTimeout(10_000);
      const page = await context.newPage();
      if (view.name === "mobile") await page.clock.install();
      page.on("pageerror", (error) => errors.push(`${view.name}: ${error.message}`));
      await page.goto(url, { waitUntil: "load" });
      await page.getByRole("button", { name: new RegExp(folder) }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      if (view.width <= 600)
        await page.getByRole("button", { name: "Review all changes", exact: true }).click();
      const card = page.locator('main .diff-card[data-layer="unstaged"][data-path="src/live.ts"]');
      await card.locator(".diff-card-toggle").click();
      await card.getByText('export const message = "first";').waitFor({ state: "visible" });
      openPages.push({ context, page, card, name: view.name });
    }

    const phone = openPages[0];
    if (phone === undefined) throw new Error("Phone page was not created");
    let statusRequests = 0;
    phone.page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/status")) statusRequests += 1;
    });
    await phone.card.locator(".diff-row-added").filter({ hasText: "message" }).tap();
    await phone.card.locator(".diff-line-action").click();
    await phone.page.locator(".comment-editor[open]").waitFor({ state: "visible" });
    await phone.page
      .getByPlaceholder("Add a question, note, or suggestion…")
      .fill("Keep this draft through updates.");
    const editingRequests = statusRequests;
    await phone.page.clock.fastForward(11_000);
    await phone.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    if (statusRequests !== editingRequests)
      throw new Error("Background status polling continued while the comment editor was open");
    const afterEditor = phone.page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/status"),
    );
    await phone.page.getByRole("button", { name: "Save comment" }).click();
    await (await afterEditor).finished();
    const beforeFeedback = statusRequests;
    await phone.page.getByRole("button", { name: "Feedback 1", exact: true }).click();
    await phone.page.locator("#review-export-text").waitFor({ state: "visible" });
    if (statusRequests !== beforeFeedback + 1)
      throw new Error(
        "Opening Feedback should perform one explicit line check without background polling",
      );
    const feedbackRequests = statusRequests;
    await phone.page.clock.fastForward(11_000);
    await phone.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    if (statusRequests !== feedbackRequests)
      throw new Error("Background status polling continued while Feedback was open");
    const afterFeedback = phone.page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/status"),
    );
    await phone.page.getByRole("button", { name: "Close feedback" }).click();
    await (await afterFeedback).finished();
    await phone.page.waitForTimeout(300);
    const readingCard = phone.page.locator(
      'main .diff-card[data-layer="untracked"][data-path="src/reading.ts"]',
    );
    await readingCard.locator(".diff-card-toggle").click();
    await readingCard.locator(".diff-row").nth(70).scrollIntoViewIfNeeded();
    const before = await phone.page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        'main .diff-card[data-path="src/reading.ts"]',
      );
      return { scrollY, top: card?.getBoundingClientRect().top ?? 0 };
    });
    if (before.scrollY <= 0)
      throw new Error("Reading-position setup did not scroll into the tall expanded card");

    await writeFile(source, content("other"));
    await Promise.all(
      openPages.map(async ({ page, card }) => {
        await page.locator(".changes-update").waitFor({ state: "visible", timeout: 16_000 });
        if (!(await card.textContent())?.includes('message = "first"'))
          throw new Error("Pending update replaced the displayed diff");
        if ((await card.textContent())?.includes('message = "other"'))
          throw new Error("New code appeared before Update was tapped");
        await assertNoHorizontalOverflow(page);
      }),
    );

    const screenshotRoot = resolve(artifacts, "live-changes-runs");
    await mkdir(screenshotRoot, { recursive: true });
    const screenshotDir = await mkdtemp(resolve(screenshotRoot, "run-"));
    for (const { page, name } of openPages)
      await page.screenshot({ path: resolve(screenshotDir, `${name}.png`) });
    await writeFile(
      resolve(screenshotDir, "manifest.json"),
      JSON.stringify(
        { url, fixture: "temporary Git project", state: "New edits action with expanded diff" },
        null,
        2,
      ) + "\n",
    );
    console.log(`Live-change screenshots: ${screenshotDir}`);

    await phone.page.setViewportSize({ width: 320, height: 700 });
    const narrowFit = await phone.page.evaluate(() => {
      const update = document.querySelector(".changes-update")?.getBoundingClientRect();
      const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
      return {
        update,
        feedback,
      };
    });
    if (
      narrowFit.update === undefined ||
      narrowFit.feedback === undefined ||
      narrowFit.update.left < 0 ||
      narrowFit.update.right > 320 ||
      narrowFit.update.bottom > narrowFit.feedback.top
    )
      throw new Error(`Update action does not fit the narrow phone: ${JSON.stringify(narrowFit)}`);
    await assertNoHorizontalOverflow(phone.page);
    await phone.page.setViewportSize({ width: 390, height: 844 });

    await phone.page.locator(".changes-update").click();
    await phone.card.getByText('export const message = "other";').waitFor({ state: "visible" });
    if ((await phone.card.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true")
      throw new Error("Update collapsed the open card");
    await readingCard.locator(".diff-row").nth(70).waitFor({ state: "attached" });
    if ((await readingCard.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true")
      throw new Error("Update collapsed the scrolled reading card");
    if (!(await phone.page.getByRole("button", { name: /Feedback 1/ }).isVisible()))
      throw new Error("Update lost the draft comment");
    const after = await phone.page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        'main .diff-card[data-path="src/reading.ts"]',
      );
      return { scrollY, top: card?.getBoundingClientRect().top ?? 0 };
    });
    if (Math.abs(after.top - before.top) > 180)
      throw new Error(`Update moved the active card too far: ${JSON.stringify({ before, after })}`);

    await phone.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await writeFile(source, content("third"));
    await phone.page.clock.fastForward(11_000);
    if (await phone.page.locator(".changes-update").isVisible())
      throw new Error("Hidden tab still showed an update");
    await phone.page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await phone.page.locator(".changes-update").waitFor({ state: "visible", timeout: 3_000 });
    await phone.page.locator(".changes-update").click();
    await phone.card.getByText('export const message = "third";').waitFor({ state: "visible" });

    let activeChecks = 0;
    let maximumChecks = 0;
    await phone.page.route("**/api/projects/*/status**", async (route) => {
      activeChecks += 1;
      maximumChecks = Math.max(maximumChecks, activeChecks);
      await new Promise((finish) => setTimeout(finish, 300));
      activeChecks -= 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "QA check failure" } }),
      });
    });
    await phone.page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await phone.page
      .getByRole("status")
      .filter({ hasText: "Could not check for new edits" })
      .waitFor({ state: "visible", timeout: 4_000 });
    if (maximumChecks !== 1 || !(await phone.card.textContent())?.includes('message = "third"'))
      throw new Error("Polling requests overlapped or a check failure replaced the review");
    await phone.page.unroute("**/api/projects/*/status**");
    await phone.page.getByRole("button", { name: "Refresh", exact: true }).click();
    await phone.page
      .getByRole("status")
      .filter({ hasText: "Could not check for new edits" })
      .waitFor({ state: "detached" });
    await phone.card.getByText('export const message = "third";').waitFor({ state: "visible" });

    // Keep the worktree unchanged during failure: a manual generation still refetches diffs,
    // while a controlled pending token exercises retention of the displayed status snapshot.
    let failUpdate = false;
    await phone.page.route("**/api/projects/*/status**", async (route) => {
      if (failUpdate) {
        await route.fulfill({
          status: 503,
          json: { error: { code: "internal_error", message: "QA update failure" } },
        });
        return;
      }
      const response = await route.fetch();
      const body: unknown = await response.json();
      const latest =
        new URL(route.request().url()).searchParams.get("mode") === "check"
          ? parseChangeCheckResponse(body)
          : parseStatusResponse(body);
      if (latest.kind !== "git")
        throw new Error("The live-change fixture must remain a Git worktree");
      await route.fulfill({
        response,
        json: {
          ...latest,
          changeToken:
            latest.changeToken === "00000000000000000000"
              ? "11111111111111111111"
              : "00000000000000000000",
        },
      });
    });
    await phone.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await phone.page.locator(".changes-update").waitFor({ state: "visible" });
    const inventory = await phone.page
      .locator("main .diff-card")
      .evaluateAll((cards) =>
        JSON.stringify(
          cards.map((card) => [card.getAttribute("data-layer"), card.getAttribute("data-path")]),
        ),
      );
    const preferences = await phone.page.evaluate(() =>
      JSON.stringify(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("git-review:open-cards:v1:"))
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    failUpdate = true;
    const refetched = phone.page.waitForRequest((request) => {
      const requested = new URL(request.url());
      return (
        requested.pathname.endsWith("/diff") && requested.searchParams.get("path") === "src/live.ts"
      );
    });
    await phone.page.locator(".changes-update").click();
    await refetched;
    await phone.page
      .getByRole("alert")
      .filter({ hasText: "QA update failure" })
      .waitFor({ state: "visible" });
    await phone.page
      .locator(".changes-update")
      .getByText("New edits · Update", { exact: true })
      .waitFor({ state: "visible" });
    await phone.card.getByText('export const message = "third";').waitFor({ state: "visible" });
    const retainedInventory = await phone.page
      .locator("main .diff-card")
      .evaluateAll((cards) =>
        JSON.stringify(
          cards.map((card) => [card.getAttribute("data-layer"), card.getAttribute("data-path")]),
        ),
      );
    if (retainedInventory !== inventory)
      throw new Error("Failed Update replaced the displayed inventory");
    const retainedPreferences = await phone.page.evaluate(() =>
      JSON.stringify(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("git-review:open-cards:v1:"))
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    if (retainedPreferences !== preferences)
      throw new Error("Failed Update changed persisted card preferences");
    if (
      (await phone.card.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true" ||
      (await readingCard.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true" ||
      !(await phone.page.getByRole("button", { name: "Feedback 1", exact: true }).isVisible())
    )
      throw new Error("Failed Update collapsed a card or lost the draft");
    await phone.page.unroute("**/api/projects/*/status**");
    await writeFile(source, content("recovered"));
    await phone.page.locator(".changes-update").click();
    await phone.card.getByText('export const message = "recovered";').waitFor({ state: "visible" });
    await phone.page.locator(".changes-update").waitFor({ state: "detached" });
    if (
      !(await phone.page.getByRole("button", { name: "Feedback 1", exact: true }).isVisible()) ||
      (await readingCard.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "true"
    )
      throw new Error("Update recovery lost the draft or reading-card preference");
    if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  });
  console.log(
    "Live edits appeared on four viewports without replacing code; Update kept expanded cards, draft, and a deliberately scrolled reading position; editor/Feedback pause and close resume, 320px fit, hidden-tab pause/resume, serialized checks, poll/manual Update failure recovery, and manual Refresh passed.",
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
