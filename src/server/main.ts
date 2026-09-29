import { resolve } from "node:path";
import { isIP } from "node:net";
import { createApiHandler } from "./api.ts";
import { approveRoot } from "./paths.ts";

type ServerOptions = { root: string; port: number };

function bindHost(): string {
  const host = process.env["GIT_REVIEW_HOST"] ?? "127.0.0.1";
  if (host === "127.0.0.1") return host;
  const secondOctet = Number(host.split(".")[1]);
  if (isIP(host) !== 4 || !host.startsWith("100.") || secondOctet < 64 || secondOctet > 127) {
    throw new Error("GIT_REVIEW_HOST must be 127.0.0.1 or this Mac's Tailscale IPv4 address");
  }
  return host;
}

function parseOptions(args: readonly string[]): ServerOptions {
  let root = process.cwd();
  let port = 3000;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--root" && flag !== "--port") || value === undefined) {
      throw new Error(`Unknown or incomplete option: ${flag ?? "(missing)"}`);
    }
    if (flag === "--root") root = value;
    if (flag === "--port") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      port = parsed;
    }
    index += 1;
  }
  return { root, port };
}

const options = parseOptions(process.argv.slice(2));
const root = await approveRoot(options.root);
const configuredPublicOrigin = process.env["GIT_REVIEW_PUBLIC_ORIGIN"];
let publicOrigin: string | null = null;
if (configuredPublicOrigin !== undefined) {
  const parsed = new URL(configuredPublicOrigin);
  if (parsed.protocol !== "https:" || parsed.origin !== configuredPublicOrigin || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("GIT_REVIEW_PUBLIC_ORIGIN must be an HTTPS origin without a path");
  }
  publicOrigin = parsed.origin;
}
const handleApiRequest = createApiHandler(root, publicOrigin);
const htmlPath = resolve("src/client/index.html");
const scriptPath = resolve("dist/assets/main.js");
const stylesPath = resolve("dist/assets/styles.css");
const workerPath = resolve("dist/assets/sw.js");
const publicPath = resolve("src/client/public");
if (!(await Bun.file(scriptPath).exists()) || !(await Bun.file(stylesPath).exists()) || !(await Bun.file(workerPath).exists())) {
  throw new Error("Built client assets are missing. Run `bun run build` first, or use `bun run dev`.");
}

const staticAssets = new Map<string, { path: string; contentType: string; cacheControl: string }>([
  ["/assets/main.js", { path: scriptPath, contentType: "text/javascript; charset=utf-8", cacheControl: "no-store" }],
  ["/assets/styles.css", { path: stylesPath, contentType: "text/css; charset=utf-8", cacheControl: "no-store" }],
  ["/sw.js", { path: workerPath, contentType: "text/javascript; charset=utf-8", cacheControl: "no-cache" }],
  ["/manifest.webmanifest", { path: resolve(publicPath, "manifest.webmanifest"), contentType: "application/manifest+json; charset=utf-8", cacheControl: "no-cache" }],
  ["/icons/icon-192.png", { path: resolve(publicPath, "icons/icon-192.png"), contentType: "image/png", cacheControl: "public, max-age=86400" }],
  ["/icons/icon-512.png", { path: resolve(publicPath, "icons/icon-512.png"), contentType: "image/png", cacheControl: "public, max-age=86400" }],
  ["/icons/icon-maskable-512.png", { path: resolve(publicPath, "icons/icon-maskable-512.png"), contentType: "image/png", cacheControl: "public, max-age=86400" }],
  ["/icons/apple-touch-icon.png", { path: resolve(publicPath, "icons/apple-touch-icon.png"), contentType: "image/png", cacheControl: "public, max-age=86400" }],
]);

const server = Bun.serve({
  hostname: bindHost(),
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
          "content-security-policy": "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        },
      });
    }
    const asset = staticAssets.get(url.pathname);
    if (asset !== undefined) return new Response(Bun.file(asset.path), { headers: { ...headers, "content-type": asset.contentType, "cache-control": asset.cacheControl } });
    if (url.pathname === "/offline.html") return new Response(Bun.file(resolve(publicPath, "offline.html")), { headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`git-review: ${server.url.href}`);
console.log(`Approved root: ${root.realPath}`);
