import { gitPath } from "../shared/git.ts";
import { expectNonNegativeInteger } from "../shared/validation.ts";
import type { ChangeLineStats } from "../shared/api.ts";

type NumericRecord = {
  oldPath: string | null;
  path: string;
  stats: Extract<ChangeLineStats, { kind: "text" | "binary" }>;
  nextIndex: number;
};

/** One NUL-delimited numeric record; rename paths occupy two following records. */
export function readNumstatRecord(records: readonly string[], index: number): NumericRecord {
  const match = /^(0|[1-9][0-9]*|-)\t(0|[1-9][0-9]*|-)\t([\s\S]*)$/.exec(records[index] ?? "");
  if (match === null) throw new Error("Invalid Git numeric stat record");
  const added = match[1];
  const deleted = match[2];
  const name = match[3];
  if (
    added === undefined ||
    deleted === undefined ||
    name === undefined ||
    (added === "-") !== (deleted === "-")
  )
    throw new Error("Invalid Git numeric counts");
  const oldPath = name === "" ? gitPath(records[++index]) : null;
  const path = name === "" ? gitPath(records[++index]) : gitPath(name);
  const stats: NumericRecord["stats"] =
    added === "-"
      ? { kind: "binary" }
      : {
          kind: "text",
          added: expectNonNegativeInteger(Number(added), "added lines"),
          deleted: expectNonNegativeInteger(Number(deleted), "deleted lines"),
        };
  return { oldPath, path, stats, nextIndex: index + 1 };
}
