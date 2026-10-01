import { chromium, type Page, type Route } from "playwright-core";
import { responseBody } from "../src/client/api.ts";
import { anchorForLine, validateCommentStore, type CommentStore, type DraftComment } from "../src/client/comments.ts";
import { parseDiffResponse, parseProjectResponse, parseRootResponse, parseStatusResponse } from "../src/shared/api.ts";

const appUrl = process.argv[2];
const baselineBundle = process.argv[3];
if (appUrl === undefined) throw new Error("Usage: bun qa/check-feedback-transactions.ts <local app URL> [baseline main.js]");
const origin = new URL(appUrl).origin;
const root = parseRootResponse(await responseBody(await fetch(`${origin}/api/roots`)));
const project = parseProjectResponse(await responseBody(await fetch(`${origin}/api/projects/open`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "inventory-fixture" }),
})));
const status = parseStatusResponse(await responseBody(await fetch(`${origin}/api/projects/${project.id}/status`)));
if (status.kind !== "git") throw new Error("The inventory fixture must be a Git project");
const diff = parseDiffResponse(await responseBody(await fetch(`${origin}/api/projects/${project.id}/diff?${new URLSearchParams({ layer: "staged", path: "src/view.ts", revision: status.revision })}`)));
if (diff.kind !== "text") throw new Error("Expected the fixture's staged text diff");
const hunk = diff.hunks[0];
if (hunk === undefined) throw new Error("Missing fixture hunk");
const anchor = anchorForLine("staged", "src/view.ts", hunk, hunk.lines.findIndex((line) => line.kind === "added"), "new");
if (anchor === null) throw new Error("Missing fixture comment anchor");
const draft: DraftComment = { id: "transaction-draft", anchor, body: "Original draft", createdAt: 1, updatedAt: 1, state: "current" };
const seed: CommentStore = { version: 1, projectId: project.id, drafts: [draft], history: [{ id: "previous-copy", copiedAt: 1, text: "Previous feedback", comments: [draft] }] };
if (validateCommentStore(seed, project.id) === null) throw new Error("Invalid regression seed");
const storageKey = `git-review:comments:v1:${project.id}`;
// Files keeps the changes view's background status polling out of held-request scenarios.
const reviewUrl = `${origin}/?${new URLSearchParams({ section: "files", project: project.path, file: anchor.path })}`;

declare global {
  interface Window {
    feedbackQa: { calls: string[]; pending: { resolve: () => void; reject: (error: Error) => void }[]; requests: number };
  }
}

function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function readStore(page: Page): Promise<CommentStore> {
  const raw: unknown = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown, storageKey);
  const store = validateCommentStore(raw, project.id);
  if (store === null) throw new Error("Persisted comments became invalid");
  return store;
}

