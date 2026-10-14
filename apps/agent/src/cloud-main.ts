import { execFile } from "node:child_process";
import { chmod, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import { parseRootResponse } from "@git-review/shared/api";
import { parseCloudConfig, tailscaleOrigin, cloudChildEnvironment } from "./cloud-config.ts";
import { approveRoot } from "./paths.ts";

const help = `Usage: bun cloud.js --root /path/to/projects [--port 3000]
Starts an owned userspace Tailscale node and the sibling agent.js. Keep this supervisor running.
Required: TS_AUTHKEY (raw, preauthorized ephemeral enrollment key), GIT_REVIEW_CLIENT_URL (static HTTPS URL ending in /).
Optional: GIT_REVIEW_WORKSPACE_NAME (unique hostname), GIT_REVIEW_ALLOWED_ORIGINS (exact origins; defaults to client origin).
GIT_REVIEW_TAILSCALE_PATH and GIT_REVIEW_TAILSCALED_PATH may select absolute binaries.
It uses a fresh private socket and memory state. It never operates on an existing managed node.
SIGINT/SIGTERM stop only its agent and node; another launch gets fresh identity by default.
Provider process lifetime and inbound HTTPS reachability must be verified separately.`;

if (process.argv.slice(2).includes("--help")) {
  console.log(help);
  process.exit(0);
}
const config = parseCloudConfig(process.argv.slice(2), process.env);
delete process.env["TS_AUTHKEY"];
const environment = cloudChildEnvironment(process.env);
const root = await approveRoot(config.root);
const agentPath = fileURLToPath(new URL("./agent.js", import.meta.url));
if (!(await stat(agentPath)).isFile()) throw new Error("The packaged sibling agent.js is missing");
// Fail before enrollment if another service owns the requested loopback port.
const reservation = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  fetch: () => new Response(null, { status: 503 }),
});
await reservation.stop(true);
const directory = await mkdtemp(join(tmpdir(), "git-review-cloud-"));
await chmod(directory, 0o700);
const socket = join(directory, "tailscaled.sock");
const keyPath = join(directory, "enrollment.key");
const daemonLog = await open(join(directory, "tailscaled.log"), "wx", 0o600);
let daemon: ReturnType<typeof Bun.spawn> | null = null;
let agent: ReturnType<typeof Bun.spawn> | null = null;
const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function command(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      config.tailscale,
      [`--socket=${socket}`, ...args],
      { env: environment, timeout: 30_000, maxBuffer: 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error !== null) {
          const message = (stderr || error.message)
            .replaceAll(config.authKey, "[redacted]")
            .slice(0, 4096);
          reject(new Error(`Tailscale ${args[0] ?? "command"} failed: ${message}`));
        } else resolve(stdout);
      },
    );
  });
}
async function terminate(child: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (child === null || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2000);
  try {
    await child.exited;
  } finally {
    clearTimeout(timer);
  }
}
async function ready(test: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted();
    if (
      (daemon !== null && daemon.exitCode !== null) ||
      (agent !== null && agent.exitCode !== null)
    )
      throw new Error(`A supervised process stopped before ${label}`);
    if (await test()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
try {
  await writeFile(keyPath, config.authKey, { flag: "wx", mode: 0o600 });
  daemon = Bun.spawn(
    [config.tailscaled, "--tun=userspace-networking", "--state=mem:", `--socket=${socket}`],
    {
      env: environment,
      stdin: "ignore",
      stdout: daemonLog.fd,
      stderr: daemonLog.fd,
    },
  );
  await ready(async () => {
    try {
      return (await stat(socket)).isSocket();
    } catch {
      return false;
    }
  }, "the owned Tailscale socket");
  await command(
    [
      "up",
      `--auth-key=file:${keyPath}`,
      `--hostname=${config.hostname}`,
      "--accept-dns=false",
      "--accept-routes=false",
      "--timeout=20s",
    ],
    controller.signal,
  );
  await rm(keyPath);
  const origin = tailscaleOrigin(
    JSON.parse(await command(["status", "--json"], controller.signal)) as unknown,
  );
  agent = Bun.spawn(
    [process.execPath, agentPath, "--root", root.realPath, "--port", String(config.port)],
    {
      env: {
        ...environment,
        GIT_REVIEW_HOST: "127.0.0.1",
        GIT_REVIEW_PUBLIC_ORIGIN: origin,
        GIT_REVIEW_CLIENT_URL: config.clientUrl,
        GIT_REVIEW_ALLOWED_ORIGINS: JSON.stringify(config.allowedOrigins),
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  await ready(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}/api/info`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
        redirect: "error",
      });
      if (
        !response.ok ||
        parseAgentInfoResponse((await response.json()) as unknown).kind !== "compatible"
      )
        return false;
      const roots = await fetch(`http://127.0.0.1:${config.port}/api/roots`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
        redirect: "error",
      });
      return roots.ok && parseRootResponse((await roots.json()) as unknown).path === root.realPath;
    } catch {
      return false;
    }
  }, "agent readiness");
  await command(
    ["serve", "--bg", "--https=443", `http://127.0.0.1:${config.port}`],
    controller.signal,
  );
  console.log(
    `Cloud agent ready on ${origin}. Local readiness passed; verify this URL from another tailnet device.`,
  );
  await Promise.race([
    daemon.exited.then(() => {
      throw new Error("The owned Tailscale daemon stopped");
    }),
    agent.exited.then(() => {
      throw new Error("The review agent stopped");
    }),
    new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener("abort", () => resolve(), { once: true });
    }),
  ]);
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(
      error instanceof Error
        ? error.message.replaceAll(config.authKey, "[redacted]")
        : "Cloud startup failed",
    );
    process.exitCode = 1;
  }
} finally {
  controller.abort();
  await terminate(agent);
  if (daemon !== null && daemon.exitCode === null) {
    await command(["logout"]).catch(() =>
      console.error(
        "Owned node logout failed; ephemeral cleanup must remove it after disconnection.",
      ),
    );
  }
  await terminate(daemon);
  await daemonLog.close();
  await rm(directory, { recursive: true, force: true });
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
