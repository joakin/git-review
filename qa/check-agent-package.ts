import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseApiError,
  parseDiffResponse,
  parseDirectoryResponse,
  parseFileReadResponse,
  parseFileTreeResponse,
  parseLanguagesResponse,
  parseProjectResponse,
  parseRootResponse,
  parseSearchResponse,
  parseStatusResponse,
} from "@git-review/shared/api";
import { parseCommitDetail, parseGitHistory, parseGitRefs } from "@git-review/shared/git";
import { projectApiUrl } from "@git-review/shared/project-path";
import { parseAgentInfoResponse } from "@git-review/shared/agent-info";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { testGitText as git, withTempDirectory } from "./test-support.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function fingerprint(directory: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of (await readdir(directory, { recursive: true })).sort()) {
    const absolute = join(directory, path);
    const metadata = await lstat(absolute);
    hash.update(`${path}\0${metadata.mode}\0${metadata.mtimeMs}\0`);
    if (metadata.isSymbolicLink()) hash.update(await readlink(absolute));
    else if (metadata.isFile()) hash.update(await readFile(absolute));
  }
  return hash.digest("hex");
}

const built = Bun.spawnSync([process.execPath, "scripts/build-agent.ts"], {
  stdout: "pipe",
  stderr: "pipe",
});
assert(built.exitCode === 0, new TextDecoder().decode(built.stderr));
console.log(new TextDecoder().decode(built.stdout).trim());

