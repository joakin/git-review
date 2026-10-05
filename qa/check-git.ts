import { readFile } from "node:fs/promises";
import { chromium, type Page, type Request, type Route as BrowserRoute } from "playwright-core";
import { expectRecord } from "../src/shared/validation.ts";
import { expectGitOid, parseCommitDetail, parseGitHistory } from "../src/shared/git.ts";

const url = process.argv[2];
if (url === undefined)
  throw new Error(
    "Usage: bun qa/check-git.ts <local QA app URL>; prepare with bun qa/prepare-git-fixture.ts first",
  );
const base = new URL(url);
const fixture = expectRecord(
  JSON.parse(await readFile("qa/.artifacts/history-fixture-info.json", "utf8")) as unknown,
  "history fixture",
);
const updated = expectGitOid(fixture["updated"]);
const feature = expectGitOid(fixture["feature"]);
const merge = expectGitOid(fixture["merge"]);
const root = expectGitOid(fixture["root"]);
const browser = await chromium.launch({ channel: "chrome", headless: true });

function route(ref: string | null, oid: string | null): string {
  const query = new URLSearchParams({ section: "git", project: "history-fixture" });
  if (ref !== null) query.set("ref", ref);
  if (oid !== null) query.set("commit", oid);
  return new URL(`/?${query}`, base).href;
}

async function waitForCommit(page: Page, oid: string): Promise<void> {
  await page.locator(`.commit-view[data-commit="${oid}"]`).waitFor({ state: "visible" });
}

async function allDiffsReady(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.diff-card[data-layer="commit"]')].every(
      (card) =>
        card.querySelector('.diff-card-toggle[aria-expanded="false"]') !== null ||
        card.querySelector(".diff-scroll, .media-diff") !== null ||
        [...card.querySelectorAll(".diff-message")].some(
          (message) => !(message.textContent ?? "").startsWith("Loading diff"),
        ),
    ),
  );
}

