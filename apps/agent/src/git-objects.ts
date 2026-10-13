import { expectGitOid, gitPath } from "@git-review/shared/git";
import { expectNonNegativeInteger } from "@git-review/shared/validation";
import { GitCommandError, runGit } from "./git-execution.ts";

type GitObjectType = "blob" | "commit" | "tree" | "tag";
type GitPathSource = { kind: "head" | "index"; path: string };
type GitBlobSource = GitPathSource | { kind: "object"; oid: string };
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function gitObjectType(cwd: string, oid: string): Promise<GitObjectType> {
  const type = decoder
    .decode(await runGit(cwd, ["cat-file", "-t", expectGitOid(oid)], 4096))
    .trim();
  if (type !== "blob" && type !== "commit" && type !== "tree" && type !== "tag")
    throw new Error("Invalid Git object type");
  return type;
}

export async function hasGitObject(
  cwd: string,
  oid: string,
  type: GitObjectType,
): Promise<boolean> {
  try {
    return (await gitObjectType(cwd, oid)) === type;
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === 128) return false;
    throw error;
  }
}

export async function resolveGitBlob(cwd: string, source: GitBlobSource): Promise<string | null> {
  if (source.kind === "object") return expectGitOid(source.oid);
  const path = gitPath(source.path);
  try {
    if (source.kind === "head") {
      // Preserve M01: :./ resolves from the selected project's cwd, including subfolders.
      return expectGitOid(
        decoder
          .decode(
            await runGit(
              cwd,
              ["rev-parse", "--verify", "--end-of-options", `HEAD:./${path}`],
              4096,
            ),
          )
          .trim(),
      );
    }
    const output = decoder.decode(
      await runGit(cwd, ["ls-files", "--stage", "-z", "--", path], 16 * 1024),
    );
    for (const record of output.split("\0")) {
      const match = /^(100644|100755) ((?:[0-9a-f]{40}|[0-9a-f]{64})) 0\t([^]*)$/.exec(record);
      if (match !== null && match[3] === path) return expectGitOid(match[2]);
    }
    return null;
  } catch {
    return null;
  }
}

export async function inspectGitBlob(
  cwd: string,
  oid: string,
): Promise<{ kind: "blob"; byteLength: number } | { kind: "other" }> {
  if ((await gitObjectType(cwd, oid)) !== "blob") return { kind: "other" };
  const size = decoder
    .decode(await runGit(cwd, ["cat-file", "-s", expectGitOid(oid)], 4096))
    .trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(size)) throw new Error("Invalid Git object size");
  return { kind: "blob", byteLength: expectNonNegativeInteger(Number(size), "Git object size") };
}

export function readGitBlob(cwd: string, oid: string, maxBytes: number): Promise<Buffer> {
  return runGit(cwd, ["cat-file", "blob", expectGitOid(oid)], maxBytes);
}

/** Full-source text for syntax decoration; the caller owns decoding and source availability. */
export function readGitPath(cwd: string, source: GitPathSource, maxBytes: number): Promise<Buffer> {
  const path = gitPath(source.path);
  return runGit(
    cwd,
    ["show", "--no-textconv", `${source.kind === "head" ? "HEAD" : ""}:${path}`],
    maxBytes,
  );
}
