import { expectGitOid, gitPath, type GitFileMode } from "@git-review/shared/git";

export type GitRawSide = { mode: GitFileMode | "000000"; oid: string; path: string };
type RawRecord = {
  old: GitRawSide;
  new: GitRawSide;
  nextIndex: number;
} & ({ status: "A" | "M" | "D" | "T" | "U" } | { status: "R" | "C"; score: number });

function rawMode(value: unknown): GitRawSide["mode"] {
  if (
    value !== "000000" &&
    value !== "100644" &&
    value !== "100755" &&
    value !== "120000" &&
    value !== "160000"
  )
    throw new Error("Invalid Git file mode");
  return value;
}

/** One NUL-delimited raw record; callers retain scope and absent-side policies. */
export function readRawRecord(records: readonly string[], index: number): RawRecord {
  const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDTU]|[RC][0-9]{1,3})$/.exec(
    records[index] ?? "",
  );
  if (match === null) throw new Error("Invalid Git raw diff record");
  const oldMode = rawMode(match[1]);
  const newMode = rawMode(match[2]);
  const oldOid = expectGitOid(match[3]);
  const newOid = expectGitOid(match[4]);
  if (oldOid.length !== newOid.length) throw new Error("Mismatched Git raw object formats");
  const old = { mode: oldMode, oid: oldOid, path: gitPath(records[index + 1]) };
  const status = match[5];
  if (status === undefined) throw new Error("Invalid Git raw status");
  if (status === "A" || status === "M" || status === "D" || status === "T" || status === "U")
    return {
      old,
      new: { mode: newMode, oid: newOid, path: old.path },
      status,
      nextIndex: index + 2,
    };
  const kind = status[0];
  if (kind !== "R" && kind !== "C") throw new Error("Invalid Git raw status");
  const score = Number(status.slice(1));
  if (score > 100) throw new Error("Invalid Git rename score");
  return {
    old,
    new: { mode: newMode, oid: newOid, path: gitPath(records[index + 2]) },
    status: kind,
    score,
    nextIndex: index + 3,
  };
}
