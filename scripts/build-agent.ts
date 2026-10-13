import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectRecord, expectString } from "@git-review/shared/validation";

if (process.argv.length !== 2) throw new Error("Usage: bun run build:agent");
const repository = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(repository, "dist/agent");
await mkdir(resolve(repository, "dist"), { recursive: true });
const staging = await mkdtemp(resolve(repository, "dist/agent-build-"));

async function dependencyManifest(name: string, from: string): Promise<string> {
  const require = createRequire(from);
  try {
    return require.resolve(`${name}/package.json`);
  } catch {
    let directory = dirname(require.resolve(name));
    while (directory !== dirname(directory)) {
      const candidate = resolve(directory, "package.json");
      if (await Bun.file(candidate).exists()) {
        const manifest = expectRecord(await Bun.file(candidate).json(), "dependency manifest");
        if (manifest["name"] === name) return candidate;
      }
      directory = dirname(directory);
    }
    throw new Error(`Could not locate the license manifest for ${name}`);
  }
}

/** Include the upstream notices for Shiki and its dependency closure, including grammar data. */
async function thirdPartyNotices(): Promise<string> {
  const pending = [
    await dependencyManifest("shiki", resolve(repository, "apps/agent/package.json")),
  ];
  const notices = new Map<string, string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) break;
    const manifest = expectRecord(await Bun.file(path).json(), "dependency manifest");
    const name = expectString(manifest["name"], "dependency name");
    const version = expectString(manifest["version"], "dependency version");
    const identity = `${name}@${version}`;
    if (notices.has(identity)) continue;
    const directory = dirname(path);
    const files = (await readdir(directory))
      .filter((file) => /^(?:license|notice)(?:[.-].*)?$/i.test(file))
      .sort();
    if (files.length === 0) throw new Error(`Missing upstream license for ${identity}`);
    const contents = await Promise.all(
      files.map((file) => readFile(resolve(directory, file), "utf8")),
    );
    notices.set(identity, `${identity}\n${contents.join("\n")}`);
    const dependencies = expectRecord(manifest["dependencies"] ?? {}, "dependencies");
    for (const dependency of Object.keys(dependencies))
      pending.push(await dependencyManifest(dependency, path));
  }
  return [...notices]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, notice]) => notice)
    .join("\n\n---\n\n");
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
  });
  if (!result.success) throw new AggregateError(result.logs, "Agent build failed");
  if (result.outputs.length !== 1 || result.outputs[0]?.path !== resolve(staging, "agent.js"))
    throw new Error("Agent build must include all runtime modules/assets in agent.js");
  const bundleBytes = result.outputs[0].size;
  await writeFile(resolve(staging, "THIRD_PARTY_NOTICES.txt"), await thirdPartyNotices());
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
Use a private Tailscale Serve proxy for HTTPS; enrollment and process lifetime are managed externally.
GIT_REVIEW_PUBLIC_ORIGIN is the exact HTTPS agent origin used by that proxy, without a trailing slash.
Cross-origin frontend transport is a later implementation step.

Voice is optional. Working FFmpeg, Handy and an installed model are required only for transcription.
Explicit GIT_REVIEW_FFMPEG_PATH and GIT_REVIEW_HANDY_PATH overrides must be absolute executables.
Search accepts an absolute GIT_REVIEW_RG_PATH override. Git must be on PATH.

Shiki's lazy language modules and inlined Oniguruma WebAssembly are bundled in agent.js.
THIRD_PARTY_NOTICES.txt retains upstream dependency notices. No platform-specific executable is included.
`,
  );
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Built ${resolve(output, "agent.js")} (${bundleBytes} bytes)`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