async function checkHistoryRefresh(page: Page, olderCount: number): Promise<void> {
  const destination = page.url();
  const ref = new URL(destination).searchParams.get("ref");
  const refresh = page.locator(".git-refresh");
  const historyRequest = (request: Request) =>
    new URL(request.url()).pathname.endsWith("/git/log") &&
    new URL(request.url()).searchParams.get("ref") === ref;
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failNext = true;
  const intercept = async (route: BrowserRoute): Promise<void> => {
    if (failNext && historyRequest(route.request())) {
      failNext = false;
      await held;
      await route.fulfill({
        status: 503,
        json: { error: { code: "internal_error", message: "History refresh QA failure" } },
      });
    } else await route.continue();
  };
  await page.route(/\/git\/log\?/, intercept);
  try {
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/git/refs")),
      page.waitForRequest(historyRequest),
      refresh.click(),
    ]);
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>(".git-refresh")?.disabled === true,
    );
    if ((await page.locator(".git-commit-row").count()) !== olderCount)
      throw new Error("Refreshing cleared the loaded history pages");
    release();
    const error = page.locator(".sidebar-error", { hasText: "History refresh QA failure" });
    await error.waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>(".git-refresh")?.disabled === false,
    );
    if ((await page.locator(".git-commit-row").count()) !== olderCount)
      throw new Error("Failed refresh lost the loaded history pages");
    await Promise.all([
      page.waitForResponse((response) => historyRequest(response.request()) && response.ok()),
      refresh.click(),
    ]);
    await page.waitForFunction(() => document.querySelectorAll(".git-commit-row").length === 50);
    await error.waitFor({ state: "detached" });
    if (page.url() !== destination)
      throw new Error("Refresh changed the selected branch or commit");
  } finally {
    release();
    await page.unroute(/\/git\/log\?/, intercept);
  }
}

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 1200,
      hasTouch: viewport.width < 1200,
    });
    const page = await context.newPage();
    let resumeRefs = (): void => {};
    if (viewport.width === 820) {
      const refsGate = new Promise<void>((resolve) => {
        resumeRefs = resolve;
      });
      await page.route(/\/git\/refs$/, async (route) => {
        await refsGate;
        await route.continue();
      });
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let diffRequests = 0;
    let peak = 0;
    const active = new Set<Request>();
    page.on("request", (request) => {
      if (/\/git\/commits\/[^/]+\/diff$/.test(new URL(request.url()).pathname)) {
        diffRequests += 1;
        active.add(request);
        peak = Math.max(peak, active.size);
      }
    });
    const done = (request: Request) => {
      active.delete(request);
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
    await page.goto(route(null, null));
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    resumeRefs();
    await page.getByRole("combobox", { name: "Git branch" }).waitFor({ state: "visible" });
    await page.waitForURL((url) => url.searchParams.get("ref") === "refs/heads/main");
    await page.locator(".git-commit-row").nth(49).waitFor({ state: "visible" });
    if (
      viewport.width === 820 &&
      !(await page
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().right > 0))
    )
      throw new Error("Resolving the default branch closed the opened list drawer");
    if ((await page.locator(".git-commit-row").count()) !== 50)
      throw new Error("History did not start with 50 commits");
    await page.getByRole("button", { name: "Load older" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".git-commit-row").length > 50);
    const count = await page.locator(".git-commit-row").count();
    const commitRow = page.locator(".git-commit-row", {
      hasText: "Improve reading and preserve historical context",
    });
    if (
      (await commitRow.locator(".commit-added").innerText()) !== "+163" ||
      (await commitRow.locator(".commit-deleted").innerText()) !== "−163"
    )
      throw new Error("Commit list line totals differ from the fixture");
    if (!/\d{1,2}:\d{2}/.test(await commitRow.locator("time").innerText()))
      throw new Error("Commit list omitted the time");
    const listDate = await commitRow.locator("time").innerText();
    await commitRow.click();
    await waitForCommit(page, updated);
    await page
      .locator('.diff-card[data-path="src/review.ts"] .diff-row')
      .last()
      .waitFor({ state: "visible" });
    await allDiffsReady(page);
    const metadata = page.locator(".commit-meta-detail");
    if (
      (await metadata.locator(".commit-added").innerText()) !== "+163" ||
      (await metadata.locator(".commit-deleted").innerText()) !== "−163"
    )
      throw new Error("Commit detail line totals disagree with its list");
    if ((await metadata.locator("time").innerText()) !== listDate)
      throw new Error("List and detail timestamps differ");
    if (!(await metadata.locator(".commit-comparison").innerText()).startsWith("(parent: "))
      throw new Error("Commit parent is not inline metadata");
    if (
      !(await metadata.evaluate((element) => {
        const author = element.querySelector(".commit-author")?.getBoundingClientRect();
        const time = element.querySelector("time")?.getBoundingClientRect();
        const identity = element.querySelector(".commit-id-group")?.getBoundingClientRect();
        const stats = element.querySelector(".commit-stats")?.getBoundingClientRect();
        return (
          author !== undefined &&
          time !== undefined &&
          identity !== undefined &&
          stats !== undefined &&
          Math.abs(author.top - time.top) < 2 &&
          identity.top >= author.bottom &&
          stats.left >= identity.right &&
          Math.abs(identity.top - stats.top) < 2
        );
      }))
    )
      throw new Error("Commit metadata lost its two-row alignment");
    if (peak > 3) throw new Error(`Commit diff requests exceeded the concurrency limit: ${peak}`);
    if ((await page.locator('.diff-card[data-layer="commit"]').count()) !== 5)
      throw new Error("Commit omitted a changed file");
    if (
      !(await page.locator(".commit-message").innerText()).includes("Changes include TypeScript, C")
    )
      throw new Error("Full commit message was lost");
    if (
      (
        await page.locator('.diff-card[data-path="src/review.ts"] .diff-code').allTextContents()
      ).some((text) => text.includes("working tree"))
    )
      throw new Error("Historical diff used current content");
    const imageCard = page.locator('.diff-card[data-path="assets/card.svg"]');
    await imageCard.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.diff-card[data-path="assets/card.svg"] img')];
      return (
        images.length === 2 &&
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        )
      );
    });
    for (const side of ["old", "new"]) {
      const raw = new URL(
        (await imageCard
          .getByRole("link", { name: "Open raw" })
          .nth(side === "old" ? 0 : 1)
          .getAttribute("href")) ?? "",
        page.url(),
      );
      if (
        !raw.pathname.endsWith("/raw/commit") ||
        raw.searchParams.get("commit") !== updated ||
        raw.searchParams.get("side") !== side
      )
        throw new Error("Historical preview linked the wrong source");
    }
    await page.getByRole("button", { name: "Wrap: on", exact: true }).click();
    const longCode = page.locator('.diff-card[data-path="src/long-line.c"] .diff-scroll');
    await longCode.scrollIntoViewIfNeeded();
    if (
      !(await longCode.evaluate((element) => {
        element.scrollLeft = 300;
        return element.scrollWidth > element.clientWidth && element.scrollLeft > 0;
      }))
    )
      throw new Error("Historical code did not scroll with wrapping off");
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
      throw new Error("Unwrapped historical code widened the page");
    await page.getByRole("button", { name: "Wrap: off", exact: true }).click();
    if (!(await longCode.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)))
      throw new Error("Historical code did not fit with wrapping on");
    const added = page.locator('.diff-card[data-path="src/review.ts"] .diff-row-added').first();
    if (viewport.width < 1200) await added.tap();
    else await added.click();
    await page.locator(".diff-line-action").waitFor({ state: "visible" });
    if ((await page.locator(".diff-line-action").innerText()).includes("Comment"))
      throw new Error("Historical row offered a working-copy comment");
    await page.locator(".diff-line-action").click();
    const review = page.locator('.diff-card[data-path="src/review.ts"]');
    await review.locator(".diff-card-toggle").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 600));
    const before = await page.evaluate(() => window.scrollY);
    const commitUrl = page.url();
    const requests = diffRequests;
    await page.goBack();
    await page.waitForURL((url) => url.searchParams.get("commit") === null);
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    if ((await page.locator(".git-commit-row").count()) !== count)
      throw new Error("Back lost loaded history pages");
    await page.goForward();
    await page.waitForURL(commitUrl);
    await waitForCommit(page, updated);
    await page.waitForTimeout(100);
    if (diffRequests !== requests) throw new Error("Back/Forward refetched immutable diffs");
    if (Math.abs((await page.evaluate(() => window.scrollY)) - before) > 2)
      throw new Error("Back/Forward lost the commit reading position");
    await review.locator(".diff-card-toggle").click();
    if (page.url() !== commitUrl) throw new Error("A card toggle changed the route");
    if ((await review.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "false")
      throw new Error("Historical card did not collapse");
    if (viewport.width < 900) await page.getByRole("button", { name: "Open list" }).click();
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Files", exact: true })
      .click();
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    await page.locator(".file-tree-row").first().waitFor({ state: "visible" });
    await page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("button", { name: "Git", exact: true })
      .click();
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    await page
      .locator(".git-commit-row", { hasText: "Improve reading and preserve historical context" })
      .click();
    await waitForCommit(page, updated);
    if ((await review.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "false")
      throw new Error("Section navigation lost card state");
    if (diffRequests !== requests)
      throw new Error("Section navigation reloaded cached commit diffs");
    if (viewport.width < 900) await page.getByRole("button", { name: "Open list" }).click();
    await checkHistoryRefresh(page, count);
    await page
      .locator(".git-commit-row", { hasText: "Improve reading and preserve historical context" })
      .click();
    await waitForCommit(page, updated);
    if (
      diffRequests !== requests ||
      (await review.locator(".diff-card-toggle").getAttribute("aria-expanded")) !== "false"
    )
      throw new Error("History refresh invalidated immutable diff or card state");
    if (viewport.width < 900) await page.getByRole("button", { name: "Open list" }).click();
    await page
      .getByRole("combobox", { name: "Git branch" })
      .selectOption("refs/heads/feature/navigation");
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    await page.locator(".git-commit-row", { hasText: "Add the feature branch" }).click();
    await waitForCommit(page, feature);
    if (viewport.width < 900) await page.getByRole("button", { name: "Open list" }).click();
    await page
      .getByRole("combobox", { name: "Git branch" })
      .selectOption("refs/remotes/origin/main");
    if (viewport.width > 600 && viewport.width < 900)
      await page.getByRole("button", { name: "Open list" }).click();
    await page.locator(".git-commit-row", { hasText: "Merge the feature branch" }).click();
    await waitForCommit(page, merge);
    if (!(await page.locator(".commit-comparison").innerText()).includes("first parent"))
      throw new Error("Merge comparison was not labeled");
    await page.reload();
    await waitForCommit(page, merge);
    const direct = await context.newPage();
    await direct.goto(route("refs/heads/main", updated));
    await waitForCommit(direct, updated);
    if (!new URL(page.url()).searchParams.get("ref")?.includes("refs/remotes/origin/main"))
      throw new Error("Another tab changed the selected branch");
    if (viewport.width === 390) {
      await direct.getByRole("button", { name: "Open list" }).click();
      await direct.setViewportSize({ width: 320, height: 700 });
      if ((await direct.locator(".sidebar-project-tabs button").count()) !== 4)
        throw new Error("Git tab is missing");
      if (!(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
        throw new Error("Four tabs overflowed a 320 px phone");
      await direct
        .locator(".git-commit-row", { hasText: "Improve reading and preserve historical context" })
        .click();
      await waitForCommit(direct, updated);
      if (!(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
        throw new Error("Full SHA and metadata overflowed at 320 px");
      await direct.goto(route("refs/heads/main", root));
      await waitForCommit(direct, root);
      if ((await direct.locator(".commit-meta-detail .commit-comparison").innerText()) !== "(root)")
        throw new Error("Root commit metadata was mislabeled");
      const longAuthor = "A very long author name with spaces and anunbrokenpart".repeat(3);
      await direct.route(/\/git\/commits\/[0-9a-f]+$/, async (route) => {
        const response = await route.fetch();
        const commit = parseCommitDetail((await response.json()) as unknown);
        await route.fulfill({
          response,
          json: {
            ...commit,
            author: longAuthor,
            stats: { kind: "ready", added: 9_999_999, deleted: 4_444_444, binaryFiles: 2 },
          },
        });
      });
      await direct.route(/\/git\/log\?/, async (route) => {
        const response = await route.fetch();
        const history = parseGitHistory((await response.json()) as unknown);
        await route.fulfill({
          response,
          json: {
            ...history,
            commits: history.commits.map((commit) => ({
              ...commit,
              author: longAuthor,
              stats: { kind: "ready", added: 9_999_999, deleted: 4_444_444, binaryFiles: 2 },
            })),
          },
        });
      });
      await direct.reload();
      await direct.locator(".commit-meta-detail .commit-author", { hasText: longAuthor }).waitFor();
      if (!(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
        throw new Error("Long author or large counts overflowed phone commit metadata");
      await direct.getByRole("button", { name: "Open list" }).click();
      await direct
        .locator(".git-commit-row .commit-author", { hasText: longAuthor })
        .first()
        .waitFor();
      if (!(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
        throw new Error("Long author or large counts overflowed phone list metadata");
    }
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)))
      throw new Error(`Git view overflowed at ${viewport.width}`);
    if (errors.length > 0) throw new Error(errors.join("; "));
    console.log(
      `Git navigation, history refresh/recovery, historical review, cache and layout passed at ${viewport.width}px; peak diff requests ${peak}.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
