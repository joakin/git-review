import { parseDiffResponse, type ChangeKind, type DiffResult } from "./api.ts";
import { expectNonNegativeInteger, expectRecord, expectString } from "./validation.ts";

export type GitBranch = { kind: "local" | "remote"; ref: string; name: string; tip: string };
export type GitHead =
  | { kind: "branch"; ref: string; oid: string }
  | { kind: "detached"; oid: string }
  | { kind: "unborn"; ref: string };
export type GitRefs =
  { kind: "not_git" } | { kind: "git"; head: GitHead; branches: GitBranch[]; scope: string };
export type CommitStats =
  | { kind: "ready"; added: number; deleted: number; binaryFiles: number }
  | { kind: "unavailable"; reason: "missing_parent" | "limit" };
export type CommitMetadata = { oid: string; subject: string; author: string; date: string };
export type CommitSummary = CommitMetadata & { stats: CommitStats };
export type GitHistoryPage = { tip: string; commits: CommitSummary[]; nextOffset: number | null };
export type GitFileMode = "100644" | "100755" | "120000" | "160000";
export type CommitFileSide =
  { kind: "absent" } | { kind: "present"; path: string; mode: GitFileMode; oid: string };
export type CommitFileChange = {
  path: string;
  kind: Exclude<ChangeKind, "conflicted">;
  old: CommitFileSide;
  new: CommitFileSide;
};
export type CommitComparison =
  { kind: "empty" } | { kind: "parent" | "missing_parent"; oid: string };
export type CommitDetail = CommitSummary & {
  message: string;
  parents: string[];
  comparison: CommitComparison;
  files: CommitFileChange[];
  scope: string;
};
export type CommitDiff = Exclude<DiffResult, { kind: "stale" | "conflict" }>;
export type GitLogRequest =
  { kind: "ref"; ref: string } | { kind: "page"; tip: string; offset: number };

export function isGitOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

export function validGitRef(value: string): boolean {
  return (
    value === "HEAD" ||
    (value.length <= 1024 &&
      /^refs\/(?:heads|remotes)\//.test(value) &&
      !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) &&
      !value.includes("..") &&
      !value.includes("@{") &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock"),
        ))
  );
}

export function expectGitOid(value: unknown): string {
  const oid = expectString(value, "Git object ID");
  if (!isGitOid(oid)) throw new Error("Expected a complete Git object ID");
  return oid;
}

function refValue(value: unknown): string {
  const ref = expectString(value, "Git ref");
  if (!validGitRef(ref) || ref === "HEAD") throw new Error("Expected a branch ref");
  return ref;
}

export function gitPath(value: unknown, allowEmpty = false): string {
  const path = expectString(value, "Git path");
  if (
    path.length > 4096 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    (!allowEmpty && path === "") ||
    (path !== "" &&
      path
        .split("/")
        .some((part) => part === "" || part === "." || part === ".." || part === ".git"))
  )
    throw new Error("Expected a project-relative Git path");
  return path;
}

function text(value: unknown, label: string, max: number): string {
  const result = expectString(value, label);
  if (result.length > max || result.includes("\0")) throw new Error(`Expected bounded ${label}`);
  return result;
}

export function parseCommitStats(value: unknown): CommitStats {
  const raw = expectRecord(value, "commit stats");
  if (
    raw["kind"] === "unavailable" &&
    (raw["reason"] === "missing_parent" || raw["reason"] === "limit")
  )
    return { kind: "unavailable", reason: raw["reason"] };
  if (raw["kind"] !== "ready") throw new Error("Expected commit stats");
  return {
    kind: "ready",
    added: expectNonNegativeInteger(raw["added"], "added lines"),
    deleted: expectNonNegativeInteger(raw["deleted"], "deleted lines"),
    binaryFiles: expectNonNegativeInteger(raw["binaryFiles"], "binary files"),
  };
}

export function parseCommitMetadata(value: unknown): CommitMetadata {
  const raw = expectRecord(value, "commit");
  const date = expectString(raw["date"], "commit date");
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    throw new Error("Expected an ISO commit date");
  return {
    oid: expectGitOid(raw["oid"]),
    subject: text(raw["subject"], "commit subject", 1000),
    author: text(raw["author"], "commit author", 4096),
    date,
  };
}

export function parseCommitSummary(value: unknown): CommitSummary {
  const raw = expectRecord(value, "commit");
  return { ...parseCommitMetadata(raw), stats: parseCommitStats(raw["stats"]) };
}

