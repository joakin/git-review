import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun qa/check-voice.ts <local app URL>");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: class { constructor() { throw new Error("QA has no speaker"); } } });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    Object.defineProperty(window, "MediaRecorder", { value: class {
      static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["recorded voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    } });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: /inventory-fixture/ }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await card.locator(".diff-card-toggle").click();
  await card.locator(".diff-row-added").first().tap();
  await card.getByRole("button", { name: /staged added line.*Comment on new line 1/ }).click();
  const textarea = page.getByPlaceholder("What should change?");
  await textarea.fill("Before after");
  await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));

  let calls = 0;
  await page.route("**/api/transcriptions", async (route) => {
    calls += 1;
    if (calls === 2) await route.fulfill({ status: 503, json: { error: { code: "internal_error", message: "Handy model unavailable" } } });
    else await route.fulfill({ json: { text: calls === 1 ? "spoken" : "recovered" } });
  });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction(() => (document.querySelector(".comment-editor textarea") as HTMLTextAreaElement | null)?.value === "Before spokenafter");
  const insertedCaret = await textarea.evaluate((element: HTMLTextAreaElement) => element.selectionStart);
  if (insertedCaret !== 13) throw new Error(`Transcript was not inserted at the saved caret: ${insertedCaret}`);

  await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 13));
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Handy model unavailable").waitFor({ state: "visible" });
  if (await textarea.inputValue() !== "Before spokenafter") throw new Error("Failed transcription changed the comment");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForFunction(() => (document.querySelector(".comment-editor textarea") as HTMLTextAreaElement | null)?.value === "Before recoveredafter");
  if (calls !== 3) throw new Error(`Retry did not resend the saved clip: ${calls} calls`);

  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Record voice comment" }).waitFor({ state: "visible" });
  if (calls !== 3) throw new Error("Cancel uploaded a recording");
  await page.clock.install();
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.clock.fastForward(300_000);
  await page.waitForFunction(() => document.querySelector(".voice-footer .voice-mic") !== null);
  if (Number(calls) !== 4) throw new Error("Five-minute limit did not submit the recording automatically");
  await page.setViewportSize({ width: 390, height: 450 });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  const fitsSmallViewport = await page.locator(".comment-editor").evaluate((dialog: HTMLDialogElement) => dialog.getBoundingClientRect().height <= innerHeight);
  if (!fitsSmallViewport) throw new Error("Comment editor extends beyond a keyboard-sized viewport");
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await context.close();
  console.log("Voice caret insertion, failed-request retry, cancel, and five-minute automatic send passed on an emulated phone.");
} finally {
  await browser.close();
}
