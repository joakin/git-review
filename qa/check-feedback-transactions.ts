import { projectApiUrl } from "../src/shared/project-path.ts";
import { projectLookupResponse } from "./browser-support.ts";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, Route } from "playwright-core";
import { appUrl, qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";
import { responseBody } from "../src/client/api.ts";
import {
  anchorForLine,
  validateCommentStore,
  type CommentStore,
  type DraftComment,
} from "../src/client/comments.ts";
import {
  parseDiffResponse,
  parseProjectResponse,
  parseRootResponse,
  parseStatusResponse,
  type Project,
} from "../src/shared/api.ts";

const rawUrl = process.argv[2];
const baselineBundle = process.argv[3];
if (rawUrl === undefined)
  throw new Error(
    "Usage: bun qa/check-feedback-transactions.ts <local app URL> [baseline main.js]",
  );
const origin = appUrl(rawUrl).origin;
await mkdir(resolve("qa/.artifacts/other-project"), { recursive: true });
const root = parseRootResponse(await responseBody(await fetch(`${origin}/api/roots`)));
const project = parseProjectResponse(
  await responseBody(await projectLookupResponse(origin, "inventory-fixture")),
);
const status = parseStatusResponse(
  await responseBody(await fetch(origin + projectApiUrl("/status", project.absolutePath))),
);
if (status.kind !== "git") throw new Error("The inventory fixture must be a Git project");
const diff = parseDiffResponse(
  await responseBody(
    await fetch(
      origin +
        projectApiUrl("/diff", project.absolutePath, {
          layer: "staged",
          path: "src/view.ts",
          revision: status.revision,
          changeToken: status.changeToken,
        }),
    ),
  ),
);
if (diff.kind !== "text") throw new Error("Expected the fixture's staged text diff");
const hunk = diff.hunks[0];
if (hunk === undefined) throw new Error("Missing fixture hunk");
const anchor = anchorForLine(
  "staged",
  "src/view.ts",
  hunk,
  hunk.lines.findIndex((line) => line.kind === "added"),
  "new",
);
if (anchor === null) throw new Error("Missing fixture comment anchor");
const draft: DraftComment = {
  id: "transaction-draft",
  anchor,
  subject: { kind: "line" },
  body: "Original draft",
  createdAt: 1,
  updatedAt: 1,
  state: "current",
};
const seed: CommentStore = {
  version: 4,
  projectPath: project.absolutePath,
  drafts: [draft],
  history: [{ id: "previous-copy", copiedAt: 1, text: "Previous feedback", comments: [draft] }],
};
if (validateCommentStore(seed, project.absolutePath) === null)
  throw new Error("Invalid regression seed");
const storageKey = `git-review:comments:v2:${encodeURIComponent(project.absolutePath)}`;
// Files keeps the changes view's background status polling out of held-request scenarios.
const reviewUrl = `${origin}/?${new URLSearchParams({ section: "files", project: project.relativePath, file: anchor.path })}`;

declare global {
  interface Window {
    feedbackQa: {
      calls: string[];
      pending: { resolve: () => void; reject: (error: Error) => void }[];
      requests: number;
    };
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readStore(page: Page, target: Project = project): Promise<CommentStore> {
  const raw: unknown = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
    `git-review:comments:v2:${encodeURIComponent(target.absolutePath)}`,
  );
  const store = validateCommentStore(raw, target.absolutePath);
  if (store === null) throw new Error("Persisted comments became invalid");
  return store;
}

async function openFeedback(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Feedback 1$/ }).click();
  await page.locator(".feedback-dialog[open]").waitFor();
}
async function ready(page: Page): Promise<void> {
  await page.locator("#review-export-text").waitFor();
}
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
  await page.getByPlaceholder("Add a question, note, or suggestion…").fill(body);
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
  await page.waitForFunction(
    () =>
      !document.querySelector(".feedback-dialog .review-status")?.textContent?.includes("Copying"),
  );
}
async function pendingClipboard(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      window.feedbackQa.calls.length >= expected && window.feedbackQa.pending.length > 0,
    count,
  );
  await networkSettled(page);
  assert(
    await page.evaluate(
      (expected) =>
        window.feedbackQa.calls.length === expected && window.feedbackQa.pending.length === 1,
      count,
    ),
    "Overlapping clipboard writes were issued",
  );
}
async function awayAndBack(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close feedback" }).click();
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "← Back to review", exact: true }).click();
  await openFeedback(page);
}

