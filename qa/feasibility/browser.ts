import {
  parseRootResponse,
  parseProjectResponse,
  parseStatusResponse,
  parseFileReadResponse,
  type FileReadResult,
  type Project,
} from "../../src/shared/api.ts";
import { parseFeedbackCheckResponse } from "../../src/shared/feedback-check.ts";
import { isProjectPath, projectApiUrl } from "../../src/shared/project-path.ts";
import { expectRecord, expectString } from "../../src/shared/validation.ts";

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing ${id}`);
  return value;
}
function input(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Expected input ${id}`);
  return value;
}
function button(id: string): HTMLButtonElement {
  const value = element(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Expected button ${id}`);
  return value;
}
function media(id: string): HTMLMediaElement {
  const value = element(id);
  if (!(value instanceof HTMLMediaElement)) throw new Error(`Expected media ${id}`);
  return value;
}
function picture(id: string): HTMLImageElement {
  const value = element(id);
  if (!(value instanceof HTMLImageElement)) throw new Error("Expected probe image");
  return value;
}
const image = picture("image");
const audio = media("audio");
const video = media("video");
const form = element("connection");
const summary = element("summary");
const results = element("results");
const reportView = element("report");
type Observation = { at: string; name: string; outcome: "pass" | "fail"; detail: string };
type Report = {
  version: 1;
  startedAt: string;
  browser: string;
  frontendOrigin: string;
  secureContext: boolean;
  endpoint: string;
  project: string;
  mode: string;
  observations: Observation[];
};
let report: Report | null = null;
let active: AbortController | null = null;
let endpoint: string | null = null;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown probe failure";
}
function observe(name: string, outcome: Observation["outcome"], detail: string): void {
  const observation = { at: new Date().toISOString(), name, outcome, detail };
  report?.observations.push(observation);
  if (report !== null && report.observations.length > 200) report.observations.shift();
  const row = document.createElement("li");
  row.dataset["outcome"] = outcome;
  row.textContent = `${outcome === "pass" ? "PASS" : "FAIL"} · ${name}: ${detail}`;
  results.append(row);
  if (results.childElementCount > 200) results.firstElementChild?.remove();
  reportView.textContent = JSON.stringify(report, null, 2);
}
function busy(value: boolean): void {
  for (const id of ["run", "sample", "play", "seek"]) button(id).disabled = value;
  input("endpoint").disabled = value;
  input("project").disabled = value;
  button("cancel").disabled = !value;
  if (!value) button("sample").disabled = endpoint === null;
  if (!value) {
    button("play").disabled = audio.readyState < 1 || video.readyState < 1;
    button("seek").disabled = audio.readyState < 1 || video.readyState < 1;
  }
}
function target(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error(
      "Use an HTTPS agent origin, or HTTP localhost for simulation; no credentials, path, query, or fragment.",
    );
  if (url.origin === location.origin)
    throw new Error("Use a different agent origin so this actually tests CORS.");
  return url.origin;
}

async function request(
  origin: string,
  route: string,
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(origin + route, {
    ...options,
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  return response;
}
async function json(response: Response): Promise<unknown> {
  if (response.body === null) throw new Error("Expected a JSON body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) {
        await reader.cancel();
        throw new Error("Probe response exceeds 256 KiB");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(text);
  if (!response.ok)
    throw new Error(`Agent returned HTTP ${response.status}: ${text.slice(0, 400)}`);
  return value;
}
async function health(origin: string, signal: AbortSignal): Promise<string> {
  const raw = expectRecord(
    await json(await request(origin, "/probe/health", signal)),
    "probe health",
  );
  if (raw["kind"] !== "git-review-feasibility")
    throw new Error("Expected the feasibility agent harness");
  const startedAt = expectString(raw["startedAt"], "agent start time");
  const time = expectString(raw["time"], "agent sample time");
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(time)))
    throw new Error("Invalid agent clock");
  return `agent started ${startedAt}; sample ${time}`;
}
function rawMedia(origin: string, project: Project, file: FileReadResult): string {
  if (file.kind !== "media") throw new Error("Expected fixture media");
  const url = new URL(file.resource.url, origin);
  if (
    url.origin !== origin ||
    url.pathname !== "/api/project/raw/file" ||
    url.searchParams.get("projectPath") !== project.absolutePath ||
    url.searchParams.get("path") !== file.path
  )
    throw new Error("Media URL changed endpoint or project ownership");
  return url.pathname + url.search;
}
async function ready(
  value: HTMLImageElement | HTMLMediaElement,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const event = value instanceof HTMLImageElement ? "load" : "loadedmetadata";
    const timer = setTimeout(() => finish(new Error("Native media metadata timed out")), 15_000);
    const abort = () => finish(new Error("Probe stopped"));
    const loaded = () => finish();
    const failed = () =>
      finish(new Error("Native media failed; check browser permission, TLS, CORS, or format"));
    function finish(error?: Error): void {
      clearTimeout(timer);
      value.removeEventListener(event, loaded);
      value.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve();
    }
    value.addEventListener(event, loaded, { once: true });
    value.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    value.crossOrigin = "anonymous";
    if (signal.aborted) abort();
    else value.src = url;
  });
}
async function seek(value: HTMLMediaElement, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(value.duration) || value.duration < 1)
    throw new Error("Expected at least one second of seekable media");
  const time = value.currentTime > value.duration / 2 ? value.duration / 4 : value.duration * 0.65;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Native seek timed out")), 15_000);
    const abort = () => finish(new Error("Probe stopped"));
    const failed = () => finish(new Error("Native seek failed"));
    const seeked = () =>
      finish(
        Math.abs(value.currentTime - time) < 0.3
          ? undefined
          : new Error("Seek reached the wrong position"),
      );
    function finish(error?: Error): void {
      clearTimeout(timer);
      value.removeEventListener("seeked", seeked);
      value.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve();
    }
    value.addEventListener("seeked", seeked, { once: true });
    value.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else value.currentTime = time;
  });
}
async function check<T>(
  name: string,
  action: () => Promise<T>,
  describe: (value: T) => string,
): Promise<T> {
  summary.textContent = `Checking ${name}…`;
  try {
    const value = await action();
    observe(name, "pass", describe(value));
    return value;
  } catch (error) {
    observe(name, "fail", errorText(error));
    throw error;
  }
}
async function run(): Promise<void> {
  if (active !== null) return;
  const controller = new AbortController();
  active = controller;
  endpoint = null;
  report = null;
  results.replaceChildren();
  element("media").hidden = true;
  for (const value of [audio, video]) {
    value.pause();
    value.removeAttribute("src");
    value.load();
  }
  image.removeAttribute("src");
  busy(true);
  try {
    const origin = target(input("endpoint").value);
    endpoint = origin;
    report = {
      version: 1,
      startedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      frontendOrigin: location.origin,
      secureContext: isSecureContext,
      endpoint: origin,
      project: input("project").value.trim(),
      mode: origin.startsWith("http:")
        ? "Local simulation; no cloud/Tailscale proof"
        : "HTTPS target; provider and lifecycle require explicit observations",
      observations: [],
    };
    await check(
      "Reachability",
      () => health(origin, controller.signal),
      (value) => value,
    );
    const root = await check(
      "CORS GET root",
      async () =>
        parseRootResponse(await json(await request(origin, "/api/roots", controller.signal))),
      (value) => value.path,
    );
    const path = input("project").value.trim() || root.path;
    if (!isProjectPath(path)) throw new Error("Expected a canonical absolute project path");
    const project = await check(
      "Project lookup",
      async () =>
        parseProjectResponse(
          await json(await request(origin, projectApiUrl("", path), controller.signal)),
        ),
      (value) => value.absolutePath,
    );
    if (report !== null) report.project = project.absolutePath;
    await check(
      "Git repository read",
      async () => {
        const status = parseStatusResponse(
          await json(
            await request(
              origin,
              projectApiUrl("/status", project.absolutePath),
              controller.signal,
            ),
          ),
        );
        if (status.kind !== "git") throw new Error("Use the disposable Git fixture");
        return status.entries.length;
      },
      (value) => `${value} working-tree changes`,
    );
    const text = await check(
      "Source file read",
      async () => {
        const file = parseFileReadResponse(
          await json(
            await request(
              origin,
              projectApiUrl("/file", project.absolutePath, {
                path: "review.txt",
                source: "worktree",
              }),
              controller.signal,
            ),
          ),
        );
        if (file.kind !== "text" || file.lines.length === 0)
          throw new Error("Expected review.txt in the fixture");
        return file;
      },
      (value) => `${value.lines.length} lines`,
    );
    await check(
      "CORS JSON POST",
      async () => {
        const first = text.lines[0];
        if (first === undefined) throw new Error("Expected a source line");
        const body = {
          anchors: [
            {
              kind: "file",
              source: "worktree",
              path: "review.txt",
              line: first.number,
              sourceText: first.text,
              before: null,
              after: text.lines[1]?.text ?? null,
            },
          ],
        };
        const response = parseFeedbackCheckResponse(
          await json(
            await request(
              origin,
              projectApiUrl("/feedback/check", project.absolutePath),
              controller.signal,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
            ),
          ),
          1,
        );
        if (response.kind !== "checked" || response.matches[0] !== true)
          throw new Error("Fixture anchor did not pass fresh checking");
        return "Preflight and a fresh source check succeeded";
      },
      (value) => value,
    );
    await check(
      "CORS error and containment",
      async () => {
        const response = await request(
          origin,
          projectApiUrl("/file", project.absolutePath, {
            path: "../blocked-probe.txt",
            source: "worktree",
          }),
          controller.signal,
        );
        if (response.status !== 400 && response.status !== 403)
          throw new Error(`Expected rejected traversal, got ${response.status}`);
        const raw: unknown = await response.json();
        expectRecord(expectRecord(raw, "error response")["error"], "API error");
        return `Readable HTTP ${response.status}; traversal rejected`;
      },
      (value) => value,
    );
    element("media").hidden = false;
    for (const [path, node] of [
      ["image.svg", image],
      ["sound.wav", audio],
      ["clip.mp4", video],
    ] as const) {
      await check(
        `Native ${path}`,
        async () => {
          const file = parseFileReadResponse(
            await json(
              await request(
                origin,
                projectApiUrl("/file", project.absolutePath, { path, source: "worktree" }),
                controller.signal,
              ),
            ),
          );
          const route = rawMedia(origin, project, file);
          if (node instanceof HTMLMediaElement) {
            const head = await request(origin, route, controller.signal, { method: "HEAD" });
            if (!head.ok || Number(head.headers.get("content-length")) < 64)
              throw new Error("Media HEAD/length failed");
            const ranged = await request(origin, route, controller.signal, {
              headers: { Range: "bytes=0-63" },
            });
            if (
              ranged.status !== 206 ||
              !/^bytes 0-63\/\d+$/.test(ranged.headers.get("content-range") ?? "") ||
              (await ranged.arrayBuffer()).byteLength !== 64
            )
              throw new Error("Media range or exposed Content-Range failed");
          }
          await ready(node, origin + route, controller.signal);
          if (node instanceof HTMLMediaElement) await seek(node, controller.signal);
          return node instanceof HTMLMediaElement
            ? "HEAD, 206 range, native metadata and seek succeeded"
            : "Native image and cross-origin response loaded";
        },
        (value) => value,
      );
    }
    summary.textContent =
      "Browser checks passed. Cloud lifecycle and real-device playback still need explicit observations.";
    summary.dataset["complete"] = "pass";
  } catch (error) {
    summary.textContent = `Checks stopped: ${errorText(error)}. Earlier results remain in the report.`;
    summary.dataset["complete"] = "fail";
    if (report === null) observe("Configuration", "fail", errorText(error));
  } finally {
    active = null;
    busy(false);
  }
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  delete summary.dataset["complete"];
  void run();
});
button("cancel").addEventListener("click", () => active?.abort());
button("sample").addEventListener("click", async () => {
  if (endpoint === null || active !== null) return;
  const origin = endpoint;
  const controller = new AbortController();
  active = controller;
  busy(true);
  const phase = input("phase").value.trim().slice(0, 500) || "Manual reachability sample";
  try {
    observe(phase, "pass", await health(origin, controller.signal));
    summary.textContent = "Reachability sample recorded.";
  } catch (error) {
    observe(phase, "fail", errorText(error));
    summary.textContent = "Agent unreachable; observation recorded.";
  } finally {
    active = null;
    busy(false);
  }
});
button("play").addEventListener("click", async () => {
  const owner = report;
  try {
    await Promise.all([audio.play(), video.play()]);
    if (report !== owner) return;
    observe(
      "User playback",
      "pass",
      "Both playback requests accepted; verify sound/picture on the device",
    );
  } catch (error) {
    if (report === owner) observe("User playback", "fail", errorText(error));
  }
});
button("seek").addEventListener("click", async () => {
  if (active !== null) return;
  const controller = new AbortController();
  active = controller;
  busy(true);
  try {
    await Promise.all([seek(audio, controller.signal), seek(video, controller.signal)]);
    observe("User seek", "pass", "Both native media elements sought successfully");
  } catch (error) {
    observe("User seek", "fail", errorText(error));
  } finally {
    active = null;
    busy(false);
  }
});
button("download").addEventListener("click", () => {
  if (report === null) {
    summary.textContent = "Run checks before downloading a report.";
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "git-review-feasibility.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
