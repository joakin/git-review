import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { selectCodeText } from "./select-code-text.ts";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun run qa:line-action <local app URL>");

const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "line-action-"));
const folder = basename(project);
function git(...args: string[]): void { execFileSync("git", args, { cwd: project, stdio: "pipe" }); }

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  git("init", "-q");
  await mkdir(resolve(project, "src"));
  await writeFile(resolve(project, "src/sample.ts"), "const before = 1;\nconst stable = 2;\nconst changed = 'old';\n");
  git("add", ".");
  git("-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "baseline");
  await writeFile(resolve(project, "src/sample.ts"), "const before = 1;\nconst inserted = true;\nconst stable = 2;\nconst changed = 'new';\n");
  git("add", "src/sample.ts");
  await writeFile(resolve(project, "src/sample.ts"), "const before = 1;\nconst inserted = true;\nconst stable = 2;\nconst changed = 'working';\n");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: new RegExp(folder) }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const staged = page.locator('main .diff-card[data-layer="staged"][data-path="src/sample.ts"]');
  await staged.locator(".diff-card-toggle").click();
  const context = staged.locator(".diff-row-context").filter({ hasText: "const stable" });
  await context.waitFor({ state: "visible" });
  const narrow = await context.evaluate((row) => {
    const sign = row.querySelector(".diff-sign");
    const numbers = row.querySelectorAll(".diff-number");
    const code = row.querySelector(".diff-code");
    if (!(sign instanceof HTMLElement) || numbers.length !== 2 || !(code instanceof HTMLElement)) throw new Error("Incomplete row");
    return { sign: getComputedStyle(sign).display, numbers: [...numbers].map((number) => getComputedStyle(number).display), codePadding: getComputedStyle(code).paddingLeft };
  });
  if (narrow.sign !== "none" || narrow.numbers.some((display) => display !== "none") || narrow.codePadding !== "8px") throw new Error(`Phone gutter still consumes space: ${JSON.stringify(narrow)}`);

  await context.tap();
  const action = staged.locator(".diff-line-action");
  await action.waitFor({ state: "visible" });
  const overlapsFeedback = await page.evaluate(() => {
    const action = document.querySelector(".diff-line-action")?.getBoundingClientRect();
    const feedback = document.querySelector(".feedback-launch")?.getBoundingClientRect();
    return action !== undefined && feedback !== undefined && action.left < feedback.right && action.right > feedback.left && action.top < feedback.bottom && action.bottom > feedback.top;
  });
  if (overlapsFeedback) throw new Error("Line action obscured the Feedback button");
  if (!/OLD 2.*NEW 3.*Comment/.test(await action.textContent() ?? "")) throw new Error(`Wrong context line details: ${await action.textContent()}`);
  await action.click();
  if (!(await page.locator(".review-anchor").textContent())?.includes("staged · new line 3")) throw new Error("Unchanged staged row did not use its new/index line number");
  await page.getByPlaceholder("What should change?").fill("Check the stable line.");
  await page.getByRole("button", { name: "Save comment" }).click();

  const removed = staged.locator(".diff-row-removed").filter({ hasText: "const changed" });
  await removed.tap();
  await action.waitFor({ state: "visible" });
  if (!(await action.textContent())?.includes("OLD 3") || (await action.textContent())?.includes("NEW")) throw new Error("Removed line displayed the wrong side");
  await action.click();
  if (!(await page.locator(".review-anchor").textContent())?.includes("staged · old line 3")) throw new Error("Removed line did not use the old/HEAD anchor");
  await page.getByPlaceholder("What should change?").fill("This old branch needs attention.");
  await page.getByRole("button", { name: "Save comment" }).click();

  await page.getByRole("button", { name: "Feedback 2" }).click();
  const feedback = await page.locator("#review-export-text").inputValue();
  if (!feedback.includes('new line 3  "const stable = 2;"') || !feedback.includes('old line 3  "const changed = \'old\';"')) throw new Error(`Wrong feedback anchors: ${feedback}`);
  await page.getByRole("button", { name: "Close feedback" }).click();

  await context.tap();
  await action.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await action.waitFor({ state: "detached", timeout: 3000 });
  await context.tap();
  await action.waitFor({ state: "visible" });
  await selectCodeText(context.locator(".diff-code"), "stable");
  await page.locator(".code-selection-action").waitFor({ state: "visible" });
  await action.waitFor({ state: "detached", timeout: 3000 });
  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await page.setViewportSize({ width: 320, height: 700 });
  await context.tap();
  await action.waitFor({ state: "visible" });
  const narrowFit = await page.evaluate(() => {
    const action = document.querySelector(".diff-line-action")?.getBoundingClientRect();
    return { left: action?.left ?? -1, right: action?.right ?? innerWidth + 1, pageWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth };
  });
  if (narrowFit.left < 0 || narrowFit.right > 320 || narrowFit.pageWidth > narrowFit.viewportWidth + 2) throw new Error(`Line action does not fit a 320px phone: ${JSON.stringify(narrowFit)}`);
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await phone.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const widePage = await desktop.newPage();
  await widePage.goto(url, { waitUntil: "load" });
  await widePage.getByRole("button", { name: new RegExp(folder) }).click();
  await widePage.getByRole("button", { name: /Open this folder/ }).click();
  const wideCard = widePage.locator('main .diff-card[data-layer="staged"][data-path="src/sample.ts"]');
  await wideCard.locator(".diff-card-toggle").click();
  const wideContext = wideCard.locator(".diff-row-context").filter({ hasText: "const stable" });
  await wideContext.locator(".diff-code").click();
  await wideCard.locator(".diff-line-action").waitFor({ state: "visible" });
  const desktopGutter = await wideContext.locator(".diff-number-button").first().evaluate((element) => getComputedStyle(element).display);
  if (desktopGutter === "none") throw new Error("Desktop gutter was hidden");
  await wideContext.getByRole("button", { name: /Old line 2.*Add comment/ }).click();
  if (!(await widePage.locator(".review-anchor").textContent())?.includes("staged · old line 2")) throw new Error("Desktop direct old-side control stopped working");
  await desktop.close();
  console.log("Phone gutter removal and 320px fit, context New and removed Old anchors, feedback export, Escape, selection priority, and desktop row/direct controls passed.");
} finally {
  await browser?.close();
  await rm(project, { recursive: true, force: true });
}
