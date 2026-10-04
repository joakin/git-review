import { chromium } from "playwright-core";

const url = process.argv[2];
if (url === undefined) throw new Error("Usage: bun qa/check-voice.ts <local app URL>");

async function waitForRequestStep(pending: Promise<void>, description: string): Promise<void> {
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pending,
      new Promise<void>((_, reject) => {
        waitTimer = setTimeout(() => reject(new Error(`${description} timed out`)), 10_000);
      }),
    ]);
  } finally {
    if (waitTimer !== undefined) clearTimeout(waitTimer);
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
let releaseHeldTranscription = () => {};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    let stoppedTracks = 0;
    Object.defineProperty(window, "qaStoppedVoiceTracks", { get: () => stoppedTracks });
    Object.defineProperty(window, "AudioContext", {
      value: class {
        constructor() {
          throw new Error("QA has no speaker");
        }
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                stoppedTracks += 1;
              },
            },
          ],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      value: class {
        static isTypeSupported(type: string) {
          return type.startsWith("audio/webm");
        }
        mimeType = "audio/webm;codecs=opus";
        state = "inactive";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["recorded voice"], { type: this.mimeType }) });
          this.onstop?.();
        }
      },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.getByRole("button", { name: /inventory-fixture/ }).click();
  await page.getByRole("button", { name: /Open this folder/ }).click();
  await page.getByRole("button", { name: "Review all changes", exact: true }).click();
  const card = page.locator('main .diff-card[data-layer="staged"][data-path="src/view.ts"]');
  await card.locator(".diff-card-toggle").click();
  await card.locator(".diff-row-added").first().tap();
  await card.getByRole("button", { name: /staged added line.*Comment on new line 1/ }).click();
  const textarea = page.getByPlaceholder("Add a question, note, or suggestion…");
  await textarea.fill("Before after");
  await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));

  let calls = 0;
  await page.route("**/api/transcriptions", async (route) => {
    calls += 1;
    if (calls === 2)
      await route.fulfill({
        status: 503,
        json: { error: { code: "internal_error", message: "Handy model unavailable" } },
      });
    else await route.fulfill({ json: { text: calls === 1 ? "spoken" : "recovered" } });
  });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector(".comment-editor textarea") as HTMLTextAreaElement | null)?.value ===
      "Before spokenafter",
  );
  const insertedCaret = await textarea.evaluate(
    (element: HTMLTextAreaElement) => element.selectionStart,
  );
  if (insertedCaret !== 13)
    throw new Error(`Transcript was not inserted at the saved caret: ${insertedCaret}`);

  await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 13));
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Handy model unavailable").waitFor({ state: "visible" });
  if ((await textarea.inputValue()) !== "Before spokenafter")
    throw new Error("Failed transcription changed the comment");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector(".comment-editor textarea") as HTMLTextAreaElement | null)?.value ===
      "Before recoveredafter",
  );
  if (calls !== 3) throw new Error(`Retry did not resend the saved clip: ${calls} calls`);

  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Record voice comment" }).waitFor({ state: "visible" });
  if (calls !== 3) throw new Error("Cancel uploaded a recording");
  await page.clock.install();
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.clock.fastForward(300_000);
  await page.waitForFunction(() => document.querySelector(".voice-footer .voice-mic") !== null);
  if (Number(calls) !== 4)
    throw new Error("Five-minute limit did not submit the recording automatically");
  await page.setViewportSize({ width: 390, height: 450 });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  const fitsSmallViewport = await page
    .locator(".comment-editor")
    .evaluate((dialog: HTMLDialogElement) => dialog.getBoundingClientRect().height <= innerHeight);
  if (!fitsSmallViewport)
    throw new Error("Comment editor extends beyond a keyboard-sized viewport");
  await textarea.fill("Typed before closing voice");
  const previousStops = await page.evaluate(() => {
    if (!("qaStoppedVoiceTracks" in window) || typeof window.qaStoppedVoiceTracks !== "number")
      throw new Error("Missing microphone QA instrumentation");
    return window.qaStoppedVoiceTracks;
  });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator(".comment-editor").waitFor({ state: "detached" });
  await page.waitForFunction(
    (expected) => "qaStoppedVoiceTracks" in window && window.qaStoppedVoiceTracks === expected,
    previousStops + 1,
  );
  if (Number(calls) !== 4) throw new Error("Closing the editor uploaded an unsent recording");
  await page.getByRole("button", { name: "Feedback 1" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  if ((await textarea.inputValue()) !== "Typed before closing voice")
    throw new Error("Closing a recording lost typed feedback");

  const held = new Promise<void>((resolve) => {
    releaseHeldTranscription = resolve;
  });
  const hold = { started: () => {}, settled: () => {} };
  const started = new Promise<void>((resolve) => {
    hold.started = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    hold.settled = resolve;
  });
  await page.route("**/api/transcriptions", async (route) => {
    calls += 1;
    hold.started();
    await held;
    try {
      await route.fulfill({ json: { text: "late transcript" } });
    } catch {
      /* Closing the editor aborts the held request. */
    } finally {
      hold.settled();
    }
  });
  await page.getByRole("button", { name: "Record voice comment" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await waitForRequestStep(started, "Held transcription request start");
  await page.keyboard.press("Escape");
  await page.locator(".comment-editor").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Feedback 1" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await textarea.fill("New editor survives a late transcript");
  releaseHeldTranscription();
  await waitForRequestStep(settled, "Held transcription response release");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  if ((await textarea.inputValue()) !== "New editor survives a late transcript")
    throw new Error("A closed editor's late transcript changed the new editor");
  await page.getByRole("button", { name: "Save comment" }).click();
  await page.getByRole("button", { name: "Feedback 1" }).click();
  await page
    .getByText("New editor survives a late transcript", { exact: true })
    .waitFor({ state: "visible" });
  if (errors.length > 0) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await context.close();
  console.log(
    "Voice caret insertion, failed-request retry, cancel, five-minute automatic send, and editor dismissal during recording/held transcription passed on an emulated phone.",
  );
} finally {
  releaseHeldTranscription();
  await browser.close();
}
