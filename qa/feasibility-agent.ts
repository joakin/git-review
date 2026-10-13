import { approveRoot } from "../src/server/paths.ts";
import { createApiHandler } from "../src/server/api.ts";
import { createProbeHandler, probeOrigin } from "./feasibility-http.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: bun qa/feasibility-agent.ts --root <disposable fixture> --origin <exact frontend origin> [--port 39961]",
  );
  process.exit(0);
}
let rootPath: string | null = null;
let origin: string | null = null;
let port = 39961;
const seen = new Set<string>();
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (flag === undefined || value === undefined || seen.has(flag))
    throw new Error("Expected unique flag/value pairs");
  seen.add(flag);
  if (flag === "--root") rootPath = value;
  else if (flag === "--origin") origin = probeOrigin(value);
  else if (flag === "--port") {
    port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
  } else throw new Error(`Unknown flag: ${flag}`);
}
if (rootPath === null || origin === null) throw new Error("--root and --origin are required");
const root = await approveRoot(rootPath);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: createProbeHandler(origin, createApiHandler(root, origin)),
});
console.log(`Feasibility agent: ${server.url.href}`);
console.log(`Approved fixture root: ${root.realPath}`);
console.log(`Allowed frontend origin: ${origin}`);
console.log(
  "This experimental API-only harness needs no frontend build. Use private Tailscale Serve for cloud HTTPS.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });
