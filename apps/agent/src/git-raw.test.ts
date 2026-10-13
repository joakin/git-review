import { expect, test } from "bun:test";
import { readRawRecord } from "./git-raw.ts";

test("raw records retain literal names, full object formats and one-path boundaries", () => {
  const path = ":odd\tname\n[1]\\.txt";
  for (const length of [40, 64]) {
    const oid = "a".repeat(length);
    const zero = "0".repeat(length);
    for (const mode of ["000000", "100644", "100755", "120000", "160000"] as const) {
      for (const status of ["A", "M", "D", "T", "U"] as const) {
        const records = ["earlier", `:${mode} 100644 ${oid} ${zero} ${status}`, path, "later"];
        expect(readRawRecord(records, 1)).toEqual({
          old: { mode, oid, path },
          new: { mode: "100644", oid: zero, path },
          status,
          nextIndex: 3,
        });
      }
    }
  }
});

test("rename and copy records retain both paths and bounded scores", () => {
  const oid = "b".repeat(64);
  for (const status of ["R", "C"] as const) {
    for (const score of ["0", "000", "1", "99", "100"]) {
      expect(
        readRawRecord(
          [`:100644 100755 ${oid} ${oid} ${status}${score}`, "old\nname", "new\tname", "later"],
          0,
        ),
      ).toEqual({
        old: { mode: "100644", oid, path: "old\nname" },
        new: { mode: "100755", oid, path: "new\tname" },
        status,
        score: Number(score),
        nextIndex: 3,
      });
    }
  }
});

test("raw records reject malformed modes, full IDs, statuses, scores and incomplete paths", () => {
  const oid = "a".repeat(40);
  const header = `:100644 100644 ${oid} ${oid} M`;
  for (const invalid of [
    header.slice(1),
    header.replace(":100644", ":100600"),
    header.replace(" 100644 ", " 100600 "),
    header.replace(":100644", ":10644"),
    header.replace(`${oid} ${oid}`, `${oid.slice(1)} ${oid}`),
    header.replace(`${oid} ${oid}`, `${oid} ${oid.slice(1)}`),
    header.replace(`${oid} ${oid}`, `${oid} ${"b".repeat(64)}`),
    header.replace(oid, oid.toUpperCase()),
    ...["X", "R", "C", "R-1", "CNaN", "R101", "C101", "R1000", "C1000"].map(
      (status) => header.slice(0, -1) + status,
    ),
  ])
    expect(() => readRawRecord([invalid, "file", "new"], 0)).toThrow();
  for (const records of [
    [],
    [header],
    [header, ""],
    [header, "/absolute"],
    [header, "../escape"],
    [header, "sub/.git/config"],
    [header, "sub\0file"],
    [header, "x".repeat(4097)],
    [header.slice(0, -1) + "R100", "old"],
    [header.slice(0, -1) + "C100", "old", ""],
    [header.slice(0, -1) + "R100", "../old", "new"],
    [header.slice(0, -1) + "C100", "old", "../new"],
  ])
    expect(() => readRawRecord(records, 0)).toThrow();
});
