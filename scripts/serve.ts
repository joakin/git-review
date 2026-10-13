import { resolve } from "node:path";
import { createApiHandler } from "../apps/agent/src/api.ts";
import { approveRoot } from "../apps/agent/src/paths.ts";
import { parseAgentConfig } from "../apps/agent/src/config.ts";

const options = parseAgentConfig(process.argv.slice(2));
const root = await approveRoot(options.root);
const handleApiRequest = createApiHandler(root, options.publicOrigin);
const htmlPath = resolve("apps/web/src/index.html");
const scriptPath = resolve("dist/assets/main.js");
const stylesPath = resolve("dist/assets/styles.css");
const themeBootstrapPath = resolve("dist/assets/theme-bootstrap.js");
const workerPath = resolve("dist/assets/sw.js");
const publicPath = resolve("apps/web/src/public");
if (
  !(await Bun.file(scriptPath).exists()) ||
  !(await Bun.file(stylesPath).exists()) ||
  !(await Bun.file(themeBootstrapPath).exists()) ||
  !(await Bun.file(workerPath).exists())
) {
  throw new Error(
    "Built client assets are missing. Run `bun run build` first, or use `bun run dev`.",
  );
}

const staticAssets = new Map<string, { path: string; contentType: string; cacheControl: string }>([
  [
    "/assets/main.js",
    { path: scriptPath, contentType: "text/javascript; charset=utf-8", cacheControl: "no-store" },
  ],
  [
    "/assets/styles.css",
    { path: stylesPath, contentType: "text/css; charset=utf-8", cacheControl: "no-store" },
  ],
  [
    "/assets/theme-bootstrap.js",
    {
      path: themeBootstrapPath,
      contentType: "text/javascript; charset=utf-8",
      cacheControl: "no-store",
    },
  ],
  [
    "/sw.js",
    { path: workerPath, contentType: "text/javascript; charset=utf-8", cacheControl: "no-cache" },
  ],
  [
    "/manifest.webmanifest",
    {
      path: resolve(publicPath, "manifest.webmanifest"),
      contentType: "application/manifest+json; charset=utf-8",
      cacheControl: "no-cache",
    },
  ],
  [
    "/icons/icon-192.png",
    {
      path: resolve(publicPath, "icons/icon-192.png"),
      contentType: "image/png",
      cacheControl: "public, max-age=86400",
    },
  ],
  [
    "/icons/icon-512.png",
    {
      path: resolve(publicPath, "icons/icon-512.png"),
      contentType: "image/png",
      cacheControl: "public, max-age=86400",
    },
  ],
  [
    "/icons/icon-maskable-512.png",
    {
      path: resolve(publicPath, "icons/icon-maskable-512.png"),
      contentType: "image/png",
      cacheControl: "public, max-age=86400",
    },
  ],
  [
    "/icons/apple-touch-icon.png",
    {
      path: resolve(publicPath, "icons/apple-touch-icon.png"),
      contentType: "image/png",
      cacheControl: "public, max-age=86400",
    },
  ],
]);

const server = Bun.serve({
  hostname: options.hostname,
  port: options.port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const headers = {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(htmlPath), {
        headers: {
          ...headers,
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        },
      });
    }
    const asset = staticAssets.get(url.pathname);
    if (asset !== undefined)
      return new Response(Bun.file(asset.path), {
        headers: {
          ...headers,
          "content-type": asset.contentType,
          "cache-control": asset.cacheControl,
        },
      });
    if (url.pathname === "/offline.html")
      return new Response(Bun.file(resolve(publicPath, "offline.html")), {
        headers: {
          ...headers,
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        },
      });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`git-review: ${server.url.href}`);
console.log(`Approved root: ${root.realPath}`);
