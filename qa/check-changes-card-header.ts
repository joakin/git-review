import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Locator } from "playwright-core";
import { parseRootResponse } from "@git-review/shared/api";
import { responseBody } from "../apps/web/src/api.ts";
import { routeUrl } from "../apps/web/src/navigation.ts";
import { testGit, testGitText } from "./test-support.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

const rawUrl = process.argv[2];
if (rawUrl === undefined)
  throw new Error("Usage: bun qa/check-changes-card-header.ts <isolated fixture server URL>");
const base = appUrl(rawUrl);
const root = parseRootResponse(await responseBody(await fetch(new URL("/api/roots", base))));
const fixture = await mkdtemp(join(root.path, "changes-card-header-"));
const projectPath = basename(fixture);
const longPath = `src/${"long-folder-name-".repeat(4)}/source-file-with-a-long-descriptive-name.ts`;

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function ready(card: Locator) {
  await card.locator(".diff-row, .diff-message").first().waitFor();
  await card
    .page()
    .waitForFunction(
      (id) => document.getElementById(id)?.getAttribute("data-diff-state") === "ready",
      (await card.getAttribute("id")) ?? "",
    );
}
async function display(card: Locator, text: string) {
  await card
    .page()
    .waitForFunction(
      ({ id, text }) =>
        document.getElementById(id)?.querySelector(".language-picker-value")?.textContent === text,
      { id: (await card.getAttribute("id")) ?? "", text },
    )
    .catch(async (error: unknown) => {
      throw new Error(
        `${await card.getAttribute("data-path")}: expected ${text}, displayed ${await card.locator(".language-picker-value").allTextContents()}; ${String(error)}`,
      );
    });
}
async function inlineStats(card: Locator, name: string) {
  const position = await card.evaluate((element) => {
    const description = element.querySelector(".change-description")?.getBoundingClientRect();
    const counts = element.querySelector(".line-counts")?.getBoundingClientRect();
    if (description === undefined || counts === undefined) throw new Error("Missing card metadata");
    return {
      gap: counts.left - description.right,
      aligned: Math.abs(
        (counts.top + counts.bottom) / 2 - (description.top + description.bottom) / 2,
      ),
    };
  });
  assert(
    position.gap > 0 && position.gap < 40 && position.aligned <= 2,
    `${name}: counts do not sit beside the status: ${JSON.stringify(position)}`,
  );
}
async function pickerWidth(select: Locator) {
  return select.evaluate((element) => {
    const label = element.parentElement;
    if (label === null) throw new Error("Language label missing");
    return label.getBoundingClientRect().width;
  });
}