export function parseGitRefs(value: unknown): GitRefs {
  const raw = expectRecord(value, "Git refs");
  if (raw["kind"] === "not_git") return { kind: "not_git" };
  if (raw["kind"] !== "git") throw new Error("Expected Git refs");
  const rawHead = expectRecord(raw["head"], "Git HEAD");
  let head: GitHead;
  if (rawHead["kind"] === "unborn") head = { kind: "unborn", ref: refValue(rawHead["ref"]) };
  else if (rawHead["kind"] === "detached")
    head = { kind: "detached", oid: expectGitOid(rawHead["oid"]) };
  else if (rawHead["kind"] === "branch")
    head = { kind: "branch", ref: refValue(rawHead["ref"]), oid: expectGitOid(rawHead["oid"]) };
  else throw new Error("Expected a Git HEAD state");
  const rawBranches = raw["branches"];
  if (!Array.isArray(rawBranches) || rawBranches.length > 1000)
    throw new Error("Expected bounded Git branches");
  const seen = new Set<string>();
  const branches: GitBranch[] = rawBranches.map((value: unknown) => {
    const branch = expectRecord(value, "branch");
    const ref = refValue(branch["ref"]);
    const kind = branch["kind"];
    if (
      (kind !== "local" && kind !== "remote") ||
      !ref.startsWith(kind === "local" ? "refs/heads/" : "refs/remotes/") ||
      seen.has(ref)
    )
      throw new Error("Expected a unique branch ref");
    seen.add(ref);
    const name = text(branch["name"], "branch name", 1024);
    if (name !== ref.slice(kind === "local" ? 11 : 13))
      throw new Error("Expected a matching branch name");
    return { kind, ref, name, tip: expectGitOid(branch["tip"]) };
  });
  return { kind: "git", head, branches, scope: gitPath(raw["scope"], true) };
}

export function parseGitHistory(value: unknown): GitHistoryPage {
  const raw = expectRecord(value, "Git history");
  const tip = expectGitOid(raw["tip"]);
  const rawCommits = raw["commits"];
  if (!Array.isArray(rawCommits) || rawCommits.length > 50)
    throw new Error("Expected bounded commit history");
  const commits = rawCommits.map(parseCommitSummary);
  if (new Set(commits.map((commit) => commit.oid)).size !== commits.length)
    throw new Error("Expected unique history commits");
  const nextOffset =
    raw["nextOffset"] === null
      ? null
      : expectNonNegativeInteger(raw["nextOffset"], "next history offset");
  if (nextOffset !== null && (nextOffset < 50 || nextOffset > 1_000_000 || commits.length !== 50))
    throw new Error("Expected a valid history cursor");
  return { tip, commits, nextOffset };
}

function fileSide(value: unknown): CommitFileSide {
  const raw = expectRecord(value, "commit file side");
  if (raw["kind"] === "absent") return { kind: "absent" };
  if (raw["kind"] !== "present") throw new Error("Expected a commit file side");
  const mode = raw["mode"];
  if (mode !== "100644" && mode !== "100755" && mode !== "120000" && mode !== "160000")
    throw new Error("Expected a Git file mode");
  return { kind: "present", path: gitPath(raw["path"]), mode, oid: expectGitOid(raw["oid"]) };
}

export function parseCommitDetail(value: unknown): CommitDetail {
  const raw = expectRecord(value, "commit detail");
  const summary = parseCommitSummary(value);
  const message = text(raw["message"], "commit message", 65_536);
  if (new TextEncoder().encode(message).byteLength > 65_536)
    throw new Error("Expected a bounded commit message");
  const rawParents = raw["parents"];
  if (!Array.isArray(rawParents) || rawParents.length > 64)
    throw new Error("Expected bounded commit parents");
  const parents = rawParents.map(expectGitOid);
  const rawComparison = expectRecord(raw["comparison"], "commit comparison");
  let comparison: CommitComparison;
  if (rawComparison["kind"] === "empty" && parents.length === 0) comparison = { kind: "empty" };
  else if (rawComparison["kind"] === "parent" || rawComparison["kind"] === "missing_parent") {
    const oid = expectGitOid(rawComparison["oid"]);
    if (oid !== parents[0]) throw new Error("Expected a first-parent comparison");
    comparison = { kind: rawComparison["kind"], oid };
  } else throw new Error("Expected a commit comparison");
  const rawFiles = raw["files"];
  if (!Array.isArray(rawFiles) || rawFiles.length > 1000)
    throw new Error("Expected bounded commit files");
  const seen = new Set<string>();
  const files: CommitFileChange[] = rawFiles.map((value: unknown) => {
    const file = expectRecord(value, "commit file");
    const path = gitPath(file["path"]);
    const kind = file["kind"];
    if (
      kind !== "added" &&
      kind !== "modified" &&
      kind !== "deleted" &&
      kind !== "renamed" &&
      kind !== "copied" &&
      kind !== "type_changed"
    )
      throw new Error("Expected a commit change kind");
    const old = fileSide(file["old"]);
    const next = fileSide(file["new"]);
    if (
      seen.has(path) ||
      (next.kind === "present"
        ? next.path !== path
        : old.kind !== "present" || old.path !== path) ||
      (kind === "added"
        ? old.kind !== "absent" || next.kind !== "present"
        : kind === "deleted"
          ? old.kind !== "present" || next.kind !== "absent"
          : old.kind !== "present" || next.kind !== "present")
    )
      throw new Error("Expected matching commit file sides");
    seen.add(path);
    return { path, kind, old, new: next };
  });
  if (comparison.kind === "missing_parent" && files.length !== 0)
    throw new Error("Expected unavailable comparison files");
  return { ...summary, message, parents, comparison, files, scope: gitPath(raw["scope"], true) };
}

export function parseCommitDiff(value: unknown): CommitDiff {
  const diff = parseDiffResponse(value);
  if (diff.kind === "stale" || diff.kind === "conflict")
    throw new Error("Expected an immutable commit diff");
  return diff;
}
