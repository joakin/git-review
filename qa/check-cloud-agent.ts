import { cp, mkdir, readFile, writeFile, chmod, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import { parseRootResponse } from "@git-review/shared/api";
import { withTempDirectory } from "./test-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const build = Bun.spawnSync([process.execPath, "scripts/build-agent.ts"], {
  stdout: "pipe",
  stderr: "pipe",
});
assert(build.exitCode === 0, new TextDecoder().decode(build.stderr));
const fakeKey = "tskey-auth-QA-not-a-real-key";
await withTempDirectory("git-review-cloud-package-", async (directory) => {
  const artifact = join(directory, "runtime");
  const root = join(directory, "code");
  const log = join(directory, "calls.jsonl");
  const nodeState = join(directory, "node.json");
  const daemonInfo = join(directory, "daemon.json");
  const daemonPath = join(directory, "tailscaled");
  const cliPath = join(directory, "tailscale");
  await mkdir(root);
  await writeFile(join(root, "notes.ts"), "export const cloud = true;\n");
  await cp(resolve("dist/agent"), artifact, { recursive: true });
  const shared = `import { appendFile, readFile, writeFile, stat } from "node:fs/promises";
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
const socket = args.find((arg) => arg.startsWith("--socket="))?.slice(9);
if (!socket || process.env.TS_AUTHKEY !== undefined) throw new Error("Socket isolation or credential forwarding failed");
`;
  await writeFile(
    daemonPath,
    `#!${process.execPath}
${shared}
import { createServer } from "node:net";
if (!args.includes("--state=mem:") || !args.includes("--tun=userspace-networking")) throw new Error("Unsafe daemon configuration");
await writeFile(${JSON.stringify(daemonInfo)}, JSON.stringify({ pid: process.pid, socket }));
const server = createServer(() => {}).listen(socket);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
if (process.env.QA_CLOUD_MODE === "daemon-exit") setTimeout(() => process.exit(8), 1500);
`,
  );
  await writeFile(
    cliPath,
    `#!${process.execPath}
${shared}
const command = args[1];
await appendFile(log, JSON.stringify({ command, args, socket }) + String.fromCharCode(10));
if (command === "up") {
  const keyPath = args.find((arg) => arg.startsWith("--auth-key=file:"))?.slice("--auth-key=file:".length);
  if (!keyPath || (await stat(keyPath)).mode % 512 !== 384 || (await readFile(keyPath, "utf8")) !== ${JSON.stringify(fakeKey)}) throw new Error("Enrollment file is missing or not private");
  const hostname = args.find((arg) => arg.startsWith("--hostname="))?.slice(11);
  await writeFile(${JSON.stringify(nodeState)}, JSON.stringify({ hostname, keyPath }));
} else if (command === "status") {
  const { hostname } = JSON.parse(await readFile(${JSON.stringify(nodeState)}, "utf8"));
  console.log(JSON.stringify({ BackendState: "Running", Self: { DNSName: process.env.QA_CLOUD_MODE === "bad-dns" ? "https://wrong.example" : "assigned-" + hostname + ".tailnet.ts.net." }, Peer: { DNSName: "wrong-peer.ts.net" } }));
} else if (command === "serve") {
  if (process.env.QA_CLOUD_MODE === "serve-fails") { console.error("Controlled failure " + ${JSON.stringify(fakeKey)}); process.exit(1); }
  if (!args.includes("--bg") || !args.includes("--https=443")) throw new Error("Serve is not private HTTPS");
  const target = args.at(-1);
  const response = await fetch(target + "/api/info");
  if (!response.ok) throw new Error("Agent was not ready before Serve");
} else if (command !== "logout") throw new Error("Unexpected CLI command");
`,
  );
  await chmod(cliPath, 0o755);
  await chmod(daemonPath, 0o755);
  const sentinelSocket = join(directory, "managed.sock");
  const sentinel = createServer(() => {});
  await new Promise<void>((ready) => sentinel.listen(sentinelSocket, ready));
  const portHolder = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("sentinel"),
  });
  const port = portHolder.port;
  assert(typeof port === "number", "No fixture port");
  const env = {
    ...process.env,
    TS_AUTHKEY: fakeKey,
    GIT_REVIEW_CLIENT_URL: "https://client.example/git-review/",
    GIT_REVIEW_TAILSCALE_PATH: cliPath,
    GIT_REVIEW_TAILSCALED_PATH: daemonPath,
  };
  const launch = (mode: string) =>
    Bun.spawn([process.execPath, "cloud.js", "--root", root, "--port", String(port)], {
      cwd: artifact,
      env: { ...env, QA_CLOUD_MODE: mode },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  const calls = async () =>
    (await readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => expectRecord(JSON.parse(line) as unknown, "CLI call"));
  const successfulNames: string[] = [];
  try {
    const occupied = launch("normal");
    assert((await occupied.exited) !== 0, "Occupied loopback port was accepted");
    assert((await calls()).length === 0, "An occupied port enrolled a node");
    await portHolder.stop(true);
    for (const mode of ["normal", "normal", "serve-fails", "bad-dns", "daemon-exit"]) {
      const child = launch(mode);
      let output = "";
      const consumed = (async () => {
        for await (const chunk of child.stdout) output += new TextDecoder().decode(chunk);
      })();
      const errors = new Response(child.stderr).text();
      const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
      try {
        if (mode === "normal") {
          const readyBy = Date.now() + 10_000;
          while (
            !output.includes("Cloud agent ready on") &&
            child.exitCode === null &&
            Date.now() < readyBy
          )
            await Bun.sleep(25);
          assert(
            output.includes("Cloud agent ready on"),
            "Supervisor did not reach readiness: " +
              output +
              (await (child.exitCode === null ? Promise.resolve("") : errors)),
          );
          const node = expectRecord(
            JSON.parse(await readFile(nodeState, "utf8")) as unknown,
            "node state",
          );
          const hostname = expectString(node["hostname"], "hostname");
          successfulNames.push(hostname);
          const origin = `https://assigned-${hostname}.tailnet.ts.net`;
          assert(
            output.includes(origin),
            "Launcher used a requested hostname instead of actual node DNS",
          );
          assert(
            output.includes(
              "https://client.example/git-review/?connect=" + encodeURIComponent(origin),
            ),
            "Printed link lost the assigned origin or subpath",
          );
          assert(
            !(await Bun.file(expectString(node["keyPath"], "key path")).exists()),
            "Enrollment key remained after use",
          );
          const info = await fetch(`http://127.0.0.1:${port}/api/info`, {
            headers: { Origin: "https://client.example" },
          });
          assert(
            info.headers.get("Access-Control-Allow-Origin") === "https://client.example" &&
              parseAgentInfoResponse((await info.json()) as unknown).kind === "compatible",
            "Cloud agent did not allow exactly the configured client",
          );
          const roots = parseRootResponse(
            (await (await fetch(`http://127.0.0.1:${port}/api/roots`)).json()) as unknown,
          );
          assert(roots.path === (await realpath(root)), "Agent serves a different approved root");
          child.kill("SIGTERM");
        }
        const code = await child.exited;
        await consumed;
        const stderr = await errors;
        assert(
          code === (mode === "normal" ? 0 : 1),
          `${mode}: unexpected supervisor exit ${code}: ${stderr}`,
        );
        assert(
          !output.includes(fakeKey) && !stderr.includes(fakeKey),
          "Credential leaked to output",
        );
        const owned = expectRecord(
          JSON.parse(await readFile(daemonInfo, "utf8")) as unknown,
          "owned daemon",
        );
        assert(
          !(await Bun.file(expectString(owned["socket"], "owned socket")).exists()),
          "Owned socket remained after shutdown",
        );
        assert((await stat(sentinelSocket)).isSocket(), "Managed node was modified during cleanup");
        assert(
          (await calls()).every(
            (call) =>
              expectString(call["socket"], "command socket") !== sentinelSocket &&
              call["command"] !== "reset",
          ),
          "Cleanup reached a shared node or reset Serve",
        );
        assert(
          !(await fetch(`http://127.0.0.1:${port}/api/info`).then(
            () => true,
            () => false,
          )),
          "Agent remained alive after supervisor exit",
        );
      } finally {
        clearTimeout(deadline);
        if (child.exitCode === null) child.kill("SIGTERM");
        await child.exited;
      }
    }
    assert(
      successfulNames[0] !== successfulNames[1],
      "Independent launches shared a cached hostname",
    );
    assert(
      (await calls()).filter((call) => call["command"] === "logout").length >= 4,
      "Normal and failed startups did not log out owned nodes",
    );
  } finally {
    await portHolder.stop(true);
    await new Promise<void>((done) => sentinel.close(() => done()));
  }
});
console.log(
  `Cloud launcher passed on ${process.platform}: isolated packaged agent, private enrollment file, actual DNS/link, exact CORS/root, fresh names, occupied port, failed Serve/DNS/daemon, owned cleanup. Tailscale was simulated; no cloud lifetime or remote HTTPS proof.`,
);
