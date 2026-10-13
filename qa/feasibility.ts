import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let buildOnly = false;
let port = 39962;
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (flag === "--build-only") buildOnly = true;
  else if (flag === "--port") {
    port = Number(args[index + 1]);
    index += 1;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
  } else throw new Error(`Unknown flag: ${flag ?? "(missing)"}`);
}
const directory = resolve("dist/feasibility");
await mkdir(directory, { recursive: true });
const built = await Bun.build({
  entrypoints: ["qa/feasibility/browser.ts"],
  outdir: directory,
  target: "browser",
  naming: "probe.js",
});
if (!built.success) throw new AggregateError(built.logs, "Feasibility probe build failed");
for (const name of ["index.html", "styles.css"])
  await copyFile(resolve("qa/feasibility", name), resolve(directory, name));
console.log(`Static probe ready: ${directory}`);
const cloudBundle = resolve("dist/feasibility-cloud.tar.gz");
const packaged = Bun.spawnSync(
  [
    "tar",
    "-czf",
    cloudBundle,
    "package.json",
    "bun.lock",
    "src/server",
    "src/shared",
    "src/test-support.ts",
    "qa/feasibility-agent.ts",
    "qa/feasibility-http.ts",
    "qa/prepare-feasibility-fixture.ts",
    "qa/feasibility/clip.mp4",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
if (packaged.exitCode !== 0) throw new Error(new TextDecoder().decode(packaged.stderr));
console.log(`Experimental cloud source bundle: ${cloudBundle}`);
if (!buildOnly) {
  const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/probe.js", ["probe.js", "text/javascript; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const asset = assets.get(new URL(request.url).pathname);
      if (asset === undefined) return new Response("Not found", { status: 404 });
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405 });
      const [name, contentType] = asset;
      if (name === undefined || contentType === undefined) throw new Error("Invalid static asset");
      return new Response(request.method === "HEAD" ? null : Bun.file(resolve(directory, name)), {
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    },
  });
  console.log(`Static probe URL: ${server.url.href}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      server.stop(true);
      process.exit(0);
    });
}
