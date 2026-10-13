import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { expectRecord, expectString } from "@git-review/shared/validation";
import {
  commentStoragePrefix,
  emptyCommentStore,
  validateCommentStore,
  type DraftComment,
} from "../apps/web/src/comments.ts";
import {
  appUrl,
  assertNoHorizontalOverflow,
  qaProfiles,
  withQaBrowser,
  withQaContext,
} from "./browser-support.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const directory = await mkdtemp(join(tmpdir(), "git-review-static-web-"));
const files = new Map<string, string>();
const mounts = ["/", "/git-review/"];
const repository = process.cwd();
try {
  for (const basePath of mounts) {
    const built = Bun.spawnSync(["bun", "scripts/build-web.ts", "--base-path", basePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(built.exitCode === 0, new TextDecoder().decode(built.stderr));
    const copy = resolve(directory, basePath === "/" ? "root" : "subpath");
    await cp(resolve("dist/web"), copy, { recursive: true });
    for (const path of await readdir(copy, { recursive: true }))
      if ((await Bun.file(resolve(copy, path)).exists()) && !path.startsWith("."))
        files.set(`${basePath}${path}`, resolve(copy, path));
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/git-review")
        return Response.redirect(new URL(`/git-review/${url.search}`, url).href, 301);
      const path = files.get(
        mounts.includes(url.pathname) ? `${url.pathname}index.html` : url.pathname,
      );
      if (path === undefined) return new Response("Not found", { status: 404 });
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, { status: 405 });
      const type = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".webmanifest")
              ? "application/manifest+json"
              : "text/html";
      // No CSP response header: exercise the policy available on plain static file hosts.
      return new Response(request.method === "HEAD" ? null : await readFile(path), {
        headers: { "content-type": type, "cache-control": "no-cache" },
      });
    },
  });
  try {
    const base = appUrl(server.url.href);
    await withQaBrowser(async (browser) => {
      await withQaContext(browser, qaProfiles.phone, async (context) => {
        const page = await context.newPage();
        const resourceErrors: string[] = [];
        page.on("response", (response) => {
          const url = new URL(response.url());
          if (
            url.origin === base.origin &&
            !url.pathname.startsWith("/api/") &&
            response.status() >= 400
          )
            resourceErrors.push(`${response.status()}: ${url.pathname}`);
        });
        assert(
          (await context.request.get(new URL("/api/roots", base).href)).status() === 404,
          "Static server unexpectedly serves an API",
        );
        for (const mount of mounts) {
          const url = new URL(`${mount}?section=settings`, base);
          const manifestResponse = await context.request.get(
            new URL(`${mount}manifest.webmanifest`, base).href,
          );
          const manifest = expectRecord(await manifestResponse.json(), "manifest");
          for (const key of ["id", "start_url", "scope"])
            assert(manifest[key] === mount, `Wrong ${key} at ${mount}`);
          assert(manifest["display"] === "standalone", "Manifest is not standalone");
          const icons = manifest["icons"];
          assert(Array.isArray(icons), "Manifest icons are missing");
          for (const value of icons) {
            const icon = expectRecord(value, "icon");
            const iconUrl = new URL(expectString(icon["src"], "icon URL"), base);
            assert(iconUrl.pathname.startsWith(`${mount}icons/`), "Icon escaped deployment base");
            const response = await context.request.get(iconUrl.href);
            const bytes = await response.body();
            assert(
              response.ok() && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
              "Invalid PNG icon",
            );
            assert(
              `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` === icon["sizes"],
              "Wrong PNG dimensions",
            );
          }
          await page.goto(url.href, { waitUntil: "load" });
          await page.locator("#code-font-size").waitFor({ state: "visible" });
          await assertNoHorizontalOverflow(page);
          assert(new URL(page.url()).pathname === mount, "Deep link escaped deployment base");
          const resources = await page
            .locator(
              'script[src], link[rel="stylesheet"], link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"]',
            )
            .evaluateAll((elements) =>
              elements.map(
                (element) => element.getAttribute("src") ?? element.getAttribute("href"),
              ),
            );
          assert(
            resources.every((resource) => resource?.startsWith(mount)),
            "HTML asset escaped deployment base",
          );
          const scriptsAndStyles = resources.filter((resource) => resource?.includes("/assets/"));
          assert(
            scriptsAndStyles.length === 3 &&
              scriptsAndStyles.every((resource) => /-[a-z0-9]+\.(js|css)$/u.test(resource ?? "")),
            "Scripts/styles are not versioned",
          );
          await page.waitForFunction(async (mount) => {
            const registration = await navigator.serviceWorker.getRegistration(mount);
            return (
              registration?.scope === `${location.origin}${mount}` && registration.active !== null
            );
          }, mount);
          await page.reload({ waitUntil: "load" });
          await page.waitForFunction(
            (mount) =>
              navigator.serviceWorker.controller?.scriptURL === `${location.origin}${mount}sw.js`,
            mount,
          );
          await page.getByRole("button", { name: "← Back to review", exact: true }).click();
          assert(new URL(page.url()).pathname === mount, "UI navigation escaped deployment base");
          await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
          await page.getByRole("button", { name: "Settings", exact: true }).click();
          await page.locator("#code-font-size").waitFor({ state: "visible" });
          await page.goBack();
          await page.waitForURL((url) => url.searchParams.get("section") === "projects");
          await page.locator("#code-font-size").waitFor({ state: "hidden" });
          assert(new URL(page.url()).pathname === mount, "Back escaped deployment base");
          await page.goForward();
          await page.waitForURL((url) => url.searchParams.get("section") === "settings");
          await page.locator("#code-font-size").waitFor({ state: "visible" });
          await page.reload({ waitUntil: "load" });
          assert(
            new URL(page.url()).searchParams.get("section") === "settings",
            "Refresh lost deep-link state",
          );
        }
        const draft: DraftComment = {
          id: "static-qa-draft",
          body: "Keep this pending feedback through a worker update.",
          anchor: {
            kind: "file",
            source: "worktree",
            path: "review.txt",
            line: 1,
            sourceText: "Saved source quote",
            before: null,
            after: null,
          },
          subject: { kind: "line" },
          createdAt: 1,
          updatedAt: 1,
          state: "outdated",
        };
        const store = emptyCommentStore("/fixture");
        store.drafts.push(draft);
        store.history.push({
          id: "static-qa-copy",
          copiedAt: 2,
          text: "Exact copied feedback",
          comments: [{ ...draft, state: "current" }],
        });
        assert(
          validateCommentStore(store, "/fixture") !== null,
          "Saved-data QA fixture is invalid",
        );
        const savedKey = `${commentStoragePrefix}${encodeURIComponent(store.projectPath)}`;
        const savedText = JSON.stringify(store);
        await page.evaluate(
          async ({ savedKey, savedText, mounts }) => {
            localStorage.setItem(savedKey, savedText);
            await caches.open("another-app-cache");
            await caches.open("git-review-shell-v1");
            for (const mount of mounts)
              await caches.open(`git-review-shell-${encodeURIComponent(mount)}-obsolete`);
          },
          { savedKey, savedText, mounts },
        );
        for (const mount of mounts) {
          await page.goto(new URL(`${mount}?section=settings`, base).href, { waitUntil: "load" });
          await page.locator("#code-font-size").waitFor({ state: "visible" });
          const timeOrigin = await page.evaluate(() => performance.timeOrigin);
          const workerPath = files.get(`${mount}sw.js`);
          assert(workerPath !== undefined, "Missing copied worker");
          await writeFile(
            workerPath,
            `${await readFile(workerPath, "utf8")}\nself.addEventListener("activate", (event) => event.waitUntil(self.clients.matchAll().then((clients) => { for (const client of clients) client.postMessage("qa-static-worker-activated"); })));\n`,
          );
          const updatedResponse = await context.request.get(new URL(`${mount}sw.js`, base).href);
          assert(
            (await updatedResponse.text()) === (await readFile(workerPath, "utf8")),
            "Static server did not serve the updated worker bytes",
          );
          await page.evaluate(async (mount) => {
            const registration = await navigator.serviceWorker.getRegistration(mount);
            if (registration === undefined) throw new Error("Missing worker registration");
            const previous = registration.active;
            const activated = new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`Worker did not activate at ${mount}`)),
                10_000,
              );
              navigator.serviceWorker.addEventListener("message", function accept(event) {
                if (event.data !== "qa-static-worker-activated") return;
                navigator.serviceWorker.removeEventListener("message", accept);
                clearTimeout(timer);
                resolve();
              });
            });
            const changed = new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Worker update did not claim this page")),
                10_000,
              );
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
            });
            await registration.update();
            await Promise.all([changed, activated]);
            if (registration.active === previous) throw new Error("Worker was not replaced");
          }, mount);
          await page.waitForFunction(
            async (mount) =>
              (await navigator.serviceWorker.getRegistration(mount))?.active?.state === "activated",
            mount,
          );
          assert(
            (await page.evaluate(() => performance.timeOrigin)) === timeOrigin,
            "Worker update reloaded the page",
          );
          assert(
            (await page.evaluate((key) => localStorage.getItem(key), savedKey)) === savedText,
            "Worker update changed saved feedback/history",
          );
        }
        const cacheState = await page.evaluate(async () => {
          const results: { name: string; urls: string[] }[] = [];
          for (const name of await caches.keys())
            results.push({
              name,
              urls: (await (await caches.open(name)).keys()).map((request) => request.url),
            });
          return results;
        });
        assert(
          cacheState.some((cache) => cache.name === "another-app-cache"),
          "Worker removed another app's cache",
        );
        assert(
          !cacheState.some(
            (cache) => cache.name.endsWith("-obsolete") || cache.name === "git-review-shell-v1",
          ),
          `Obsolete own fallback caches remain: ${cacheState.map((cache) => cache.name).join(", ")}`,
        );
        for (const mount of mounts) {
          const cache = cacheState.find((cache) =>
            cache.name.startsWith(`git-review-shell-${encodeURIComponent(mount)}-`),
          );
          assert(
            cache?.urls.length === 1 &&
              cache.urls[0] === new URL(`${mount}offline.html`, base).href,
            `Wrong fallback cache at ${mount}`,
          );
        }
        await context.setOffline(true);
        await page.reload({ waitUntil: "load" });
        await page
          .getByRole("heading", { name: "App unavailable", exact: true })
          .waitFor({ state: "visible" });
        assert(
          (await page.getByRole("link", { name: "Try again" }).getAttribute("href")) ===
            "/git-review/",
          "Offline retry escaped deployment base",
        );
        assert(
          (await page
            .locator("body")
            .evaluate((body) => getComputedStyle(body).backgroundColor)) === "rgb(243, 248, 247)",
          "Offline style was blocked by CSP",
        );
        await assertNoHorizontalOverflow(page);
        await page.goto(new URL("/?section=settings", base).href, { waitUntil: "load" });
        await page
          .getByRole("heading", { name: "App unavailable", exact: true })
          .waitFor({ state: "visible" });
        assert(
          (await page.getByRole("link", { name: "Try again" }).getAttribute("href")) === "/",
          "Root offline retry is wrong",
        );
        await context.setOffline(false);
        assert(
          resourceErrors.length === 0,
          `Static resource failures: ${resourceErrors.join(", ")}`,
        );
      });
    });
    // The previous complete artifact survives invalid build configuration.
    const before = createHash("sha256")
      .update(await readFile(resolve(repository, "dist/web/index.html")))
      .digest("hex");
    const invalid = Bun.spawnSync(["bun", "scripts/build-web.ts", "--base-path", "/../"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(invalid.exitCode !== 0, "Invalid deployment path was accepted");
    assert(
      before ===
        createHash("sha256")
          .update(await readFile(resolve(repository, "dist/web/index.html")))
          .digest("hex"),
      "Failed build replaced the previous artifact",
    );
    console.log(
      "Isolated root/subpath artifacts, hashed assets, manifest/icons, navigation/reload/history, scoped worker upgrades without draft/history loss or reload, offline CSP/retry, and invalid-build preservation passed.",
    );
  } finally {
    await server.stop(true);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
