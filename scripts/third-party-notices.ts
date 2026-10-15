import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expectRecord, expectString } from "@git-review/shared/validation";

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

/** Retain upstream notices for bundled production dependencies and their dependency closure. */
export async function thirdPartyNotices(names: readonly string[], from: string): Promise<string> {
  const pending = await Promise.all(names.map((name) => dependencyManifest(name, from)));
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
