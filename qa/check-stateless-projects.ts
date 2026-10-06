import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testGitText as git, withTempDirectory } from "../src/test-support.ts";
import { parseFileReadResponse } from "../src/shared/api.ts";
import { projectApiUrl } from "../src/shared/project-path.ts";
import {
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

await withTempDirectory("git-review-restart-qa-", async (directory) => {
  const folder = "project : #?% 雪";
  const projectPath = join(await realpath(directory), folder);
  await mkdir(projectPath);
  await symlink(projectPath, join(directory, "alias"));
  git(projectPath, "init", "-q", "-b", "main");
  await writeFile(
    join(projectPath, "value.ts"),
    "export const value = 1;\nexport const stable = true;\n",
  );
  await writeFile(
    join(projectPath, "art.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="green"/></svg>',
  );
  git(projectPath, "add", ".");
  git(projectPath, "commit", "-qm", "Initial");
  await writeFile(
    join(projectPath, "value.ts"),
    "export const value = 2;\nexport const stable = true;\n",
  );
  git(projectPath, "add", "value.ts");

  async function start(port: number, rootPath = directory) {
    const process = Bun.spawn(
      [Bun.which("bun") ?? "bun", "src/server/main.ts", "--root", rootPath, "--port", String(port)],
      { stdout: "pipe", stderr: "inherit" },
    );
    const reader = process.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    const address = new TextDecoder().decode(first.value).match(/git-review: (http:\/\/\S+)/)?.[1];
    if (address === undefined) {
      process.kill();
      await process.exited;
      throw new Error("QA backend did not start");
    }
    return { process, url: new URL(address) };
  }
  let server = await start(0);
  const port = Number(server.url.port);
  const origin = server.url.origin;
  const destination =
    origin + "/?" + new URLSearchParams({ section: "files", project: folder, file: "value.ts" });
  try {
    await withQaBrowser(async (browser) => {
      await withQaContext(browser, qaProfiles.desktop, async (context) => {
        context.setDefaultTimeout(12_000);
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const page = await context.newPage();
        let lookups = 0;
        const resources = new Set<string>();
        page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (path === "/api/project") lookups += 1;
          if (path.startsWith("/api/project/")) resources.add(path);
        });
        await page.goto(destination);
        await page.locator('.file-code-row[data-line="1"]').waitFor();
        const historyLength = await page.evaluate(() => history.length);
        const aliasDestination = new URL(destination);
        aliasDestination.searchParams.set("project", "alias");
        aliasDestination.searchParams.set("line", "2");
        await page.goto(aliasDestination.href);
        await page.locator('.file-code-row[data-line="2"]').waitFor();
        const canonical = new URL(page.url());
        assert(canonical.searchParams.get("project") === folder, "Alias URL was not canonicalized");
        assert(
          canonical.searchParams.get("section") === "files" &&
            canonical.searchParams.get("file") === "value.ts" &&
            canonical.searchParams.get("line") === "2",
          "Alias lookup lost the file destination",
        );
        assert(lookups === 2, "Alias lookup repeated metadata resolution");
        assert(
          (await page.evaluate(() => history.length)) === historyLength + 1,
          "Alias canonicalization added a history entry",
        );
        async function edit(line: number, body: string) {
          await page.locator(`.file-code-row[data-line="${line}"] .file-code-line`).click();
          await page
            .getByRole("button", { name: `Working tree line ${line}. Comment`, exact: true })
            .click();
          await page.getByPlaceholder("Add a question, note, or suggestion…").fill(body);
        }
        await edit(1, "Saved before restart");
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await edit(2, "Editor survives restart");
        const lookupCount = lookups;
        resources.clear();
        server.process.kill();
        await server.process.exited;
        server = await start(port);
        assert(
          (await page.getByPlaceholder("Add a question, note, or suggestion…").inputValue()) ===
            "Editor survives restart",
          "Restart lost the active editor",
        );
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await page.getByRole("button", { name: "Feedback 2", exact: true }).waitFor();

        const tab = (name: string) =>
          page
            .getByRole("navigation", { name: "Project views" })
            .getByRole("button", { name, exact: true });
        await tab("Search").click();
        await page.getByRole("searchbox", { name: "Find text" }).fill("stable");
        await page.locator(".search-form button").click();
        await page.getByRole("button", { name: /^Open value.ts at line 2:/ }).waitFor();
        await tab("Changes").click();
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        const card = page.locator('main .diff-card[data-path="value.ts"]');
        await card.locator(".diff-card-toggle").click();
        await card.locator(".diff-row-added").waitFor();
        await tab("Git").click();
        await page.locator(".git-commit-row").first().click();
        await page.locator(".commit-view").waitFor();
        const commitToggle = page.locator(
          'main .diff-card[data-path="value.ts"] .diff-card-toggle',
        );
        if ((await commitToggle.getAttribute("aria-expanded")) === "false")
          await commitToggle.click();
        await page
          .locator('main .diff-card[data-path="value.ts"] .diff-row-added')
          .first()
          .waitFor();
        await tab("Files").click();
        await page.locator('.file-tree-row[title="art.svg"]').click();
        await page.waitForFunction(() => {
          const image = document.querySelector<HTMLImageElement>(".file-panel .media-preview img");
          return image !== null && image.complete && image.naturalWidth > 0;
        });
        await page.getByRole("button", { name: "Feedback 2", exact: true }).click();
        await page
          .getByRole("button", { name: "Copy feedback", exact: true })
          .waitFor({ state: "visible" });
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLButtonElement>(".feedback-dialog .copy-feedback")
              ?.disabled === false ||
            [...document.querySelectorAll<HTMLButtonElement>(".feedback-dialog button")].some(
              (button) => button.textContent === "Copy feedback" && !button.disabled,
            ),
        );
        await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
        await page.waitForFunction(async () =>
          (await navigator.clipboard.readText()).includes("Editor survives restart"),
        );
        const copiedText = await page.evaluate(() => navigator.clipboard.readText());
        assert(lookups === lookupCount, "Recovery performed a project selection lookup");
        for (const resource of [
          "/status",
          "/tree",
          "/file",
          "/search",
          "/git/refs",
          "/git/log",
          "/raw/file",
        ])
          assert(resources.has("/api/project" + resource), `Missing browser resource ${resource}`);
        await assertNoHorizontalOverflow(page);

        // A read attempted during downtime may fail; the same open tab can retry after recovery.
        await page.getByRole("button", { name: "Close feedback", exact: true }).click();
        server.process.kill();
        await server.process.exited;
        await page.locator('.file-tree-row[title="value.ts"]').click();
        await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
        server = await start(port);
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.locator('.file-code-row[data-line="1"]').waitFor();
        assert(lookups === lookupCount, "Retry required selecting the project again");

        const media = parseFileReadResponse(
          await (
            await fetch(
              origin + projectApiUrl("/file", projectPath, { path: "art.svg", source: "worktree" }),
            )
          ).json(),
        );
        assert(media.kind === "media", "Expected raw fixture media");
        assert(
          (await fetch(origin + media.resource.url, { method: "HEAD" })).status === 200,
          "Fresh backend rejected raw HEAD",
        );

        await edit(1, "Draft survives an approved-root change");
        await page.getByRole("button", { name: "Save comment", exact: true }).click();
        await page.locator(".file-panel .diff-language-row select").selectOption("text");
        // Reuse this origin and browser storage while changing only root configuration and URLs.
        for (const [rootPath, relativePath] of [
          [projectPath, ""],
          [directory, folder],
        ] as const) {
          server.process.kill();
          await server.process.exited;
          server = await start(port, rootPath);
          const next = new URL(destination);
          next.searchParams.set("project", relativePath);
          await page.goto(next.href);
          await page.locator('.file-code-row[data-line="1"]').waitFor();
          assert(
            (await page.locator(".file-panel .diff-language-row select").inputValue()) === "text",
            "The same absolute project lost its language preference after a root change",
          );
          await page.getByRole("button", { name: "Feedback 1", exact: true }).click();
          await page.getByText("Draft survives an approved-root change", { exact: true }).waitFor();
          await page.locator("#review-export-text").waitFor();
          assert(
            (await page.locator("#review-export-text").inputValue()).includes(
              "Draft survives an approved-root change",
            ),
            "Root change invalidated unchanged source feedback",
          );
          await page.locator(".review-history-item summary").click();
          assert(
            (await page.locator(".review-history-item textarea").inputValue()) === copiedText,
            "The same absolute project lost its exact copied feedback after a root change",
          );
          await page.getByRole("button", { name: "Close feedback", exact: true }).click();
          await tab("Changes").click();
          await card.locator(".diff-row-added").waitFor();
          assert(
            (await card.locator(".diff-card-toggle").getAttribute("aria-expanded")) === "true",
            "The same absolute project lost its expanded-card preference after a root change",
          );
        }
      });
    });
    console.log(
      "Alias deep links canonicalize once and preserve the file/line destination and history. Live backend restarts preserve saved drafts and an active editor; Changes, Files, Search, Git, media, checked copy and transport retry work without a new lookup or page reload. Changing the approved root and relative URL retains drafts, copied history, language and expanded-card preferences for the same absolute project.",
    );
  } finally {
    server.process.kill();
    await server.process.exited;
  }
});
