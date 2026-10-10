import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Page } from "playwright-core";
import { testGit as git } from "../src/test-support.ts";
import { appUrl, qaProfiles, withQaBrowser, withQaContext } from "./browser-support.ts";

declare global {
  interface Window {
    codeRenderingQa: Record<string, number>;
  }
}

const rawUrl = process.argv[2];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-code-rendering.ts <fixture app URL>");
const base = appUrl(rawUrl);
const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "code-rendering-"));
const folder = basename(project);

// Observe real component execution without adding production instrumentation or changing behavior.
const bundle = await Bun.build({
  entrypoints: ["src/client/main.tsx"],
  target: "browser",
  format: "esm",
  jsx: { runtime: "automatic", importSource: "preact" },
  plugins: [
    {
      name: "code-rendering-observer",
      setup(build) {
        build.onLoad({ filter: /src\/client\/main\.tsx$/ }, async ({ path }) => ({
          loader: "tsx",
          contents: (await readFile(path, "utf8"))
            .replace('import { render } from "preact"', 'import { render, options } from "preact"')
            .replace(
              "\nrender(",
              `\nconst previousRender = options.__r;
               window.codeRenderingQa = {};
               options.__r = (node) => {
                 previousRender?.(node);
                 const name = typeof node.type === "function" ? node.type.name : "";
                 if (name === "SelectableCode")
                   window.codeRenderingQa[name] = (window.codeRenderingQa[name] ?? 0) + 1;
               };
               render(`,
            ),
        }));
      },
    },
  ],
});
const output = bundle.outputs[0];
if (!bundle.success || output === undefined) throw new Error(bundle.logs.join("\n"));
const script = await output.text();

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function observe(page: Page, name: string, action: () => Promise<void>, maximum: number) {
  await settle(page);
  await page.evaluate(() => {
    window.codeRenderingQa = {};
  });
  await action();
  await settle(page);
  const counts = await page.evaluate(() => window.codeRenderingQa);
  if (Object.values(counts).some((count) => count > maximum))
    throw new Error(`${name} revisited unchanged code: ${JSON.stringify(counts)}`);
  console.log(`${name}: ${JSON.stringify(counts)}`);
}

try {
  git(project, "init", "-q");
  const source = (changed: boolean) =>
    Array.from(
      { length: 2_000 },
      (_, index) => `export const item${index} = ${changed ? index + 1 : index};`,
    ).join("\n") + "\n";
  await writeFile(resolve(project, "large.ts"), source(false));
  git(project, "add", ".");
  git(project, "commit", "-qm", "Rendering fixture");
  await writeFile(resolve(project, "large.ts"), source(true));

  await withQaBrowser(async (browser) => {
    for (const [profile, settings] of Object.entries({
      phone: qaProfiles.phone,
      desktop: qaProfiles.desktop,
    })) {
      await withQaContext(browser, settings, async (context) => {
        await context.route("**/assets/main.js", (route) =>
          route.fulfill({ contentType: "text/javascript", body: script }),
        );
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        for (const section of ["changes", "files"] as const) {
          const destination = new URL(base);
          destination.search = new URLSearchParams({ section, project: folder }).toString();
          if (section === "files") destination.searchParams.set("file", "large.ts");
          await page.goto(destination.href);
          if (section === "changes") {
            await page.getByRole("button", { name: "Expand all", exact: true }).click();
            await page.locator('.diff-card[data-diff-state="ready"]').waitFor();
          }
          const row = section === "changes" ? ".diff-row-added" : ".file-code-row";
          const code = page.locator(`${row} code`).first();
          await code.scrollIntoViewIfNeeded();
          await code.waitFor();
          const label = `${profile} ${section}`;
          const mounted = await page.evaluate(() => window.codeRenderingQa["SelectableCode"] ?? 0);
          if (mounted === 0) throw new Error(`${label} did not observe source code mounts`);
          await observe(
            page,
            `${label} reveal line action`,
            async () => {
              await code.click();
              await page.locator(".diff-line-action").waitFor();
            },
            0,
          );
          await observe(
            page,
            `${label} reposition line action`,
            async () => {
              await page.evaluate(() => window.scrollBy({ top: 12, behavior: "instant" }));
            },
            0,
          );
          await observe(
            page,
            `${label} open editor`,
            async () => {
              await page.locator(".diff-line-action").click();
              await page.locator(".comment-editor[open]").waitFor();
            },
            0,
          );
          await observe(
            page,
            `${label} type comment`,
            async () => {
              await page.locator("#comment-body").pressSequentially("review note");
            },
            0,
          );
          await observe(
            page,
            `${label} save affected marker`,
            async () => {
              await page.getByRole("button", { name: "Save comment", exact: true }).click();
              await page.locator(".comment-editor").waitFor({ state: "detached" });
            },
            1,
          );
          await page.locator(`${row} .diff-comment-dot`).first().waitFor({ state: "attached" });
        }
      });
    }
  });
} finally {
  await rm(project, { recursive: true, force: true });
}
