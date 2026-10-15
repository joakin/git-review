import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { thirdPartyNotices } from "./third-party-notices.ts";
import { runGit } from "../apps/agent/src/git-execution.ts";

if (process.argv.length !== 2) throw new Error("Usage: bun run build:agent");
const repository = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(repository, "dist/agent");
await mkdir(resolve(repository, "dist"), { recursive: true });
const staging = await mkdtemp(resolve(repository, "dist/agent-build-"));

async function buildVersion(): Promise<string> {
  try {
    const revision = (await runGit(repository, ["rev-parse", "--short=12", "HEAD"], 256 * 1024))
      .toString("utf8")
      .trim();
    if (!/^[0-9a-f]{12}$/.test(revision)) return "development";
    const dirty =
      (await runGit(repository, ["status", "--porcelain", "--untracked-files=normal"], 256 * 1024))
        .toString("utf8")
        .trim() !== "";
    return `unreleased-${revision}${dirty ? "-dirty" : ""}`;
  } catch {
    return "development";
  }
}

try {
  const result = await Bun.build({
    entrypoints: [resolve(repository, "apps/agent/src/main.ts")],
    outdir: staging,
    target: "bun",
    format: "esm",
    packages: "bundle",
    splitting: false,
    naming: "agent.js",
    minify: true,
    define: { __GIT_REVIEW_AGENT_VERSION__: JSON.stringify(await buildVersion()) },
  });
  if (!result.success) throw new AggregateError(result.logs, "Agent build failed");
  if (result.outputs.length !== 1 || result.outputs[0]?.path !== resolve(staging, "agent.js"))
    throw new Error("Agent build must include all runtime modules/assets in agent.js");
  const bundleBytes = result.outputs[0].size;
  const cloud = await Bun.build({
    entrypoints: [resolve(repository, "apps/agent/src/cloud-main.ts")],
    outdir: staging,
    target: "bun",
    format: "esm",
    packages: "bundle",
    splitting: false,
    naming: "cloud.js",
    minify: true,
  });
  if (
    !cloud.success ||
    cloud.outputs.length !== 1 ||
    cloud.outputs[0]?.path !== resolve(staging, "cloud.js")
  )
    throw new AggregateError(cloud.logs, "Cloud launcher build failed");
  await copyFile(
    resolve(repository, "deploy/install-linux.sh"),
    resolve(staging, "install-linux.sh"),
  );
  await copyFile(resolve(repository, "LICENSE"), resolve(staging, "COPYRIGHT.txt"));
  await writeFile(
    resolve(staging, "THIRD_PARTY_NOTICES.txt"),
    await thirdPartyNotices(["shiki"], resolve(repository, "apps/agent/package.json")),
  );
  await writeFile(
    resolve(staging, "README.md"),
    `# git-review agent

Copy this directory to the code host. No source checkout, frontend or npm installation is needed.
Requires Bun (packaging tested with ${Bun.version}), Git, and ripgrep for Search.

\`\`\`sh
bun agent.js --help
bun agent.js --root /path/to/projects --port 3000
\`\`\`

The agent serves only /api/ routes and binds to 127.0.0.1 by default.
cloud.js provides optional isolated userspace Tailscale enrollment and supervision; run bun cloud.js --help.
install-linux.sh installs pinned Bun/Tailscale binaries without enrollment or root privileges after OS prerequisites exist.
Use a private Tailscale Serve proxy for HTTPS; enrollment and process lifetime are managed externally.
GIT_REVIEW_PUBLIC_ORIGIN is the exact HTTPS agent origin used by that proxy, without a trailing slash.
GIT_REVIEW_ALLOWED_ORIGINS configures a JSON array of exact frontend HTTPS origins for CORS (default []).
GIT_REVIEW_CLIENT_URL optionally supplies the static deployment URL ending in / and prints a prefilled Add host link.
It requires GIT_REVIEW_PUBLIC_ORIGIN and the client's origin in GIT_REVIEW_ALLOWED_ORIGINS.
HTTP loopback origins are supported only for explicit local development configuration.
GET /api/info reports protocol/build information and current optional capabilities without invoking a model.

Voice is optional. Working FFmpeg, Handy and an installed model are required only for transcription.
Explicit GIT_REVIEW_FFMPEG_PATH and GIT_REVIEW_HANDY_PATH overrides must be absolute executables.
Search accepts an absolute GIT_REVIEW_RG_PATH override. Git must be on PATH.

Shiki's lazy language modules and inlined Oniguruma WebAssembly are bundled in agent.js.
THIRD_PARTY_NOTICES.txt retains upstream dependency notices. No platform-specific executable is included.
COPYRIGHT.txt retains the project's copyright notice; no open-source license is granted.
`,
  );
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Built ${resolve(output, "agent.js")} (${bundleBytes} bytes)`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