await withTempDirectory("git-review-agent-package-", async (temporary) => {
  const directory = await realpath(temporary);
  const artifact = join(directory, "agent");
  await cp(resolve("dist/agent"), artifact, { recursive: true });
  assert(
    (await readdir(artifact)).sort().join(",") ===
      "README.md,THIRD_PARTY_NOTICES.txt,agent.js,cloud.js,install-linux.sh",
    "Unexpected runtime files",
  );
  const notices = await readFile(join(artifact, "THIRD_PARTY_NOTICES.txt"), "utf8");
  for (const name of ["shiki", "@shikijs/core", "@shikijs/vscode-textmate"])
    assert(notices.includes(`${name}@`), `Missing upstream notices for ${name}`);
  const imports = new Bun.Transpiler({ loader: "js", target: "bun" }).scanImports(
    await Bun.file(join(artifact, "agent.js")).text(),
  );
  assert(
    imports.every(({ path }) => isBuiltin(path) || path === "bun" || path.startsWith("bun:")),
    "Bundle retains an external runtime import",
  );
  const root = join(directory, "approved");
  const project = join(root, "project : #?% 雪");
  const outside = join(directory, "outside");
  await mkdir(project, { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "Outside approved root\n");
  await symlink(outside, join(root, "outside-alias"));
  const samples = [
    {
      path: "value.ts",
      language: "typescript",
      text: "export const packageProbe = 1; // local fixture\n",
    },
    { path: "script.py", language: "python", text: "def package_probe():\n    return 'ready'\n" },
    {
      path: "view.vue",
      language: "vue",
      text: '<script setup lang="ts">const value = 1;</script>\n<template><p>{{ value }}</p></template>\n',
    },
  ];
  git(project, "init", "-q", "-b", "main");
  for (const sample of samples) await writeFile(join(project, sample.path), sample.text);
  git(project, "add", ".");
  git(project, "commit", "-qm", "Package fixture");
  const oid = git(project, "rev-parse", "HEAD");
  await writeFile(join(project, "value.ts"), samples[0]?.text.replace("= 1", "= 2") ?? "");
  await symlink(join(outside, "secret.txt"), join(project, "outside-link.txt"));
  const before = await fingerprint(root);

  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.startsWith("GIT_REVIEW_")) delete environment[key];

  async function withAgent(
    overrides: Readonly<Record<string, string>>,
    check: (origin: string) => Promise<void>,
  ): Promise<void> {
    const child = Bun.spawn([process.execPath, "agent.js", "--root", root, "--port", "0"], {
      cwd: artifact,
      env: { ...environment, ...overrides },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new Response(child.stderr).text();
    const timeout = setTimeout(() => child.kill(), 60_000);
    const reader = child.stdout.getReader();
    let output = "";
    try {
      let address: string | undefined;
      while (address === undefined) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Packaged agent did not start: ${await stderr}`);
        output += new TextDecoder().decode(chunk.value);
        assert(output.length < 65_536, "Excessive startup output");
        address = /git-review agent: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
      }
      await check(new URL(address).origin);
    } finally {
      clearTimeout(timeout);
      child.kill();
      await child.exited;
      await reader.cancel();
      reader.releaseLock();
      const errors = await stderr;
      assert(errors === "", `Agent wrote unexpected errors: ${errors}`);
    }
  }

  async function json(origin: string, path: string): Promise<unknown> {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(20_000) });
    assert(response.ok, `${path} failed with ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  async function unavailable(response: Response, status: number): Promise<void> {
    assert(response.status === status, `Expected ${status}, got ${response.status}`);
    assert(parseApiError(await response.json()) !== null, "Missing structured API error");
  }

  async function information(origin: string) {
    const handshake = parseAgentInfoResponse(await json(origin, "/api/info"));
    assert(
      handshake.kind === "compatible",
      "Packaged agent is incompatible with its shared protocol",
    );
    assert(
      handshake.info.agentVersion.startsWith("unreleased-"),
      "Packaged build identity is missing",
    );
    return handshake.info;
  }

  await withAgent({}, async (origin) => {
    await information(origin);
    assert(parseRootResponse(await json(origin, "/api/roots")).path === root, "Root mismatch");
    const listing = parseDirectoryResponse(await json(origin, "/api/directories?path="));
    assert(
      listing.entries.some((entry) => entry.name === "project : #?% 雪"),
      "Project not listed",
    );
    assert(
      parseProjectResponse(await json(origin, projectApiUrl("", project))).absolutePath === project,
      "Canonical project mismatch",
    );
    const languages = parseLanguagesResponse(await json(origin, "/api/languages"));
    for (const sample of samples) {
      assert(
        languages.some(({ id }) => id === sample.language),
        "Bundled language missing",
      );
      const file = parseFileReadResponse(
        await json(
          origin,
          projectApiUrl("/file", project, { path: sample.path, source: "worktree" }),
        ),
      );
      assert(
        file.kind === "text" &&
          file.syntax.kind === "highlighted" &&
          file.syntax.language === sample.language,
        `${sample.path} fell back to plain text`,
      );
      assert(
        file.lines.flatMap(({ tokens }) => tokens).some(({ role }) => role !== "plain"),
        "Missing syntax tokens",
      );
      assert(
        file.lines.every(({ tokens, text }) => tokens.map((token) => token.text).join("") === text),
        "Syntax changed source text",
      );
      if (sample.language === "vue")
        assert(
          file.lines[0]?.tokens.some(({ role }) => role === "keyword") === true &&
            file.lines[0]?.tokens.some(({ role }) => role === "number") === true,
          "Embedded TypeScript grammar did not load",
        );
    }
    const tree = parseFileTreeResponse(
      await json(origin, projectApiUrl("/tree", project, { path: "" })),
    );
    assert(
      tree.entries.some(({ path }) => path === "value.ts"),
      "File tree missing source",
    );
    const search = parseSearchResponse(
      await json(origin, projectApiUrl("/search", project, { query: "packageProbe" })),
    );
    assert(
      search.matches.some(({ path, line }) => path === "value.ts" && line === 1),
      "Search missing literal match",
    );
    const status = parseStatusResponse(await json(origin, projectApiUrl("/status", project)));
    assert(status.kind === "git", "Missing Git status");
    assert(
      status.entries.some(({ path, layer }) => path === "value.ts" && layer === "unstaged"),
      "Git status missing change",
    );
    const diff = parseDiffResponse(
      await json(
        origin,
        projectApiUrl("/diff", project, {
          path: "value.ts",
          layer: "unstaged",
          revision: status.revision,
          changeToken: status.changeToken,
        }),
      ),
    );
    assert(diff.kind === "text" && diff.syntax.kind === "highlighted", "Git diff syntax failed");
    parseGitRefs(await json(origin, projectApiUrl("/git/refs", project)));
    assert(
      parseGitHistory(
        await json(origin, projectApiUrl("/git/log", project, { ref: "refs/heads/main" })),
      ).commits.some((commit) => commit.oid === oid),
      "History missing fixture commit",
    );
    assert(
      parseCommitDetail(await json(origin, projectApiUrl(`/git/commits/${oid}`, project))).oid ===
        oid,
      "Commit mismatch",
    );
    for (const path of ["/", "/index.html", "/assets/main.js", "/sw.js", "/manifest.webmanifest"])
      assert(
        (await fetch(origin + path)).status === 404,
        "Agent unexpectedly serves frontend assets",
      );
    for (const candidate of [outside, join(root, "outside-alias")])
      await unavailable(await fetch(origin + projectApiUrl("", candidate)), 403);
    await unavailable(
      await fetch(
        origin + projectApiUrl("/file", project, { path: "../secret.txt", source: "worktree" }),
      ),
      400,
    );
    const link = parseFileReadResponse(
      await json(
        origin,
        projectApiUrl("/file", project, { path: "outside-link.txt", source: "worktree" }),
      ),
    );
    assert(link.kind === "symlink", "Agent followed an outside symlink");
    await unavailable(
      await fetch(origin + "/api/roots", { headers: { origin: "https://unconfigured.example" } }),
      403,
    );
  });
  console.log(
    "Isolated bundle: roots, projects, files, lazy syntax (including Vue embeddings), Search, Git, read-only boundaries and API-only routing passed",
  );

  await withAgent(
    {
      GIT_REVIEW_FFMPEG_PATH: join(directory, "missing-ffmpeg"),
      GIT_REVIEW_HANDY_PATH: join(directory, "missing-handy"),
    },
    async (origin) => {
      assert(
        (await information(origin)).capabilities.transcription.kind === "unavailable",
        "Missing tools were advertised as usable",
      );
      parseRootResponse(await json(origin, "/api/roots"));
      await unavailable(
        await fetch(origin + "/api/transcriptions", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Uint8Array([1]),
        }),
        503,
      );
      parseFileReadResponse(
        await json(
          origin,
          projectApiUrl("/file", project, { path: "value.ts", source: "worktree" }),
        ),
      );
    },
  );
  console.log(
    "Absent voice tools: startup and typed reads remain usable; transcription returns 503",
  );

  const tools = join(directory, "tools");
  await mkdir(tools);
  const ffmpeg = join(tools, "ffmpeg.js");
  const handy = join(tools, "handy.js");
  const auditPath = join(tools, "audit.json");
  await writeFile(
    ffmpeg,
    `#!${process.execPath}\nconst args = process.argv.slice(2);\nawait Bun.write(${JSON.stringify(auditPath)}, JSON.stringify(args));\nawait Bun.write(args.at(-1), new Uint8Array(100));\n`,
  );
  await writeFile(
    handy,
    `#!${process.execPath}\nif (process.argv[2] !== "--transcribe-file" || process.argv[4] !== "--json") process.exit(2);\nconsole.log(JSON.stringify({text: "  Configured package transcription.  "}));\n`,
  );
  await chmod(ffmpeg, 0o700);
  await chmod(handy, 0o700);
  await withAgent(
    { GIT_REVIEW_FFMPEG_PATH: ffmpeg, GIT_REVIEW_HANDY_PATH: handy },
    async (origin) => {
      assert(
        (await information(origin)).capabilities.transcription.kind === "unverified",
        "Executable presence incorrectly verified the model",
      );
      const response = await fetch(origin + "/api/transcriptions", {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: new Uint8Array([1]),
      });
      assert(
        response.status === 200,
        `Configured transcription failed: ${response.status} ${response.ok ? "" : await response.text()}`,
      );
      const body = expectRecord(await response.json(), "transcription");
      assert(
        expectString(body["text"], "transcript") === "Configured package transcription.",
        "Transcript mismatch",
      );
      const audit: unknown = JSON.parse(await readFile(auditPath, "utf8"));
      assert(
        Array.isArray(audit) && audit.every((arg: unknown) => typeof arg === "string"),
        "Invalid tool audit",
      );
      assert(
        audit.slice(0, 5).join(" ") === "-nostdin -hide_banner -loglevel error -i",
        "Normalization arguments changed",
      );
      const input = audit[5];
      const output = audit.at(-1);
      assert(
        typeof input === "string" && typeof output === "string",
        "Missing temporary audio paths",
      );
      assert(
        !(await Bun.file(input).exists()) && !(await Bun.file(output).exists()),
        "Temporary audio was retained",
      );
      assert(
        (await information(origin)).capabilities.transcription.kind === "available",
        "A successful transcription did not verify capability",
      );
      await writeFile(handy, `#!${process.execPath}\nprocess.exit(1);\n`);
      await unavailable(
        await fetch(origin + "/api/transcriptions", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Uint8Array([1]),
        }),
        503,
      );
      assert(
        (await information(origin)).capabilities.transcription.kind === "unverified",
        "Failed transcription retained stale verification",
      );
    },
  );
  assert((await fingerprint(root)) === before, "Agent modified the approved root or Git metadata");
  console.log(
    "Configured voice adapter: absolute tools, fixed arguments, transcript/cleanup and unverified/verified/revoked capability states passed (stub executables, no model inference)",
  );

  await withAgent(
    {
      PATH: tools,
      GIT_REVIEW_RG_PATH: join(directory, "missing-rg"),
      GIT_REVIEW_FFMPEG_PATH: ffmpeg,
      GIT_REVIEW_HANDY_PATH: join(directory, "missing-handy"),
    },
    async (origin) => {
      const capabilities = (await information(origin)).capabilities;
      assert(
        capabilities.git.kind === "unavailable" && capabilities.search.kind === "unavailable",
        "Missing Git/rg capability was incorrectly advertised",
      );
      assert(
        capabilities.transcription.kind === "unavailable" &&
          capabilities.transcription.reason === "missing_handy",
        "Missing Handy capability was incorrectly advertised",
      );
    },
  );

  for (const args of [
    ["--root", join(directory, "missing-root")],
    ["--port", "65536"],
  ]) {
    const child = Bun.spawn([process.execPath, "agent.js", ...args], {
      cwd: artifact,
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      assert(
        code === 1 && stdout === "" && stderr.startsWith("git-review agent:"),
        "Invalid startup configuration did not fail before listening",
      );
    } finally {
      clearTimeout(timeout);
      child.kill();
      await child.exited;
    }
  }
  console.log("Invalid CLI/root configuration fails before listening; package checks passed");
});
