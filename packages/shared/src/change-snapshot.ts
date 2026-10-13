import { expectRecord } from "./validation.ts";

export type ChangeSnapshot = { revision: string; changeToken: string };

export function isChangeSnapshotToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{20}$/.test(value);
}

export function parseChangeSnapshot(value: unknown): ChangeSnapshot {
  const snapshot = expectRecord(value, "change snapshot");
  const revision = snapshot["revision"];
  const changeToken = snapshot["changeToken"];
  if (!isChangeSnapshotToken(revision)) throw new Error("Expected a valid status revision");
  if (!isChangeSnapshotToken(changeToken)) throw new Error("Expected a valid change token");
  return { revision, changeToken };
}
