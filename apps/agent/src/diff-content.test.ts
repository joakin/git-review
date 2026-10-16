import { expect, test } from "bun:test";
import { parseDiffResponse, type DiffResult } from "@git-review/shared/api";
import { diffFromContent, parseGitPatch } from "./diff-content.ts";

function textDiff(diff: DiffResult): Extract<DiffResult, { kind: "text" }> {
  if (diff.kind !== "text") throw new Error(`Expected text diff, got ${diff.kind}`);
  return diff;
}

test("malformed Git hunks fail before reaching the UI", () => {
  expect(() => parseGitPatch(Buffer.from("@@ -1 +1 @@\n-old\n"))).toThrow("incomplete hunk");
});

test("diff source lines retain CRLF content", () => {
  const patch = Buffer.from("@@ -1 +1 @@\n-before\r\n+after\r\n");
  const diff = textDiff(parseGitPatch(patch));
  expect(diff.hunks[0]?.lines.map((line) => line.text)).toEqual(["before\r", "after\r"]);
});

test("content diffs keep exact source lines and final-newline anchors on either side", () => {
  for (const [source, expected, noNewline] of [
    ["", [], false],
    ["\n", [""], false],
    ["first\nlast", ["first", "last"], true],
    ["first\r\nlast\r\n", ["first\r", "last\r"], false],
    ["first\rlast", ["first\rlast"], true],
  ] as const) {
    for (const side of ["old", "new"] as const) {
      const diff = textDiff(diffFromContent(Buffer.from(source), side));
      const lines = diff.hunks.flatMap((hunk) => hunk.lines);
      expect(lines.map((line) => line.text)).toEqual([...expected]);
      expect(lines.map((line) => line.oldLine)).toEqual(
        expected.map((_, index) => (side === "old" ? index + 1 : null)),
      );
      expect(lines.map((line) => line.newLine)).toEqual(
        expected.map((_, index) => (side === "new" ? index + 1 : null)),
      );
      expect(lines.map((line) => line.noNewlineAtEnd)).toEqual(
        expected.map((_, index) => noNewline && index === expected.length - 1),
      );
      expect(parseDiffResponse(diff)).toEqual(diff);
    }
  }
});

test("word detail follows clear pairs through a multi-line edit with an inserted row", () => {
  const patch = Buffer.from(
    "@@ -1,4 +1,5 @@\n-const first = old;\n-const second = old;\n-const third = old;\n+const first = fresh;\n+const inserted = true;\n+const second = fresh;\n+const third = fresh;\n unchanged\n",
  );
  const diff = textDiff(parseGitPatch(patch));
  const rows = diff.hunks[0]?.lines ?? [];
  expect(
    rows.map((row) =>
      row.detail.kind === "word_change"
        ? row.detail.spans.map((span) => row.text.slice(span.start, span.end))
        : [],
    ),
  ).toEqual([["old"], ["old"], ["old"], ["fresh"], [], ["fresh"], ["fresh"], []]);
  expect(rows.map((row) => [row.oldLine, row.newLine])).toEqual([
    [1, null],
    [2, null],
    [3, null],
    [null, 1],
    [null, 2],
    [null, 3],
    [null, 4],
    [4, 5],
  ]);
  expect(parseDiffResponse(diff)).toEqual(diff);
});

test("word detail skips ambiguous pairs and keeps clear pairs around a deletion", () => {
  const ambiguous = textDiff(
    parseGitPatch(
      Buffer.from(
        "@@ -1,2 +1,3 @@\n-const itemA = 1;\n-const itemB = 1;\n+const itemC = 2;\n+const itemD = 2;\n+const itemE = 2;\n",
      ),
    ),
  );
  expect(ambiguous.hunks[0]?.lines.every((line) => line.detail.kind === "none")).toBe(true);
  const deleted = textDiff(
    parseGitPatch(
      Buffer.from(
        "@@ -1,3 +1,2 @@\n-const alpha = old;\n-const obsolete = true;\n-const gamma = old;\n+const alpha = fresh;\n+const gamma = fresh;\n",
      ),
    ),
  );
  expect(deleted.hunks[0]?.lines.map((line) => line.detail.kind)).toEqual([
    "word_change",
    "none",
    "word_change",
    "word_change",
    "word_change",
  ]);
});

test("word detail covers a rewritten comment and preserves words reflowed to the next line", () => {
  const diff = textDiff(
    parseGitPatch(
      Buffer.from(
        [
          "@@ -604,2 +612,2 @@",
          "-    // A gap first removes a falling entity from the camera and leash. Reaching",
          "-    // its lower line starts the existing visible return above the viewport.",
          "+    // A gap retains the player's supported height for framing and group limits.",
          "+    // Reaching its lower line starts a visible return above the viewport.",
          "",
        ].join("\n"),
      ),
    ),
  );
  const rows = diff.hunks[0]?.lines ?? [];
  expect(
    rows.map((row) =>
      row.detail.kind === "word_change"
        ? row.detail.spans.map((span) => row.text.slice(span.start, span.end).trim())
        : [],
    ),
  ).toEqual([
    ["first removes a falling entity from", "camera", "leash"],
    ["the existing"],
    ["retains", "player's supported height for framing", "group limits"],
    ["a"],
  ]);
  expect(rows.map((row) => [row.oldLine, row.newLine])).toEqual([
    [604, null],
    [605, null],
    [null, 612],
    [null, 613],
  ]);
  expect(parseDiffResponse(diff)).toEqual(diff);
});

