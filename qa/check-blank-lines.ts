import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Page } from "playwright-core";
import { testGit as git, testGitText } from "../src/test-support.ts";
import { codeTypographyStorageKey, defaultCodeTypography } from "../src/client/storage.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined) throw new Error("Usage: bun qa/check-blank-lines.ts <local app URL>");
const url = appUrl(rawUrl);
const artifacts = resolve("qa/.artifacts");
await mkdir(artifacts, { recursive: true });
const project = await mkdtemp(resolve(artifacts, "blank-lines-"));
const folder = basename(project);
const source = "\n\nconst short = true;\n\n \t\n\n";
const crlfSource = "const head = 1;\r\n\r\n \t\r\nconst tail = 2;\r\n";

function destination(section: "changes" | "files" | "git", path?: string): string {
  const destination = new URL(url);
  destination.search = "";
  destination.searchParams.set("section", section);
  destination.searchParams.set("project", folder);
  if (path !== undefined) destination.searchParams.set("file", path);
  return destination.href;
}

async function checkRows(page: Page, selector: string): Promise<string[]> {
  const rows = page.locator(selector);
  await rows.first().waitFor({ state: "visible" });
  const measured = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const code = row.querySelector("code");
      if (!(code instanceof HTMLElement)) throw new Error("Missing source element");
      const style = getComputedStyle(code);
      return {
        text: code.textContent ?? "",
        height: row.getBoundingClientRect().height,
        codeHeight: code.getBoundingClientRect().height,
        expected:
          parseFloat(style.lineHeight) +
          parseFloat(style.paddingTop) +
          parseFloat(style.paddingBottom),
      };
    }),
  );
  for (const row of measured) {
    if (
      row.text.trim() === "" &&
      (Math.abs(row.height - row.expected) > 0.1 || Math.abs(row.codeHeight - row.expected) > 0.1)
    )
      throw new Error(`Blank source row collapsed: ${JSON.stringify(row)}`);
  }
  if (!measured.some((row) => row.text === "")) throw new Error("Fixture has no empty rows");
  await assertNoHorizontalOverflow(page);
  return measured.map((row) => row.text);
}

try {
  git(project, "init", "-q");
  await writeFile(
    resolve(project, "sample.ts"),
    "const before = 1;\n\n\nconst value = 'old';\nconst tail = 3;\n",
  );
  await writeFile(resolve(project, "removed.ts"), "\n\n");
  git(project, "add", ".");
  git(project, "commit", "-qm", "baseline");
  const commit = testGitText(project, "rev-parse", "HEAD");
  await writeFile(
    resolve(project, "sample.ts"),
    "const before = 1;\n\nconst value = 'new';\n\nconst tail = 3;\n",
  );
  git(project, "rm", "removed.ts");
  git(project, "add", "sample.ts");
  await writeFile(resolve(project, "blank.ts"), source);
  await writeFile(resolve(project, "crlf.ts"), crlfSource);

  await withQaBrowser(async (browser) => {
    for (const profile of Object.values(qaProfiles)) {
      for (const fontSize of [11, 12, 20]) {
        await withQaContext(browser, profile, async (context) => {
          await context.addInitScript(
            ({ key, typography, origin }) => {
              if (location.origin === origin) localStorage.setItem(key, JSON.stringify(typography));
            },
            {
              key: codeTypographyStorageKey,
              typography: { ...defaultCodeTypography, fontSize },
              origin: url.origin,
            },
          );
          const page = await context.newPage();
          await page.goto(destination("changes"), { waitUntil: "load" });
          await page.locator('.diff-card[data-path="blank.ts"]').waitFor({ state: "visible" });
          await page.getByRole("button", { name: "Expand all", exact: true }).click();
          for (const path of ["sample.ts", "removed.ts", "blank.ts", "crlf.ts"])
            await page
              .locator(`.diff-card[data-path="${path}"] .diff-row`)
              .first()
              .waitFor({ state: "visible" });
          if (
            (await page
              .locator('.diff-card[data-path="blank.ts"] code')
              .first()
              .evaluate((code) => parseFloat(getComputedStyle(code).fontSize))) !== fontSize
          )
            throw new Error("Requested source typography was not applied");
          for (const wrap of [true, false]) {
            if (wrap === false)
              await page.getByRole("button", { name: "Wrap: on", exact: true }).click();
            for (const kind of ["context", "added", "removed"])
              await checkRows(page, `.diff-row-${kind}`);
            const texts = await checkRows(page, '.diff-card[data-path="blank.ts"] .diff-row');
            if (texts.join("\n") !== source.slice(0, -1))
              throw new Error("Diff source text changed");
            if (wrap && profile === qaProfiles.phone && fontSize === 12) {
              await page.locator('.diff-card[data-path="blank.ts"] .diff-row').first().tap();
              await page
                .getByRole("button", { name: /Comment on new line 1/ })
                .waitFor({ state: "visible" });
              await page.keyboard.press("Escape");
            }
          }
          const plainCard = page.locator('.diff-card[data-path="blank.ts"]');
          await plainCard.getByLabel("Language").selectOption("text");
          await page.waitForFunction(
            () => !document.querySelector('.diff-card[data-path="blank.ts"] .syntax-token-keyword'),
          );
          await checkRows(page, '.diff-card[data-path="blank.ts"] .diff-row');
          // Historical inspection shares the source renderer without comment actions.
          const historical = new URL(destination("git"));
          historical.searchParams.set("commit", commit);
          await page.goto(historical.href, { waitUntil: "load" });
          await checkRows(page, '.diff-card[data-path="removed.ts"] .diff-row');

          for (const [path, text] of [
            ["blank.ts", source],
            ["crlf.ts", crlfSource],
          ] as const) {
            await page.goto(destination("files", path), { waitUntil: "load" });
            for (const wrap of [true, false]) {
              const wrapButton = page.getByRole("button", {
                name: `Wrap: ${wrap ? "off" : "on"}`,
                exact: true,
              });
              if (await wrapButton.count()) await wrapButton.click();
              const texts = await checkRows(page, ".file-code-row");
              if (texts.join("\n") !== text.replaceAll("\r\n", "\n").slice(0, -1))
                throw new Error("Files source text changed");
            }
            await page.getByLabel("Language").selectOption("text");
            await page.waitForFunction(
              () => !document.querySelector(".file-panel .syntax-token-keyword"),
            );
            await checkRows(page, ".file-code-row");
          }
        });
      }
    }
  });
  console.log(
    "Empty/whitespace row heights and exact source text passed in Changes, historical Git, and Files at phone, both tablet orientations, desktop, 11/12/20px typography, and both wrapping modes.",
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