try {
  await mkdir(join(fixture, "src"));
  await mkdir(join(fixture, "docs"));
  testGit(fixture, "init", "-q");
  await writeFile(join(fixture, "src/view.ts"), "export const view = 'initial';\n");
  await writeFile(join(fixture, "src/deleted.ts"), "export const deleted = true;\n");
  await writeFile(join(fixture, "docs/old name.md"), "A renamed document to read in Files.\n");
  testGit(fixture, "add", ".");
  testGit(fixture, "commit", "-qm", "card header baseline");
  await writeFile(join(fixture, "src/view.ts"), "export const view = 'staged';\n");
  testGit(fixture, "add", "src/view.ts");
  testGit(fixture, "rm", "-q", "src/deleted.ts");
  testGit(fixture, "mv", "docs/old name.md", "docs/new name.md");
  await writeFile(
    join(fixture, "src/view.ts"),
    "export const view = 'working tree';\nexport const extraLine = true;\n",
  );
  await mkdir(join(fixture, dirname(longPath)), { recursive: true });
  await writeFile(
    join(fixture, longPath),
    Array.from({ length: 180 }, (_, i) => `export const line${i + 1} = ${i + 1};\n`).join(""),
  );
  await writeFile(join(fixture, "src/notes.unknown"), "Unknown extension, readable plain text.\n");
  await writeFile(join(fixture, "src/data.bin"), Buffer.from([0, 1, 2, 3]));
  await mkdir(join(fixture, "vendor/module"), { recursive: true });
  testGit(
    fixture,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${testGitText(fixture, "rev-parse", "HEAD")},vendor/module`,
  );
  const changesUrl = new URL(
    routeUrl({ section: "changes", projectPath, target: { kind: "all" } }),
    base,
  );
  await withQaBrowser(async (browser) => {
    for (const [name, profile] of Object.entries({
      ...qaProfiles,
      narrow: { viewport: { width: 320, height: 740 }, hasTouch: true },
    })) {
      await withQaContext(browser, profile, async (context) => {
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        const diffReads: string[] = [];
        page.on("request", (request) => {
          if (/\/api\/project\/diffs?$/.test(new URL(request.url()).pathname))
            diffReads.push(request.url());
        });
        const card = (path: string, layer = "untracked") =>
          page.locator(`main .diff-card[data-layer="${layer}"][data-path="${path}"]`);
        const staged = card("src/view.ts", "staged");
        const open = (target: Locator) => target.getByRole("button", { name: / in Files$/ });
        const activate = async (target: Locator) => {
          if ("hasTouch" in profile && profile.hasTouch) await target.tap();
          else await target.click();
        };
        const back = async () => {
          await page.getByRole("button", { name: "Go back", exact: true }).click();
          await staged.waitFor();
          assert(page.url() === changesUrl.href, `${name}: Back did not restore Changes`);
        };
        await page.goto(changesUrl.href);
        await staged.waitFor();
        await inlineStats(staged, name);
        assert(diffReads.length === 0, `${name}: collapsed headers eagerly read diffs`);
        assert((await staged.getByRole("combobox").count()) === 0, `${name}: collapsed picker`);
        await activate(open(staged));
        await page.locator('.file-panel[data-path="src/view.ts"] .file-code-row').first().waitFor();
        const fileRoute = new URL(page.url()).searchParams;
        assert(
          fileRoute.get("section") === "files" &&
            fileRoute.get("project") === projectPath &&
            fileRoute.get("dir") === "src" &&
            fileRoute.get("file") === "src/view.ts" &&
            fileRoute.get("line") === null,
          `${name}: Open did not navigate to the complete working file and its parent`,
        );
        const contents = (await page.locator(".file-code-line").allTextContents()).join("\n");
        assert(
          contents.includes("working tree") && contents.includes("extraLine"),
          `${name}: Open showed the staged snapshot instead of the whole working file`,
        );
        await back();
        assert(
          (await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "false",
          `${name}: Open toggled a collapsed card`,
        );
        let releaseRead = () => {};
        const readGate = new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        await page.route("**/api/project/diff*", async (route) => {
          await readGate;
          await route.fulfill({ status: 503, json: { error: "Diff read unavailable" } });
        });
        try {
          await activate(staged.locator(".diff-card-toggle"));
          await display(staged, "Auto");
          assert(
            (await staged.getAttribute("data-diff-state")) === "loading",
            `${name}: pending language display is not tied to loading`,
          );
        } finally {
          releaseRead();
        }
        await staged.getByRole("alert").waitFor();
        assert(
          (await staged.getByRole("combobox").count()) === 1 && (await open(staged).isEnabled()),
          `${name}: a read error removed header actions`,
        );
        await page.unroute("**/api/project/diff*");
        await staged.getByRole("button", { name: "Retry", exact: true }).click();
        await ready(staged);
        await display(staged, "TypeScript");
        await inlineStats(staged, name);
        assert((await staged.locator(".diff-language-row").count()) === 0, `${name}: language row`);
        const language = staged.getByRole("combobox", { name: "Language", exact: true });
        const width = await pickerWidth(language);
        if (name === "desktop") {
          const heading = staged.locator(".diff-card-heading");
          const background = await heading.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          );
          await staged.locator(".diff-card-toggle").hover();
          assert(
            (await staged
              .locator(".diff-card-toggle")
              .evaluate((element) => getComputedStyle(element).backgroundColor)) ===
              "rgba(0, 0, 0, 0)" &&
              (await heading.evaluate((element) => getComputedStyle(element).backgroundColor)) ===
                background,
            "desktop: hovering the title painted a separate heading surface",
          );
        }
        assert((await language.inputValue()) === "auto", `${name}: detection became an override`);
        assert(
          (await language.locator('option[value="auto"]').textContent()) === "Auto detect",
          `${name}: the menu lost its automatic-mode choice`,
        );
        await staged.locator(".diff-card-toggle").focus();
        await page.keyboard.press("Tab");
        assert(
          await language.evaluate((element) => element === document.activeElement),
          `${name}: keyboard focus`,
        );
        assert(
          (await language.evaluate((element) => {
            const label = element.parentElement;
            if (label === null) throw new Error("Language label missing");
            return getComputedStyle(label).outlineStyle;
          })) === "solid",
          `${name}: compact language control has no keyboard focus indicator`,
        );
        // Headless macOS Chrome does not dispatch choices in desktop native popups, including
        // the standard Files picker. Mobile emulation supports direct arrow-key selection.
        if ("isMobile" in profile && profile.isMobile) await language.press("ArrowDown");
        else await language.selectOption("text");
        await display(staged, "Plain text");
        await ready(staged);
        assert(
          Math.abs((await pickerWidth(language)) - width) <= 1,
          `${name}: plain-text picker width changed`,
        );
        await language.selectOption("cpp");
        await display(staged, "C++");
        await ready(staged);
        assert(
          Math.abs((await pickerWidth(language)) - width) <= 1,
          `${name}: short language changed picker width`,
        );
        await inlineStats(staged, name);
        assert(page.url() === changesUrl.href, `${name}: choosing language navigated`);
        assert(
          (await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
          `${name}: choosing language collapsed the card`,
        );
        await page.reload();
        await ready(staged);
        await display(staged, "C++");
        assert((await language.inputValue()) === "cpp", `${name}: override was not saved`);
        await language.selectOption("auto");
        await ready(staged);
        await display(staged, "TypeScript");
        await activate(open(staged));
        await page.locator(".file-code-row").first().waitFor();
        await back();
        await ready(staged);
        assert(
          (await staged.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
          `${name}: Open or Back discarded expansion`,
        );
        const renamed = card("docs/new name.md", "staged");
        await activate(open(renamed));
        await page.locator('.file-panel[data-path="docs/new name.md"] .file-code-row').waitFor();
        assert(new URL(page.url()).searchParams.get("dir") === "docs", `${name}: rename parent`);
        await page.goBack();
        await staged.waitFor();
        assert(page.url() === changesUrl.href, `${name}: browser Back destination`);
        assert(await open(card("src/deleted.ts", "staged")).isDisabled(), `${name}: deleted Open`);
        assert(await open(card("vendor/module", "staged")).isDisabled(), `${name}: submodule Open`);
        const plain = card("src/notes.unknown");
        await activate(plain.locator(".diff-card-toggle"));
        await ready(plain);
        await display(plain, "Plain text");
        await page.route("**/api/project/file?*", (route) =>
          route.fulfill({ status: 503, json: { error: "File read unavailable" } }),
        );
        await activate(open(plain));
        await page.locator(".file-panel").getByRole("alert").waitFor();
        await page.unroute("**/api/project/file?*");
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.locator(".file-code-row").waitFor();
        await back();
        const binary = card("src/data.bin");
        await activate(binary.locator(".diff-card-toggle"));
        await ready(binary);
        assert((await binary.getByRole("combobox").count()) === 0, `${name}: binary picker`);
        assert(await open(binary).isEnabled(), `${name}: binary file cannot be opened`);
        const tall = card(longPath);
        await activate(tall.locator(".diff-card-toggle"));
        await ready(tall);
        await display(tall, "TypeScript");
        if (profile.viewport.width <= 600) {
          const widths = await tall.evaluate((element) => ({
            card: element.getBoundingClientRect().width,
            title: element.querySelector(".diff-card-title")?.getBoundingClientRect().width ?? 0,
          }));
          assert(
            widths.title >= widths.card / 2,
            `${name}: header controls crushed a long path into a narrow column`,
          );
        }
        await assertNoHorizontalOverflow(page);
        await tall.evaluate((element) =>
          window.scrollTo({
            top: window.scrollY + element.getBoundingClientRect().top + 350,
            behavior: "instant",
          }),
        );
        await page.waitForFunction(
          () => document.querySelector(".diff-card-heading-pinned") !== null,
        );
        const geometry = await tall.evaluate((element) => {
          const header = element.querySelector(".diff-card-heading");
          const section = element.closest(".diff-section")?.querySelector(".diff-section-heading");
          const actions = element.querySelector(".diff-card-actions");
          if (!header || !section || !actions) throw new Error("Missing sticky header controls");
          return {
            top: header.getBoundingClientRect().top,
            sectionBottom: section.getBoundingClientRect().bottom,
            bottom: header.getBoundingClientRect().bottom,
            actionBottom: actions.getBoundingClientRect().bottom,
          };
        });
        assert(
          Math.abs(geometry.top - geometry.sectionBottom) <= 2 &&
            geometry.actionBottom <= geometry.bottom,
          `${name}: sticky header left its actions behind: ${JSON.stringify(geometry)}`,
        );
        if (name === "narrow")
          await page.screenshot({ path: "qa/.artifacts/changes-header-narrow.png" });
        await activate(open(tall));
        await page.locator(".file-code-row").first().waitFor();
        assert((await page.locator(".file-code-row").count()) === 180, `${name}: whole tall file`);
        console.log(
          `${name}: collapsed/expanded Open, current file, parent/rename paths, app/browser Back, native language choices, keyboard focus, automatic display, persistence, exceptional files, long paths, sticky actions and overflow passed`,
        );
      });
    }
  });
} finally {
  await rm(fixture, { recursive: true, force: true });
}
