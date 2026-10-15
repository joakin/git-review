import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { thirdPartyNotices } from "./third-party-notices.ts";
import { parseDeploymentBasePath } from "../apps/web/src/deployment.ts";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--base-path"))
  throw new Error("Usage: bun run build:web [--base-path /git-review/]");
const basePath = parseDeploymentBasePath(args[1] ?? "/");
const repository = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(repository, "apps/web/src");
const publicSource = resolve(source, "public");
const output = resolve(repository, "dist/web");
await mkdir(resolve(repository, "dist"), { recursive: true });
const staging = await mkdtemp(resolve(repository, "dist/web-build-"));

const policy =
  "default-src 'self'; script-src 'self'; worker-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "connect-src 'self' https:; img-src 'self' data: https:; media-src 'self' blob: https:; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function withPolicy(html: string, content: string): string {
  if (!html.includes('<meta charset="utf-8" />')) throw new Error("HTML charset marker is missing");
  return html.replace(
    '<meta charset="utf-8" />',
    `<meta charset="utf-8" />\n<meta name="referrer" content="no-referrer" />\n<meta http-equiv="Content-Security-Policy" content="${content}" />`,
  );
}

function artifactPath(result: Bun.BuildOutput, name: string, extension: string): string {
  if (!result.success) throw new AggregateError(result.logs, `Web ${name} build failed`);
  const candidates = result.outputs.filter(
    (artifact) =>
      basename(artifact.path).startsWith(`${name}-`) && artifact.path.endsWith(extension),
  );
  const artifact = candidates[0];
  if (candidates.length !== 1 || artifact === undefined)
    throw new Error(`Missing web ${name} artifact`);
  return `assets/${basename(artifact.path)}`;
}

try {
  const bundled = await Bun.build({
    entrypoints: [resolve(source, "main.tsx"), resolve(source, "styles.css")],
    outdir: staging,
    target: "browser",
    format: "esm",
    naming: "assets/[name]-[hash].[ext]",
    define: {
      __GIT_REVIEW_BASE_PATH__: JSON.stringify(basePath),
      __GIT_REVIEW_LOCAL_AGENT__: "false",
    },
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  const main = artifactPath(bundled, "main", ".js");
  const styles = artifactPath(bundled, "styles", ".css");
  const bootstrap = artifactPath(
    await Bun.build({
      entrypoints: [resolve(source, "theme-bootstrap.ts")],
      outdir: staging,
      target: "browser",
      format: "iife",
      naming: "assets/[name]-[hash].[ext]",
    }),
    "theme-bootstrap",
    ".js",
  );
  const urls = new Map([
    ["/manifest.webmanifest", `${basePath}manifest.webmanifest`],
    ["/icons/icon-192.png", `${basePath}icons/icon-192.png`],
    ["/icons/apple-touch-icon.png", `${basePath}icons/apple-touch-icon.png`],
    ["/assets/main.js", `${basePath}${main}`],
    ["/assets/styles.css", `${basePath}${styles}`],
    ["/assets/theme-bootstrap.js", `${basePath}${bootstrap}`],
  ]);
  let html = await readFile(resolve(source, "index.html"), "utf8");
  for (const [before, after] of urls) {
    if (!html.includes(`"${before}"`)) throw new Error(`Missing HTML asset reference: ${before}`);
    html = html.replaceAll(`"${before}"`, `"${after}"`);
  }
  await writeFile(resolve(staging, "index.html"), withPolicy(html, policy));

  const rawOffline = (await readFile(resolve(publicSource, "offline.html"), "utf8")).replace(
    'href="/"',
    `href="${basePath}"`,
  );
  const inlineStyle = /<style>([\s\S]*?)<\/style>/u.exec(rawOffline)?.[1];
  if (inlineStyle === undefined) throw new Error("Offline fallback style is missing");
  const styleHash = createHash("sha256").update(inlineStyle).digest("base64");
  const offlinePolicy = `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'`;
  const offline = withPolicy(rawOffline, offlinePolicy);
  await writeFile(resolve(staging, "offline.html"), offline);
  // Disable automatic SPA rewrites on file hosts; navigation uses query strings at index.html.
  const notFound = offline
    .replace("App unavailable · git-review", "Page not found · git-review")
    .replace("<h1>App unavailable</h1>", "<h1>Page not found</h1>")
    .replace(
      /<p>[\s\S]*?<\/p>/u,
      "<p>This address is not part of git-review. Open the app to continue.</p>",
    )
    .replace(">Try again</a>", ">Open git-review</a>");
  await writeFile(resolve(staging, "404.html"), notFound);
  const offlineVersion = createHash("sha256").update(offline).digest("hex").slice(0, 16);
  const worker = await Bun.build({
    entrypoints: [resolve(source, "sw.ts")],
    outdir: staging,
    target: "browser",
    format: "iife",
    naming: "sw.js",
    define: { __GIT_REVIEW_OFFLINE_VERSION__: JSON.stringify(offlineVersion) },
  });
  if (!worker.success) throw new AggregateError(worker.logs, "Web worker build failed");

  const manifest = expectRecord(
    JSON.parse(await readFile(resolve(publicSource, "manifest.webmanifest"), "utf8")),
    "web manifest",
  );
  if (!Array.isArray(manifest["icons"])) throw new Error("Manifest icons are missing");
  const icons = manifest["icons"].map((value: unknown) => {
    const icon = expectRecord(value, "manifest icon");
    const path = expectString(icon["src"], "manifest icon path");
    if (!/^\/icons\/[a-z0-9-]+\.png$/u.test(path)) throw new Error("Unexpected manifest icon path");
    return { ...icon, src: `${basePath}${path.slice(1)}` };
  });
  await writeFile(
    resolve(staging, "manifest.webmanifest"),
    JSON.stringify(
      {
        ...manifest,
        id: basePath,
        start_url: basePath,
        scope: basePath,
        icons,
      },
      null,
      2,
    ),
  );
  await mkdir(resolve(staging, "icons"));
  for (const name of [
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
  ])
    await copyFile(resolve(publicSource, "icons", name), resolve(staging, "icons", name));
  await writeFile(resolve(staging, ".nojekyll"), "");
  await writeFile(
    resolve(staging, "THIRD_PARTY_NOTICES.txt"),
    await thirdPartyNotices(["preact"], resolve(repository, "apps/web/package.json")),
  );

  // Cloudflare Pages/Netlify support this file; plain file hosts use the HTML meta policies.
  const headers = [
    `${basePath}*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY`,
    ...[basePath, `${basePath}index.html`].map(
      (path) =>
        `${path}\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  Cache-Control: no-cache`,
    ),
    ...["offline.html", "offline", "404.html", "404"].map(
      (path) =>
        `${basePath}${path}\n  Content-Security-Policy: ${offlinePolicy}; frame-ancestors 'none'\n  Cache-Control: no-cache`,
    ),
    ...["sw.js", "manifest.webmanifest", "icons/*"].map(
      (path) => `${basePath}${path}\n  Cache-Control: no-cache`,
    ),
    `${basePath}assets/*\n  Cache-Control: public, max-age=31536000, immutable`,
  ].join("\n\n");
  await writeFile(resolve(staging, "_headers"), `${headers}\n`);
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Web publish directory: ${output}\nDeployment base: ${basePath}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
