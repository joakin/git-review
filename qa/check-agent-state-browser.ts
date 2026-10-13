import type { BrowserContext } from "playwright-core";
import { AgentStateFixture } from "./agent-state-fixture.ts";
import { assertNoHorizontalOverflow } from "./browser-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function checkAgentState(
  context: BrowserContext,
  origins: { frontend: string; a: string; b: string },
  projectPath: string,
  commit: string,
  fixture: AgentStateFixture,
): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  function destination(agent: "a" | "b", section = "files", file = "notes.ts") {
    return (
      origins.frontend +
      "/?" +
      new URLSearchParams({
        section,
        project: projectPath,
        agent: origins[agent],
        ...(section === "files"
          ? { file }
          : section === "changes"
            ? { layer: "unstaged", file }
            : { ref: "HEAD", commit }),
      })
    );
  }
  async function move(url: string): Promise<void> {
    await page.evaluate((url) => {
      history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, url);
  }
  async function text(agent: "a" | "b") {
    await page.locator('.file-code-row[data-line="1"]').waitFor();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('.file-code-row[data-line="1"]')?.textContent?.includes(expected),
      agent === "a" ? "transportLine1" : "cloudHostLine1",
    );
  }
  async function edit(body: string) {
    await page.locator('.file-code-row[data-line="1"] .file-code-line').click();
    await page.getByRole("button", { name: "Working tree line 1. Comment", exact: true }).click();
    await page.locator("#comment-body").fill(body);
  }
  async function feedback(body: string) {
    await page.getByRole("button", { name: "Feedback 1", exact: true }).click();
    await page.getByText(body, { exact: true }).waitFor();
  }
  try {
    await page.goto(origins.frontend + "/?section=files&project=alias&file=notes.ts&line=1");
    await text("a");
    const canonical = new URL(page.url());
    assert(
      canonical.searchParams.get("agent") === origins.a &&
        canonical.searchParams.get("project") === projectPath &&
        canonical.searchParams.get("line") === "1",
      "Legacy alias lost its explicit canonical destination",
    );
    const legacyStore = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith("git-review:comments:")),
    );
    assert(legacyStore.length === 0, "The fixture already has comments");
    await edit("Pending editor from first agent");
    await move(destination("b"));
    await text("b");
    await page.getByRole("button", { name: "Feedback 0", exact: true }).waitFor();
    await edit("Pending editor from second agent");
    await page.goBack();
    await text("a");
    await feedback("Pending editor from first agent");
    await page.getByRole("button", { name: "Close feedback", exact: true }).click();
    await page.goForward();
    await text("b");
    await feedback("Pending editor from second agent");
    await page.getByRole("button", { name: "Close feedback", exact: true }).click();
    const persisted = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith("git-review:comments:"))
        .map(([, value]) => value)
        .join("\n"),
    );
    assert(
      persisted.includes("Pending editor from first agent") &&
        !persisted.includes("Pending editor from second agent"),
      "Another host read or overwrote path-only legacy feedback",
    );

    await move(destination("a"));
    await text("a");
    await page.evaluate(() => navigator.clipboard.writeText("unchanged clipboard"));
    await feedback("Pending editor from first agent");
    const checking = fixture.holdNext("feedback");
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await checking;
    await move(destination("b"));
    await text("b");
    fixture.release("feedback");
    await feedback("Pending editor from second agent");
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())) === "unchanged clipboard",
      "A retired check copied or cleared another owner's feedback",
    );
    assert(
      ((await page.locator(".notification-stack").textContent()) ?? "").includes(
        "Feedback copied",
      ) === false,
      "A late copy notice crossed agents",
    );
    await page.getByRole("button", { name: "Close feedback", exact: true }).click();

    await move(destination("a"));
    await text("a");
    const reading = fixture.holdNext("file");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await reading;
    await move(destination("b"));
    await text("b");
    fixture.release("file");
    await text("b");

    const diff = fixture.holdNext("diff");
    await move(destination("a", "changes"));
    await diff;
    await move(destination("b", "changes"));
    await page
      .getByText("export const cloudHostLine100 = 101;", { exact: false })
      .first()
      .waitFor();
    fixture.release("diff");
    await page
      .getByText("export const cloudHostLine100 = 101;", { exact: false })
      .first()
      .waitFor();
    await move(destination("a", "changes"));
    await page
      .getByText("export const transportLine100 = 101;", { exact: false })
      .first()
      .waitFor();
    await move(destination("b", "changes"));
    await page
      .getByText("export const cloudHostLine100 = 101;", { exact: false })
      .first()
      .waitFor();

    await move(destination("a", "git"));
    await page.locator(".commit-message").filter({ hasText: "Transport fixture" }).waitFor();
    await move(destination("b", "git"));
    await page.locator(".commit-message").filter({ hasText: "Second agent fixture" }).waitFor();
    await page.getByText("export const cloudHostLine1 = 1;", { exact: false }).first().waitFor();
    await move(destination("a", "git"));
    await page.locator(".commit-message").filter({ hasText: "Transport fixture" }).waitFor();
    await page.getByText("export const transportLine1 = 1;", { exact: false }).first().waitFor();

    const media = fixture.holdNext("media");
    await move(destination("a", "files", "image.svg"));
    await media;
    await move(destination("b", "files", "image.svg"));
    await page.waitForFunction(
      () => document.querySelector<HTMLImageElement>(".media-preview img")?.naturalWidth === 320,
    );
    fixture.release("media");
    assert(
      new URL((await page.locator(".media-preview img").getAttribute("src")) ?? "").origin ===
        origins.b,
      "Retired media crossed endpoint ownership",
    );
    await assertNoHorizontalOverflow(page);

    const other = await context.newPage();
    await other.goto(destination("b"));
    await other.getByText("export const cloudHostLine1 = 1;", { exact: false }).first().waitFor();
    assert(
      new URL(page.url()).searchParams.get("agent") === origins.b &&
        new URL(other.url()).searchParams.get("agent") === origins.b,
      "A second tab altered the first destination",
    );
    await move(destination("a"));
    await text("a");
    assert(
      new URL(other.url()).searchParams.get("agent") === origins.b,
      "Tab destinations shared an active host",
    );
    await other.close();

    const reactivated = page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === origins.a &&
        new URL(response.url()).pathname === "/api/project" &&
        response.ok(),
    );
    await page.evaluate(
      ([b, a]) => {
        if (b === undefined || a === undefined) throw new Error("Missing rapid destinations");
        for (const url of [b, a]) {
          history.pushState(null, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      },
      [destination("b"), destination("a")],
    );
    await reactivated;
    await text("a");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await text("a");

    fixture.rootUnavailable = true;
    const direct = await context.newPage();
    await direct.goto(destination("b"));
    await direct.getByText("export const cloudHostLine1 = 1;", { exact: false }).first().waitFor();
    await direct.close();
    fixture.rootUnavailable = false;
    await move(destination("a"));
    await text("a");
    await page.evaluate(() => {
      const native = navigator.clipboard.writeText.bind(navigator.clipboard);
      let calls = 0;
      const held = new Promise<void>((resolve) =>
        window.addEventListener("qa-release-clipboard", () => resolve(), { once: true }),
      );
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => {
          calls += 1;
          document.body.dataset["clipboardCalls"] = String(calls);
          if (calls === 1) await held;
          await native(text);
        },
      });
    });
    await feedback("Pending editor from first agent");
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset["clipboardCalls"] === "1");
    await move(destination("b", "files", "review.txt"));
    await page.getByText("git-review feasibility", { exact: false }).first().waitFor();
    await edit("Queued copy from second agent");
    await page.getByRole("button", { name: "Save comment", exact: true }).click();
    await page.getByRole("button", { name: "Feedback 2", exact: true }).click();
    const queuedCheck = page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === origins.b &&
        new URL(response.url()).pathname === "/api/project/feedback/check",
    );
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await (await queuedCheck).finished();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.getByText("Copying feedback…", { exact: true }).waitFor();
    assert(
      await page.evaluate(() => document.body.dataset["clipboardCalls"] === "1"),
      "A new activation overlapped the old clipboard lease",
    );
    await move(destination("a"));
    await text("a");
    await feedback("Pending editor from first agent");
    const currentCheck = page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === origins.a &&
        new URL(response.url()).pathname === "/api/project/feedback/check",
    );
    await page.getByRole("button", { name: "Copy feedback", exact: true }).click();
    await (await currentCheck).finished();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.getByText("Copying feedback…", { exact: true }).waitFor();
    assert(
      await page.evaluate(() => document.body.dataset["clipboardCalls"] === "1"),
      "A current copy overtook an issued native clipboard write",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("qa-release-clipboard")));
    await page.waitForFunction(() => document.body.dataset["clipboardCalls"] === "2");
    await page
      .getByText("Feedback copied. The copied comments are in history; Undo restores them.", {
        exact: true,
      })
      .waitFor();
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        "Pending editor from first agent",
      ),
      "A stale activation became the final clipboard write",
    );
    await move(destination("b", "files", "review.txt"));
    await page.getByRole("button", { name: "Feedback 2", exact: true }).waitFor();
    await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, "writeText"));
    console.log(
      "Endpoint-owned frontend: canonical aliases, pending editors, legacy storage isolation, held feedback/file/diff/media, shared clipboard lease and canceled queued copies, Git caches, Back/Forward, rapid transitions, independent tabs and root-independent canonical opening passed",
    );
  } finally {
    fixture.rootUnavailable = false;
    fixture.releaseAll();
    await page.close();
  }
}