await withQaBrowser(async (browser) => {
  async function scenario(
    name: string,
    run: (
      page: Page,
      hold: (kind: "status" | "diff") => Promise<() => Promise<void>>,
    ) => Promise<void>,
  ) {
    await withQaContext(
      browser,
      { ...qaProfiles.phone, serviceWorkers: "block" },
      async (context) => {
        const releases: (() => void)[] = [];
        try {
          await context.addInitScript(
            ({ key, store, rootPath, projectPath, appOrigin }) => {
              if (window.location.origin !== appOrigin) return;
              if (localStorage.getItem(key) === null)
                localStorage.setItem(key, JSON.stringify(store));
              sessionStorage.setItem(
                "git-review:active-project:v2",
                JSON.stringify({ version: 2, rootPath, activePath: projectPath }),
              );
              window.feedbackQa = { calls: [], pending: [], requests: 0 };
              const originalFetch = window.fetch.bind(window);
              Object.defineProperty(window, "fetch", {
                configurable: true,
                value: async (input: RequestInfo | URL, init?: RequestInit) => {
                  window.feedbackQa.requests += 1;
                  try {
                    const response = await originalFetch(input, init);
                    const originalJson = response.json.bind(response);
                    Object.defineProperty(response, "json", {
                      value: async () => {
                        try {
                          return await originalJson();
                        } finally {
                          window.feedbackQa.requests -= 1;
                        }
                      },
                    });
                    return response;
                  } catch (error: unknown) {
                    window.feedbackQa.requests -= 1;
                    throw error;
                  }
                },
              });
              Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: {
                  writeText(text: string) {
                    window.feedbackQa.calls.push(text);
                    return new Promise<void>((resolve, reject) =>
                      window.feedbackQa.pending.push({ resolve, reject }),
                    );
                  },
                },
              });
            },
            {
              key: storageKey,
              store: seed,
              rootPath: root.path,
              projectPath: project.relativePath,
              appOrigin: origin,
            },
          );
          if (baselineBundle !== undefined)
            await context.route("**/assets/main.js", async (route) =>
              route.fulfill({
                contentType: "text/javascript",
                body: await Bun.file(baselineBundle).text(),
              }),
            );
          const page = await context.newPage();
          page.setDefaultTimeout(10_000);
          await page.goto(reviewUrl, { waitUntil: "networkidle" });
          await page.getByRole("button", { name: /^Feedback 1$/ }).waitFor();
          async function hold(kind: "status" | "diff"): Promise<() => Promise<void>> {
            await openFeedback(page);
            await ready(page);
            await networkSettled(page);
            const entered = deferred(),
              release = deferred(),
              done = deferred();
            releases.push(release.resolve);
            let first = true;
            const handler = async (route: Route): Promise<void> => {
              if (!first) {
                await route.continue();
                return;
              }
              first = false;
              try {
                const response = await route.fetch();
                entered.resolve();
                await release.promise;
                await route.fulfill({ response });
              } catch {
                /* A canceled browser request cannot receive the held response. */
              } finally {
                done.resolve();
              }
            };
            await page.route(`**/api/project/${kind}?*`, handler);
            await page.getByRole("button", { name: "Check lines", exact: true }).click();
            await Promise.race([
              entered.promise,
              page.waitForFunction(() => false, undefined, { timeout: 10_000 }),
            ]);
            return async () => {
              release.resolve();
              await done.promise;
              await page.unroute(`**/api/project/${kind}?*`, handler);
              await networkSettled(page);
            };
          }
          await run(page, hold);
        } finally {
          for (const release of releases) release();
        }
      },
    );
    console.log(`Passed: ${name}`);
  }

  for (const kind of ["status", "diff"] as const)
    await scenario(`editing during a held ${kind} check`, async (page, hold) => {
      const release = await hold(kind);
      await edit(page, `Newest ${kind} draft`);
      await openFeedback(page);
      await ready(page);
      await release();
      const store = await readStore(page);
      assert(
        store.drafts[0]?.body === `Newest ${kind} draft`,
        `A late ${kind} check overwrote an edit`,
      );
      assert(store.history.length === 1, "A check changed copy history");
      await page.reload({ waitUntil: "networkidle" });
      assert(
        (await readStore(page)).drafts[0]?.body === `Newest ${kind} draft`,
        "Reload lost the newest edit",
      );
    });

  await scenario(
    "editing cancels a clipboard transaction and retry copies the newest body",
    async (page) => {
      await openFeedback(page);
      await ready(page);
      await page.getByRole("button", { name: "Copy feedback", exact: true }).evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click();
          button.click();
        }
      });
      await pendingClipboard(page, 1);
      await page.locator(".review-history-item summary").click();
      assert(
        await page.getByRole("button", { name: "Copy again", exact: true }).isDisabled(),
        "History copy was allowed during a feedback write",
      );
      await edit(page, "Edited during clipboard write");
      await openFeedback(page);
      await ready(page);
      assert(
        await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled(),
        "Reopening allowed an overlapping clipboard write",
      );
      await settleClipboard(page);
      let store = await readStore(page);
      assert(
        store.drafts[0]?.body === "Edited during clipboard write" && store.history.length === 1,
        "A canceled write archived or removed an edited draft",
      );
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 2);
      await settleClipboard(page);
      await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
      store = await readStore(page);
      assert(
        store.drafts.length === 0 &&
          store.history.length === 2 &&
          store.history[0]?.comments[0]?.body === "Edited during clipboard write",
        "Retry did not archive the newest draft",
      );
      await page.reload({ waitUntil: "networkidle" });
      assert(
        (await readStore(page)).history[0]?.comments[0]?.body === "Edited during clipboard write",
        "Reload lost copy history",
      );
    },
  );

  await scenario("navigation away and back cancels a held check", async (page, hold) => {
    const release = await hold("diff");
    await awayAndBack(page);
    await ready(page);
    await edit(page, "Edit after returning to project");
    await release();
    assert(
      (await readStore(page)).drafts[0]?.body === "Edit after returning to project",
      "A check from an old destination overwrote the current store",
    );
    await openFeedback(page);
    await ready(page);
    assert(
      (await page.locator("#review-export-text").inputValue()).includes(
        "Edit after returning to project",
      ),
      "Navigation recovery exported an older saved body",
    );
  });

  await scenario(
    "closing Feedback alone lets an issued copy finish and keeps Undo available",
    async (page) => {
      await openFeedback(page);
      await ready(page);
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 1);
      await page.getByRole("button", { name: "Close feedback", exact: true }).click();
      await page.locator(".feedback-dialog").waitFor({ state: "detached" });
      await settleClipboard(page);
      await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
      const copied = await readStore(page);
      assert(
        copied.drafts.length === 0 &&
          copied.history.length === 2 &&
          copied.history[0]?.comments[0]?.body === draft.body,
        "Closing the preview canceled or changed the issued copy",
      );
      await page.getByRole("button", { name: /^Feedback 0$/ }).click();
      await page.locator(".feedback-dialog[open]").waitFor();
      assert(
        await page.getByRole("button", { name: "Undo last copy", exact: true }).isEnabled(),
        "Reopening lost Undo for the completed copy",
      );
      await page.getByRole("button", { name: "Undo last copy", exact: true }).click();
      await page.getByRole("button", { name: /^Feedback 1$/ }).waitFor();
      const restored = await readStore(page);
      assert(
        restored.drafts[0]?.id === draft.id &&
          restored.drafts[0]?.body === draft.body &&
          restored.history.length === 1 &&
          restored.history[0]?.id === "previous-copy",
        "Undo did not restore the closed-preview copy without replacing older history",
      );
    },
  );

  await scenario("navigation away and back ignores a late clipboard success", async (page) => {
    await openFeedback(page);
    await ready(page);
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await pendingClipboard(page, 1);
    await awayAndBack(page);
    await ready(page);
    await settleClipboard(page);
    const store = await readStore(page);
    assert(
      store.drafts.length === 1 && store.history.length === 1,
      "An old destination's clipboard success archived current drafts",
    );
  });

  await scenario(
    "project switching preserves the clipboard lease and isolates both review stores",
    async (page) => {
      const other = parseProjectResponse(
        await responseBody(await projectLookupResponse(origin, "other-project")),
      );
      const otherSeed: CommentStore = {
        version: 4,
        projectPath: other.absolutePath,
        drafts: [{ ...draft, id: "other-draft", body: "Other project draft" }],
        history: [],
      };
      assert(
        validateCommentStore(otherSeed, other.absolutePath) !== null,
        "Invalid second-project seed",
      );
      await page.evaluate(
        (store) =>
          localStorage.setItem(
            `git-review:comments:v2:${encodeURIComponent(store.projectPath)}`,
            JSON.stringify(store),
          ),
        otherSeed,
      );
      // This empty picker fixture uses controlled Git responses; its project identity and SPA transition stay real.
      await page.route("**/api/project/status?*", (route) => route.fulfill({ json: status }));
      await page.route("**/api/project/diff?*", (route) => route.fulfill({ json: diff }));
      await openFeedback(page);
      await ready(page);
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 1);
      const before = await readStore(page);
      await page.getByRole("button", { name: "Close feedback", exact: true }).click();
      await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
      await page.getByRole("button", { name: "Choose a project", exact: true }).click();
      await page.locator(".folder-row", { hasText: "other-project" }).click();
      await page.getByRole("button", { name: /Open this folder/ }).click();
      await page
        .locator(".project-switch .switch-label")
        .getByText("other-project", { exact: true })
        .waitFor();
      await openFeedback(page);
      await ready(page);
      const preview = await page.locator("#review-export-text").inputValue();
      assert(
        preview.includes(other.absolutePath) &&
          preview.includes("Other project draft") &&
          !preview.includes(draft.body),
        "The second project's checked preview used the old session",
      );
      assert(
        await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled(),
        "Switching projects allowed an overlapping clipboard write",
      );
      await pendingClipboard(page, 1);
      await settleClipboard(page);
      assert(
        JSON.stringify(await readStore(page)) === JSON.stringify(before),
        "The old clipboard result archived or changed the first project's review",
      );
      assert(
        JSON.stringify(await readStore(page, other)) ===
          JSON.stringify(validateCommentStore(otherSeed, other.absolutePath)),
        "The old clipboard result changed the second project's review",
      );
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 2);
      await settleClipboard(page);
      await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
      const copied = await readStore(page, other);
      assert(
        copied.drafts.length === 0 &&
          copied.history.length === 1 &&
          copied.history[0]?.comments[0]?.body === "Other project draft",
        "Retry did not archive the second project's own draft",
      );
      assert(
        JSON.stringify(await readStore(page)) === JSON.stringify(before),
        "Copying the second project changed the first project's review",
      );
    },
  );

  await scenario(
    "clipboard rejection retains selectable text and drafts; reopening permits retry",
    async (page) => {
      await openFeedback(page);
      await ready(page);
      const text = await page.locator("#review-export-text").inputValue();
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 1);
      await settleClipboard(page, true);
      await page.getByText("Clipboard denied for regression QA", { exact: true }).waitFor();
      assert(
        (await page.locator("#review-export-text").inputValue()) === text,
        "Clipboard rejection removed selectable text",
      );
      assert(
        (await readStore(page)).drafts[0]?.body === "Original draft",
        "Clipboard rejection removed a draft",
      );
      await page.getByRole("button", { name: "Close feedback" }).click();
      await openFeedback(page);
      await ready(page);
      await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
      await pendingClipboard(page, 2);
      await settleClipboard(page);
      await page.getByRole("button", { name: /^Feedback 0$/ }).waitFor();
    },
  );

  await scenario(
    "history clipboard writes exclude concurrent history and feedback writes",
    async (page) => {
      await openFeedback(page);
      await ready(page);
      await page.locator(".review-history-item summary").click();
      await page.getByRole("button", { name: "Copy again", exact: true }).evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click();
          button.click();
        }
      });
      await pendingClipboard(page, 1);
      assert(
        await page.getByRole("button", { name: "Copy again", exact: true }).isDisabled(),
        "History double-copy remained enabled",
      );
      assert(
        await page.getByRole("button", { name: "Copy feedback", exact: true }).isDisabled(),
        "Feedback copy overlapped history copy",
      );
      await settleClipboard(page);
      await page.getByRole("button", { name: "Close feedback" }).click();
      await page.getByText("History feedback copied.", { exact: false }).waitFor();
      const store = await readStore(page);
      assert(
        store.drafts.length === 1 && store.history.length === 1,
        "Copying history changed drafts or archive entries",
      );
      assert(
        (await page.evaluate(() => window.feedbackQa.calls[0])) === "Previous feedback",
        "History copied the wrong text",
      );
    },
  );
  console.log(
    "Feedback transaction browser regressions passed. Clipboard promises were controlled; real-device clipboard behavior was not exercised.",
  );
});
