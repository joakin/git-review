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
const handleApiRequest = createApiHandler(root);
const htmlPath = resolve("src/client/index.html");
const scriptPath = resolve("dist/assets/main.js");
const stylesPath = resolve("dist/assets/styles.css");
if (!(await Bun.file(scriptPath).exists()) || !(await Bun.file(stylesPath).exists())) {
  throw new Error("Built client assets are missing. Run `bun run build` first, or use `bun run dev`.");
}

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
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        },
      });
    }
    if (url.pathname === "/assets/main.js") {
      return new Response(Bun.file(scriptPath), { headers: { ...headers, "content-type": "text/javascript; charset=utf-8" } });
    }
    if (url.pathname === "/assets/styles.css") {
      return new Response(Bun.file(stylesPath), { headers: { ...headers, "content-type": "text/css; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`git-review: ${server.url.href}`);
console.log(`Approved root: ${root.realPath}`);