async function openFeedback(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Feedback 1$/ }).click();
  await page.locator(".feedback-dialog[open]").waitFor();
}
async function ready(page: Page): Promise<void> { await page.locator("#review-export-text").waitFor(); }
async function networkSettled(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    await page.waitForFunction(() => window.feedbackQa.requests === 0);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
}
async function edit(page: Page, body: string): Promise<void> {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByPlaceholder("What should change?").fill(body);
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.locator(".comment-editor").waitFor({ state: "detached" });
}
async function settleClipboard(page: Page, fail = false): Promise<void> {
  await page.evaluate((reject) => {
    const pending = window.feedbackQa.pending.shift();
    if (pending === undefined) throw new Error("No clipboard request to settle");
    if (reject) pending.reject(new Error("Clipboard denied for regression QA"));
    else pending.resolve();
  }, fail);
  await page.waitForFunction(() => !document.querySelector(".feedback-dialog .review-status")?.textContent?.includes("Copying"));
}
async function pendingClipboard(page: Page, count: number): Promise<void> {
  await page.waitForFunction((expected) => window.feedbackQa.calls.length >= expected && window.feedbackQa.pending.length > 0, count);
  await networkSettled(page);
  assert(await page.evaluate((expected) => window.feedbackQa.calls.length === expected && window.feedbackQa.pending.length === 1, count), "Overlapping clipboard writes were issued");
}
async function awayAndBack(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close feedback" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "← Back to review", exact: true }).click();
  await openFeedback(page);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  async function scenario(name: string, run: (page: Page, hold: (kind: "status" | "diff") => Promise<() => Promise<void>>) => Promise<void>) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const releases: (() => void)[] = [];
    const errors: string[] = [];
    try {
      await context.addInitScript(({ key, store, rootPath, projectPath }) => {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(store));
        sessionStorage.setItem("git-review:active-project:v1", JSON.stringify({ version: 1, rootPath, activePath: projectPath }));
        window.feedbackQa = { calls: [], pending: [], requests: 0 };
        const originalFetch = window.fetch.bind(window);
        Object.defineProperty(window, "fetch", { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
          window.feedbackQa.requests += 1;
          try {
            const response = await originalFetch(input, init);
            const originalJson = response.json.bind(response);
            Object.defineProperty(response, "json", { value: async () => {
              try { return await originalJson(); }
              finally { window.feedbackQa.requests -= 1; }
            } });
            return response;
          }
          catch (error: unknown) { window.feedbackQa.requests -= 1; throw error; }
        } });
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText(text: string) {
          window.feedbackQa.calls.push(text);
          return new Promise<void>((resolve, reject) => window.feedbackQa.pending.push({ resolve, reject }));
        } } });
      }, { key: storageKey, store: seed, rootPath: root.path, projectPath: project.path });
      if (baselineBundle !== undefined) await context.route("**/assets/main.js", async (route) => route.fulfill({ contentType: "text/javascript", body: await Bun.file(baselineBundle).text() }));
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(reviewUrl, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Feedback 1$/ }).waitFor();
      async function hold(kind: "status" | "diff"): Promise<() => Promise<void>> {
        await openFeedback(page); await ready(page); await networkSettled(page);
        const entered = deferred(), release = deferred(), done = deferred();
        releases.push(release.resolve);
        let first = true;
        const handler = async (route: Route): Promise<void> => {
          if (!first) { await route.continue(); return; }
          first = false;
          try {
            const response = await route.fetch();
            entered.resolve();
            await release.promise;
            await route.fulfill({ response });
          } catch { /* A canceled browser request cannot receive the held response. */ }
          finally { done.resolve(); }
        };
        await page.route(`**/api/projects/${project.id}/${kind}${kind === "diff" ? "?*" : ""}`, handler);
        await page.getByRole("button", { name: "Check lines", exact: true }).click();
        await Promise.race([entered.promise, page.waitForFunction(() => false, undefined, { timeout: 10_000 })]);
        return async () => {
          release.resolve();
          await done.promise;
          await page.unroute(`**/api/projects/${project.id}/${kind}${kind === "diff" ? "?*" : ""}`, handler);
          await networkSettled(page);
        };
      }
      await run(page, hold);
      assert(errors.length === 0, `${name}: browser errors: ${errors.join("; ")}`);
      console.log(`Passed: ${name}`);
    } finally {
      for (const release of releases) release();
      await context.close();
    }
  }

  for (const kind of ["status", "diff"] as const) await scenario(`editing during a held ${kind} check`, async (page, hold) => {
    const release = await hold(kind);
    await edit(page, `Newest ${kind} draft`);
    await openFeedback(page); await ready(page);
    await release();
    const store = await readStore(page);
    assert(store.drafts[0]?.body === `Newest ${kind} draft`, `A late ${kind} check overwrote an edit`);
    assert(store.history.length === 1, "A check changed copy history");
    await page.reload({ waitUntil: "networkidle" });
    assert((await readStore(page)).drafts[0]?.body === `Newest ${kind} draft`, "Reload lost the newest edit");
  });

  await scenario("editing cancels a clipboard transaction and retry copies the newest body", async (page) => {
    await openFeedback(page); await ready(page);
    await page.getByRole("button", { name: "Copy feedback", exact: true }).evaluate((button) => { if (button instanceof HTMLButtonElement) { button.click(); button.click(); } });
    await pendingClipboard(page, 1);
    await page.locator(".review-history-item summary").click();
    assert(await page.getByRole("button", { name: "Copy again", exact: true }).isDisabled(), "History copy was allowed during a feedback write");
    await edit(page, "Edited during clipboard write");
    await openFeedback(page); await ready(page);
    assert(await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled(), "Reopening allowed an overlapping clipboard write");
    await settleClipboard(page);
    let store = await readStore(page);
    assert(store.drafts[0]?.body === "Edited during clipboard write" && store.history.length === 1, "A canceled write archived or removed an edited draft");
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await pendingClipboard(page, 2); await settleClipboard(page);
    await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
    store = await readStore(page);
    assert(store.drafts.length === 0 && store.history.length === 2 && store.history[0]?.comments[0]?.body === "Edited during clipboard write", "Retry did not archive the newest draft");
    await page.reload({ waitUntil: "networkidle" });
    assert((await readStore(page)).history[0]?.comments[0]?.body === "Edited during clipboard write", "Reload lost copy history");
  });

  await scenario("navigation away and back cancels a held check", async (page, hold) => {
    const release = await hold("diff");
    await awayAndBack(page); await ready(page);
    await edit(page, "Edit after returning to project");
    await release();
    assert((await readStore(page)).drafts[0]?.body === "Edit after returning to project", "A check from an old destination overwrote the current store");
  });

  await scenario("navigation away and back ignores a late clipboard success", async (page) => {
    await openFeedback(page); await ready(page);
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await pendingClipboard(page, 1);
    await awayAndBack(page); await ready(page);
    await settleClipboard(page);
    const store = await readStore(page);
    assert(store.drafts.length === 1 && store.history.length === 1, "An old destination's clipboard success archived current drafts");
  });

  await scenario("clipboard rejection retains selectable text and drafts; reopening permits retry", async (page) => {
    await openFeedback(page); await ready(page);
    const text = await page.locator("#review-export-text").inputValue();
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await pendingClipboard(page, 1); await settleClipboard(page, true);
    await page.getByText("Clipboard denied for regression QA", { exact: true }).waitFor();
    assert(await page.locator("#review-export-text").inputValue() === text, "Clipboard rejection removed selectable text");
    assert((await readStore(page)).drafts[0]?.body === "Original draft", "Clipboard rejection removed a draft");
    await page.getByRole("button", { name: "Close feedback" }).click();
    await openFeedback(page); await ready(page);
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await pendingClipboard(page, 2); await settleClipboard(page);
    await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
  });

  await scenario("history clipboard writes exclude concurrent history and feedback writes", async (page) => {
    await openFeedback(page); await ready(page);
    await page.locator(".review-history-item summary").click();
    await page.getByRole("button", { name: "Copy again", exact: true }).evaluate((button) => { if (button instanceof HTMLButtonElement) { button.click(); button.click(); } });
    await pendingClipboard(page, 1);
    assert(await page.getByRole("button", { name: "Copy again", exact: true }).isDisabled(), "History double-copy remained enabled");
    assert(await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled(), "Feedback copy overlapped history copy");
    await settleClipboard(page);
    await page.getByRole("button", { name: "Close feedback" }).click();
    await page.getByText("History feedback copied.", { exact: false }).waitFor();
    const store = await readStore(page);
    assert(store.drafts.length === 1 && store.history.length === 1, "Copying history changed drafts or archive entries");
    assert(await page.evaluate(() => window.feedbackQa.calls[0]) === "Previous feedback", "History copied the wrong text");
  });
  console.log("Feedback transaction browser regressions passed. Clipboard promises were controlled; real-device clipboard behavior was not exercised.");
} finally { await browser.close(); }