test("comment reflow in either direction does not invent changed words", () => {
  const before = [
    "    // The player remains supported. Reaching",
    "    // its lower edge starts a visible return.",
  ];
  const after = [
    "    // The player remains supported.",
    "    // Reaching its lower edge starts a visible return.",
  ];
  for (const [old, next] of [
    [before, after],
    [after, before],
  ] as const) {
    const diff = textDiff(
      parseGitPatch(
        Buffer.from(
          [
            "@@ -1,2 +1,2 @@",
            ...old.map((line) => `-${line}`),
            ...next.map((line) => `+${line}`),
            "",
          ].join("\n"),
        ),
      ),
    );
    expect(diff.hunks[0]?.lines.map((row) => row.detail)).toEqual([
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
    ]);
    expect(parseDiffResponse(diff)).toEqual(diff);
  }
});

test("an unambiguous neighbor does not force ambiguous repeated rows into word pairs", () => {
  const diff = textDiff(
    parseGitPatch(
      Buffer.from(
        "@@ -1,3 +1,3 @@\n-const itemA = 1;\n-const itemB = 1;\n-const steady = old;\n+const itemC = 2;\n+const itemD = 2;\n+const steady = fresh;\n",
      ),
    ),
  );
  expect(diff.hunks[0]?.lines.map((row) => row.detail.kind)).toEqual([
    "none",
    "none",
    "word_change",
    "none",
    "none",
    "word_change",
  ]);
});

test("large edit blocks retain bounded per-line word detail", () => {
  const source = (value: string): string[] =>
    Array.from(
      { length: 40 },
      (_, index) => `const item${index} = call(first, second, third, fourth, fifth, ${value});`,
    );
  const diff = textDiff(
    parseGitPatch(
      Buffer.from(
        [
          "@@ -1,40 +1,40 @@",
          ...source("old").map((line) => `-${line}`),
          ...source("fresh").map((line) => `+${line}`),
          "",
        ].join("\n"),
      ),
    ),
  );
  const rows = diff.hunks[0]?.lines ?? [];
  expect(rows).toHaveLength(80);
  for (const row of rows) {
    expect(
      row.detail.kind === "word_change" &&
        row.detail.spans.map((span) => row.text.slice(span.start, span.end)),
    ).toEqual([row.kind === "removed" ? "old" : "fresh"]);
  }
  expect(parseDiffResponse(diff)).toEqual(diff);
});

test("word detail includes punctuation and whitespace, and safely skips oversized lines", () => {
  const changed = textDiff(
    parseGitPatch(Buffer.from("@@ -1 +1 @@\n-const value = foo(1);\n+const value  = foo[1];\n")),
  );
  const rows = changed.hunks[0]?.lines ?? [];
  expect(
    rows.map((row) =>
      row.detail.kind === "word_change"
        ? row.detail.spans.map((span) => row.text.slice(span.start, span.end))
        : [],
    ),
  ).toEqual([
    [" ", "(", ")"],
    ["  ", "[", "]"],
  ]);
  const long = textDiff(
    parseGitPatch(Buffer.from(`@@ -1 +1 @@\n-${"a".repeat(4097)}\n+${"b".repeat(4097)}\n`)),
  );
  expect(long.hunks[0]?.lines.map((line) => line.detail)).toEqual([
    { kind: "none" },
    { kind: "none" },
  ]);
  const single = textDiff(parseGitPatch(Buffer.from("@@ -1 +1 @@\n-foo\n+bar\n")));
  expect(single.hunks[0]?.lines.map((line) => line.detail)).toEqual([
    { kind: "word_change", spans: [{ start: 0, end: 3 }] },
    { kind: "word_change", spans: [{ start: 0, end: 3 }] },
  ]);
});

test("word detail offsets are validated at the API boundary", () => {
  const diff = textDiff(parseGitPatch(Buffer.from("@@ -1 +1 @@\n-a😀b\n+a😁b\n")));
  expect(parseDiffResponse(diff)).toEqual(diff);
  const invalid = structuredClone(diff);
  const row = invalid.hunks[0]?.lines[0];
  if (row?.detail.kind !== "word_change") throw new Error("Expected a changed emoji span");
  const span = row.detail.spans[0];
  if (span === undefined) throw new Error("Expected an emoji span");
  span.start = 2;
  expect(() => parseDiffResponse(invalid)).toThrow("valid word-change offsets");
});
