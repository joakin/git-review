import type { ReviewChangeEntry } from "./api.ts";
import { expectNonNegativeInteger } from "./validation.ts";

/** Known text totals remain explicit when other entries cannot contribute line counts. */
export function summarizeChangeStats(entries: readonly ReviewChangeEntry[]) {
  let added = 0,
    deleted = 0,
    textFiles = 0,
    binaryFiles = 0,
    nonTextFiles = 0,
    unavailableFiles = 0;
  for (const { stats } of entries) {
    switch (stats.kind) {
      case "text":
        added += stats.added;
        deleted += stats.deleted;
        textFiles += 1;
        break;
      case "binary":
        binaryFiles += 1;
        break;
      case "not_applicable":
        nonTextFiles += 1;
        break;
      case "unavailable":
        unavailableFiles += 1;
        break;
    }
  }
  return {
    added: expectNonNegativeInteger(added, "total added lines"),
    deleted: expectNonNegativeInteger(deleted, "total deleted lines"),
    textFiles,
    binaryFiles,
    nonTextFiles,
    unavailableFiles,
  };
}

export function validateChangeGroupTotals(entries: readonly ReviewChangeEntry[]): void {
  for (const layer of ["staged", "unstaged", "untracked", "conflict"] as const)
    summarizeChangeStats(entries.filter((entry) => entry.layer === layer));
}
