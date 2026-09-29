import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun run qa:live-changes <local app URL>");

const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "live-changes-"));
const folder = basename(project);
const source = resolve(project, "src/live.ts");
const lines = Array.from({ length: 90 }, (_, index) => `export const row${index + 1} = ${index + 1};`);
function content(value: string): string { return lines.map((line, index) => index === 40 ? `export const message = "${value}";` : line).join("\n") + "\n"; }
function git(...args: string[]): void { execFileSync("git", args, { cwd: project, stdio: "pipe" }); }

const views = [
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "tablet-portrait", width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: "tablet-landscape", width: 1180, height: 820, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;
const screenshotDir = resolve("qa/screenshots/navigation-live-update-review");
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

try {
  git("init", "-q");
  await mkdir(resolve(project, "src"));
  await writeFile(source, content("base"));
  git("add", ".");
  git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");
  await writeFile(source, content("first"));

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const openPages = [];
  const errors: string[] = [];
  for (const view of views) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, isMobile: view.isMobile, hasTouch: view.hasTouch });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${view.name}: ${error.message}`));
    await page.goto(url, { waitUntil: "load" });
    await page.getByRole("button", { name: new RegExp(folder) }).click();
    await page.getByRole("button", { name: /Open this folder/ }).click();
    const card = page.locator('main .diff-card[data-layer="unstaged"][data-path="src/live.ts"]');
    await card.locator(".diff-card-toggle").click();
    await card.getByText('export const message = "first";').waitFor({ state: "visible" });
    openPages.push({ context, page, card, name: view.name });
  }

  const phone = openPages[0];
  if (phone === undefined) throw new Error("Phone page was not created");
  await phone.card.locator(".diff-row-added").filter({ hasText: "message" }).tap();
  await phone.card.locator(".diff-line-action").click();
  await phone.page.getByPlaceholder("What should change?").fill("Keep this draft through updates.");
  await phone.page.getByRole("button", { name: "Save comment" }).click();
  await phone.page.waitForTimeout(300);
  const before = await phone.page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('main .diff-card[data-path="src/live.ts"]');
    return { scrollY, top: card?.getBoundingClientRect().top ?? 0 };
  });

  await writeFile(source, content("other"));
  await Promise.all(openPages.map(async ({ page, card }) => {
    await page.locator(".changes-update").waitFor({ state: "visible", timeout: 16_000 });
    if (!(await card.textContent())?.includes('message = "first"')) throw new Error("Pending update replaced the displayed diff");
    if ((await card.textContent())?.includes('message = "other"')) throw new Error("New code appeared before Update was tapped");
    const fit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
    if (!fit) throw new Error("Page-wide horizontal overflow with update action");
  }));

  await mkdir(screenshotDir, { recursive: true });
  for (const { page, name } of openPages) await page.screenshot({ path: resolve(screenshotDir, `${name}.png`) });
  await writeFile(resolve(screenshotDir, "manifest.json"), JSON.stringify({ url, fixture: "temporary Git project", state: "New edits action with expanded diff" }, null, 2) + "\n");

  await phone.page.setViewportSize({ width: 320, height: 700 });
  const narrowFit = await phone.page.evaluate(() => {
    const update = document.querySelector(".changes-update")?.getBoundingClientRect();
    const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
    return { update, feedback, pageWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth };
  });
  if (narrowFit.update === undefined || narrowFit.feedback === undefined || narrowFit.update.left < 0 || narrowFit.update.right > 320 || narrowFit.update.bottom > narrowFit.feedback.top || narrowFit.pageWidth > narrowFit.viewportWidth + 2) throw new Error(`Update action does not fit the narrow phone: ${JSON.stringify(narrowFit)}`);
  await phone.page.setViewportSize({ width: 390, height: 844 });

  await phone.page.locator(".changes-update").click();
  await phone.card.getByText('export const message = "other";').waitFor({ state: "visible" });
  if (await phone.card.locator(".diff-card-toggle").getAttribute("aria-expanded") !== "true") throw new Error("Update collapsed the open card");
  if (!(await phone.page.getByRole("button", { name: /Feedback 1/ }).isVisible())) throw new Error("Update lost the draft comment");
  const after = await phone.page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('main .diff-card[data-path="src/live.ts"]');
    return { scrollY, top: card?.getBoundingClientRect().top ?? 0 };
  });
  if (before.scrollY > 0 && Math.abs(after.top - before.top) > 180) throw new Error(`Update moved the active card too far: ${JSON.stringify({ before, after })}`);

  await phone.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await writeFile(source, content("third"));
  await phone.page.waitForTimeout(11_000);
  if (await phone.page.locator(".changes-update").isVisible()) throw new Error("Hidden tab still showed an update");
  await phone.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await phone.page.locator(".changes-update").waitFor({ state: "visible", timeout: 3_000 });
  await phone.page.locator(".changes-update").click();
  await phone.card.getByText('export const message = "third";').waitFor({ state: "visible" });

  let activeChecks = 0;
  let maximumChecks = 0;
  await phone.page.route("**/api/projects/*/status", async (route) => {
    activeChecks += 1;
    maximumChecks = Math.max(maximumChecks, activeChecks);
    await new Promise((finish) => setTimeout(finish, 300));
    activeChecks -= 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "QA check failure" } }) });
  });
  await phone.page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); document.dispatchEvent(new Event("visibilitychange")); });
  await phone.page.getByRole("status").filter({ hasText: "Could not check for new edits" }).waitFor({ state: "visible", timeout: 4_000 });
  if (maximumChecks !== 1 || !(await phone.card.textContent())?.includes('message = "third"')) throw new Error("Polling requests overlapped or a check failure replaced the review");
  await phone.page.unroute("**/api/projects/*/status");
  await phone.page.getByRole("button", { name: "Refresh", exact: true }).click();
  await phone.page.getByRole("status").filter({ hasText: "Could not check for new edits" }).waitFor({ state: "detached" });
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log("Live edits appeared on four viewports without replacing code; Update kept the card and draft; 320px fit, hidden-tab pause/resume, serialized checks, error recovery, and manual Refresh passed.");
} finally {
  await browser?.close();
  await rm(project, { recursive: true, force: true });
}
