import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000/");
const activePath = process.argv[3] ?? "media-fixture";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base.href);
  await page.evaluate(async (selectedPath) => {
    const response = await fetch("/api/roots");
    const value: unknown = await response.json() as unknown;
    if (typeof value !== "object" || value === null || !("root" in value) || typeof value.root !== "object" || value.root === null || !("path" in value.root) || typeof value.root.path !== "string") throw new Error("Invalid root response");
    sessionStorage.setItem("git-review:active-project:v1", JSON.stringify({ version: 1, rootPath: value.root.path, activePath: selectedPath }));
  }, activePath);
  await page.reload();
  await page.locator(".project-view-tabs button").filter({ hasText: "Files" }).click();
  await page.locator('.file-tree-row[title="art.svg"]').click();
  await page.locator(".file-panel .media-preview img").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".file-panel .media-preview img");
    return image !== null && image.complete && image.naturalWidth > 0;
  });
  const link = page.locator(".file-panel .media-preview-head a");
  const path = await link.getAttribute("href");
  if (path === null || !path.startsWith("/api/projects/") || await link.getAttribute("target") !== "_blank" || await link.getAttribute("rel") !== "noopener") throw new Error("Raw link is missing or unsafe");
  const raw = await context.newPage();
  const response = await raw.goto(new URL(path, base).href);
  if (response === null || response.status() !== 200 || response.headers()["content-type"] !== "image/svg+xml" || !response.headers()["content-security-policy"]?.includes("sandbox")) throw new Error("Raw SVG headers are unsafe");
  if (await raw.evaluate(() => document.documentElement.hasAttribute("data-script-ran"))) throw new Error("Raw SVG executed its script");
  console.log("Media image rendered; raw SVG opened without executing its script.");
} finally {
  await browser.close();
}
