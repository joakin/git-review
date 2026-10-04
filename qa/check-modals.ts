import { chromium, type Locator, type Page } from "playwright-core";

const appUrl = process.argv[2];
if (appUrl === undefined) throw new Error("Usage: bun run qa:modals <local app URL>");
const reviewUrl = new URL(
  "/?section=changes&project=inventory-fixture&layer=staged&file=src/view.ts",
  appUrl,
).href;
const previousOverflow = { body: "auto", document: "scroll" };
type Dismissal = "escape" | "header" | "backdrop";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkFit(page: Page, dialog: Locator): Promise<void> {
  const fits = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= -1 &&
      rect.right <= innerWidth + 1 &&
      rect.top >= -1 &&
      rect.bottom <= innerHeight + 1 &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    );
  });
  assert(fits, `Modal overflowed the ${page.viewportSize()?.width}px viewport`);
}

async function checkOpen(page: Page, dialog: Locator, initialFocus: Locator): Promise<void> {
  await dialog.waitFor({ state: "visible" });
  assert(
    await dialog.evaluate(
      (element) =>
        element instanceof HTMLDialogElement && element.open && element.matches(":modal"),
    ),
    "Dialog did not enter the native modal layer",
  );
  await page.waitForFunction(
    () =>
      document.body.style.overflow === "hidden" &&
      document.documentElement.style.overflow === "hidden",
  );
  assert(
    await initialFocus.evaluate((element) => document.activeElement === element),
    "Modal initial focus did not reach its intended control",
  );
  await checkFit(page, dialog);
}

async function readModalFocus(dialog: Locator) {
  return dialog.evaluate((element) => {
    const active = document.activeElement;
    return {
      dialog: document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent,
      activeControl: {
        tag: active?.tagName,
        label: active?.getAttribute("aria-label"),
        text: active instanceof HTMLButtonElement ? active.textContent : null,
      },
      modal: element instanceof HTMLDialogElement && element.open && element.matches(":modal"),
      inside: element.contains(active) && active instanceof HTMLElement && active.tabIndex >= 0,
      viewport:
        !document.hasFocus() && (active === document.body || active === document.documentElement),
    };
  });
}

async function checkKeyboardFocus(page: Page, dialog: Locator): Promise<void> {
  const controls = dialog.locator(
    "button:enabled, textarea, input:enabled, select:enabled, a[href]",
  );
  for (const { control, key, returnKey } of [
    { control: controls.first(), key: "Shift+Tab", returnKey: "Tab" },
    { control: controls.last(), key: "Tab", returnKey: "Shift+Tab" },
  ]) {
    await control.focus();
    await page.keyboard.press(key);
    const focus = await readModalFocus(dialog);
    assert(
      focus.modal && (focus.inside || focus.viewport),
      `${key} focused background content or closed the modal: ${JSON.stringify(focus)}`,
    );
    // Native focus may wrap inside the dialog or visit browser chrome; only the latter needs a return step.
    if (focus.viewport) {
      await page.keyboard.press(returnKey);
      const returned = await readModalFocus(dialog);
      assert(
        returned.modal && returned.inside,
        `${returnKey} did not return to a modal control: ${JSON.stringify(returned)}`,
      );
    }
  }
}

