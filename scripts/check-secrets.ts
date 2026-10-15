import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "8.30.1";
// Official release archive hashes, pinned here so downloads cannot supply their own trust anchor.
const archives = new Map([
  ["darwin-arm64", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"],
  ["darwin-x64", "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"],
  ["linux-arm64", "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"],
  ["linux-x64", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
]);
const platform = `${process.platform}-${process.arch}`;
const digest = archives.get(platform);
if (digest === undefined) throw new Error(`Secret scanning is unsupported on ${platform}`);
const tools = fileURLToPath(new URL("../.git-review-tools/gitleaks/", import.meta.url));
const directory = resolve(tools, `${version}-${platform}`);
const binary = resolve(directory, "gitleaks");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--install" && args[0] !== "--staged"))
  throw new Error("Usage: bun run secrets:install | bun run secrets:check [--staged]");

if (args[0] === "--install" && !(await Bun.file(binary).exists())) {
  await mkdir(tools, { recursive: true });
  const staging = await mkdtemp(resolve(tools, "download-"));
  try {
    const archive = `gitleaks_${version}_${process.platform}_${process.arch}.tar.gz`;
    const response = await fetch(
      `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) throw new Error(`Gitleaks download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== digest)
      throw new Error("Gitleaks archive checksum mismatch");
    const archivePath = resolve(staging, "release.tar.gz");
    await writeFile(archivePath, bytes);
    const extracted = Bun.spawnSync(
      ["tar", "-xzf", archivePath, "-C", staging, "gitleaks", "LICENSE"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (extracted.exitCode !== 0)
      throw new Error("Could not extract the verified Gitleaks archive");
    await rm(archivePath);
    await chmod(resolve(staging, "gitleaks"), 0o700);
    await rename(staging, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (!(await Bun.file(binary).exists()))
  throw new Error(
    "Secret scanner missing. Run bun run secrets:install once (requires network access).",
  );
const installed = Bun.spawnSync([binary, "version"], { stdout: "pipe", stderr: "pipe" });
if (installed.exitCode !== 0 || new TextDecoder().decode(installed.stdout).trim() !== version)
  throw new Error("Unexpected Gitleaks version. Remove .git-review-tools/gitleaks/ and reinstall.");
if (args[0] === "--install") {
  console.log(`Gitleaks ${version} is ready. Scanning runs locally without uploading findings.`);
} else {
  const scan = Bun.spawn(
    [
      binary,
      "git",
      "--no-banner",
      "--no-color",
      "--redact=100",
      ...(args[0] === "--staged" ? ["--pre-commit", "--staged"] : ["--log-opts=--all"]),
      ".",
    ],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = await scan.exited;
}