async function dismiss(
  page: Page,
  dialog: Locator,
  method: Dismissal,
  closeName: string,
  opener?: Locator,
): Promise<void> {
  if (method === "escape") await page.keyboard.press("Escape");
  else if (method === "header")
    await dialog.getByRole("button", { name: closeName, exact: true }).click();
  else {
    const point = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top > 2) return { x: innerWidth / 2, y: rect.top / 2 };
      if (rect.left > 2) return { x: rect.left / 2, y: innerHeight / 2 };
      throw new Error("No visible modal backdrop to click");
    });
    await page.mouse.click(point.x, point.y);
  }
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(
    (previous) =>
      document.body.style.overflow === previous.body &&
      document.documentElement.style.overflow === previous.document,
    previousOverflow,
  );
  if (opener !== undefined) {
    // Backdrop pointer defaults can blur restored focus after unmount; probe background usability instead.
    if (method === "backdrop") {
      assert(await opener.isEnabled(), "Backdrop close left its background opener disabled");
      await opener.focus();
    }
    const restored = await opener.evaluate(async (element) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const active = document.activeElement;
      return {
        focused: active === element,
        opener: element.textContent,
        activeTag: active?.tagName,
        activeLabel: active?.getAttribute("aria-label"),
        activeText: active instanceof HTMLButtonElement ? active.textContent : null,
        documentFocus: document.hasFocus(),
        remainingModals: document.querySelectorAll(":modal").length,
      };
    });
    assert(
      restored.focused && restored.remainingModals === 0,
      `${method} close ${method === "backdrop" ? "left its background opener unusable" : "did not return focus to its stable opener"}: ${JSON.stringify(restored)}`,
    );
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 600,
      hasTouch: viewport.width < 1200,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(reviewUrl, { waitUntil: "load" });
      const row = page
        .locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"] .diff-row-added')
        .first();
      await row.locator(".diff-code").waitFor({ state: "visible" });
      await page.evaluate((previous) => {
        document.body.style.overflow = previous.body;
        document.documentElement.style.overflow = previous.document;
      }, previousOverflow);

      const editor = page.getByRole("dialog", { name: /^(Add a comment|Edit comment)$/ });
      const textarea = editor.getByPlaceholder("What should change?");
      await row.locator(".diff-code").click();
      await page.getByRole("button", { name: /Comment on new line 1/ }).click();
      await checkOpen(page, editor, textarea);
      await textarea.fill("Earlier body");
      let body = `Latest escaped body at ${viewport.width}px`;
      await textarea.fill(body);
      assert(await editor.isVisible(), "Inside editor interaction dismissed the modal");
      await checkKeyboardFocus(page, editor);
      await dismiss(page, editor, "escape", "Close comment editor");

      const feedbackOpener = page.getByRole("button", { name: "Feedback 1", exact: true });
      const feedback = page.getByRole("dialog", { name: "Feedback 1", exact: true });
      async function openFeedback(): Promise<void> {
        await feedbackOpener.focus();
        await feedbackOpener.click();
        await checkOpen(
          page,
          feedback,
          feedback.getByRole("button", { name: "Close feedback", exact: true }),
        );
        const exportText = feedback.getByLabel("Copyable feedback text");
        await exportText.waitFor({ state: "visible" });
        assert(
          (await exportText.inputValue()).includes(body),
          "Dismissal did not save the latest edited body",
        );
        await exportText.click();
        assert(await feedback.isVisible(), "Inside Feedback interaction dismissed the modal");
      }
      await openFeedback();
      await checkKeyboardFocus(page, feedback);
      await dismiss(page, feedback, "header", "Close feedback", feedbackOpener);
      for (const method of ["header", "backdrop"] as const) {
        await openFeedback();
        await feedback.getByRole("button", { name: "Edit", exact: true }).click();
        await feedback.waitFor({ state: "detached" });
        await checkOpen(page, editor, textarea);
        await textarea.fill(`Earlier ${method} body`);
        body = `Latest ${method} body at ${viewport.width}px`;
        await textarea.fill(body);
        await dismiss(page, editor, method, "Close comment editor");
        await openFeedback();
        await dismiss(
          page,
          feedback,
          method === "header" ? "backdrop" : "escape",
          "Close feedback",
          feedbackOpener,
        );
      }

      const settings = page.getByRole("button", { name: /^Settings/ });
      const settingsOnScreen = await settings.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > 0 && rect.left < innerWidth;
      });
      if (!settingsOnScreen)
        await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
      await settings.click();
      const installOpener = page.getByRole("button", { name: /^Install & local data/ });
      const install = page.getByRole("dialog", { name: "Install & local data", exact: true });
      for (const method of ["escape", "header", "backdrop"] as const) {
        await installOpener.focus();
        await installOpener.click();
        await checkOpen(
          page,
          install,
          install.getByRole("button", { name: "Close install and local data", exact: true }),
        );
        await install.getByRole("heading", { name: "Move local review data", exact: true }).click();
        assert(await install.isVisible(), "Inside installation interaction dismissed the modal");
        await checkKeyboardFocus(page, install);
        await dismiss(page, install, method, "Close install and local data", installOpener);
      }
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 320, height: 700 });
        await installOpener.click();
        await checkOpen(
          page,
          install,
          install.getByRole("button", { name: "Close install and local data", exact: true }),
        );
        await dismiss(page, install, "escape", "Close install and local data", installOpener);
      }
      assert(errors.length === 0, `Browser errors at ${viewport.width}px: ${errors.join("; ")}`);
      console.log(
        `Modal focus, keyboard containment, inside interactions, Escape/header/backdrop dismissal, exact scroll-lock cleanup, handoff, and latest-body saving passed at ${viewport.width}px.`,
      );
    } finally {
      await context.close();
    }
  }
  console.log(
    "Comment, Feedback, and installation modal checks passed at all four sizes, plus 320px installation containment. Real-device gestures were not exercised.",
  );
} finally {
  await browser.close();
}
