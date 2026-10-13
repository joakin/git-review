import { expect, test } from "bun:test";
import { selectionComment, type SelectionSourceRow } from "./code-selection-target.ts";
import { anchorForFileLine } from "./comments.ts";
import { maxFeedbackRangeLines, maxFeedbackRangeText } from "@git-review/shared/feedback-check";

function rows(texts: string[]): Extract<SelectionSourceRow, { kind: "file" }>[] {
  const lines = texts.map((text, index) => ({ number: index + 1, text, tokens: [] }));
  return texts.map((text, index) => ({
    kind: "file",
    text,
    anchor: anchorForFileLine("src/test.ts", lines, index),
  }));
}

test("a file fragment keeps partial endpoints, blank lines, repeated text and Unicode exact", () => {
  const source = rows(["repeat 🦊 repeat", "", "\tfinish repeat"]);
  const result = selectionComment(source, 7, 8);
  expect(result?.kind).toBe("target");
  if (result?.kind !== "target") throw new Error("Expected target");
  expect(result.target.subject).toEqual({
    kind: "range",
    parts: [
      {
        anchors: source.map((row) => {
          if (row.anchor === null) throw new Error("Missing fixture anchor");
          return row.anchor;
        }),
        start: 7,
        end: 26,
        text: "🦊 repeat\n\n\tfinish ",
      },
    ],
  });
  expect(selectionComment(source, 8, 8)?.kind).toBe("unavailable");
});

test("range capture rejects source gaps, mixed files and unavailable lines", () => {
  const source = rows(["first", "middle", "last"]);
  const last = source[2];
  const first = source[0];
  if (last?.anchor === null || last === undefined || first === undefined)
    throw new Error("Missing anchor");
  expect(selectionComment([first, last], 0, 4)?.kind).toBe("unavailable");
  expect(
    selectionComment([first, { ...last, anchor: { ...last.anchor, path: "other.ts" } }], 0, 4)
      ?.kind,
  ).toBe("unavailable");
  expect(selectionComment([{ kind: "file", text: "first", anchor: null }, last], 0, 4)?.kind).toBe(
    "unavailable",
  );
  expect(selectionComment(rows(["  ", "\t"]), 0, 1)).toBeNull();
});

test("selection limits cover full saved source, not only the endpoint fragment", () => {
  expect(
    selectionComment(rows(Array.from({ length: maxFeedbackRangeLines }, () => "x")), 0, 1)?.kind,
  ).toBe("target");
  expect(
    selectionComment(rows(Array.from({ length: maxFeedbackRangeLines + 1 }, () => "x")), 0, 1)
      ?.kind,
  ).toBe("unavailable");
  expect(
    selectionComment(
      rows(["a".repeat(maxFeedbackRangeText / 2), "b".repeat(maxFeedbackRangeText / 2)]),
      19999,
      1,
    )?.kind,
  ).toBe("unavailable");
  expect(selectionComment(rows(["repeat repeat"]), 7, 13)?.kind).toBe("target");
});

function diffRows(preferOld = false): Extract<SelectionSourceRow, { kind: "diff" }>[] {
  const lines: [number | null, number | null, "context" | "removed" | "added", string][] = [
    [7, 11, "context", "shared start"],
    [8, null, "removed", "old first"],
    [9, null, "removed", "old last"],
    [null, 12, "added", "new first"],
    [null, 13, "added", ""],
    [null, 14, "added", "new last"],
    [10, 15, "context", "shared finish"],
    [11, 16, "context", "shared end"],
  ];
  return lines.map(([oldLine, newLine, lineKind, text]) => {
    const anchor = (side: "old" | "new", line: number | null) =>
      line === null
        ? null
        : {
            kind: "diff" as const,
            layer: "unstaged" as const,
            side,
            path: "example.ts",
            line,
            sourceText: text,
            before: null,
            after: null,
          };
    const anchors = { old: anchor("old", oldLine), new: anchor("new", newLine) };
    return {
      kind: "diff",
      lineKind,
      text,
      anchors,
      preferredSide:
        lineKind === "removed" || (lineKind === "context" && preferOld) ? "old" : "new",
      anchor:
        anchors[lineKind === "removed" || (lineKind === "context" && preferOld) ? "old" : "new"],
    };
  });
}
function parts(result: ReturnType<typeof selectionComment>) {
  if (result?.kind !== "target" || result.target.subject.kind !== "range")
    throw new Error("Expected range");
  return result.target.subject.parts;
}

test("diff ranges resolve removed/context to Old and added/context to New", () => {
  const old = parts(selectionComment(diffRows().slice(0, 3), 2, 4));
  expect(old.length).toBe(1);
  expect(
    old[0]?.anchors.map((anchor) => [anchor.kind === "diff" ? anchor.side : null, anchor.line]),
  ).toEqual([
    ["old", 7],
    ["old", 8],
    ["old", 9],
  ]);
  expect(old[0]?.text).toBe("ared start\nold first\nold ");
  const next = parts(selectionComment(diffRows(true).slice(3), 2, 5));
  expect(
    next[0]?.anchors.map((anchor) => [anchor.kind === "diff" ? anchor.side : null, anchor.line]),
  ).toEqual([
    ["new", 12],
    ["new", 13],
    ["new", 14],
    ["new", 15],
    ["new", 16],
  ]);
  expect(next[0]?.text).toBe("w first\n\nnew last\nshared finish\nshare");
  expect(parts(selectionComment(diffRows().slice(6), 0, 5))[0]?.anchors[0]).toMatchObject({
    side: "new",
    line: 15,
  });
  expect(parts(selectionComment(diffRows(true).slice(6), 0, 5))[0]?.anchors[0]).toMatchObject({
    side: "old",
    line: 10,
  });
});

test("mixed diff fragments preserve context on both sides with independent partial endpoints", () => {
  const mixed = parts(selectionComment(diffRows(), 2, 5));
  expect(mixed.length).toBe(2);
  expect(mixed[0]?.text).toBe("ared start\nold first\nold last\nshared finish\nshare");
  expect(mixed[1]?.text).toBe("ared start\nnew first\n\nnew last\nshared finish\nshare");
  const inner = parts(selectionComment(diffRows().slice(1, 6), 4, 3));
  expect(inner[0]?.text).toBe("first\nold last");
  expect(inner[1]?.text).toBe("new first\n\nnew");
});

test("diff gaps, cross-layer sources, missing side anchors and doubled context limits reject", () => {
  const source = diffRows();
  const first = source[0];
  const last = source[7];
  if (first === undefined || last === undefined || last.anchors.new === null)
    throw new Error("Missing source");
  expect(selectionComment([first, last], 0, 5)?.kind).toBe("unavailable");
  expect(
    selectionComment(
      [
        first,
        {
          ...last,
          anchors: { ...last.anchors, new: { ...last.anchors.new, line: 12, layer: "staged" } },
        },
      ],
      0,
      5,
    )?.kind,
  ).toBe("unavailable");
  expect(
    selectionComment([{ ...first, anchors: { old: null, new: null } }, ...source.slice(1, 3)], 0, 5)
      ?.kind,
  ).toBe("unavailable");
  const many = Array.from(
    { length: 101 },
    (_, index): Extract<SelectionSourceRow, { kind: "diff" }> => {
      const kind = index === 50 ? "removed" : index === 51 ? "added" : "context";
      const line = index + 1;
      const base = {
        kind: "diff" as const,
        layer: "unstaged" as const,
        path: "example.ts",
        line,
        sourceText: "x",
        before: null,
        after: null,
      };
      const old =
        kind === "added"
          ? null
          : { ...base, side: "old" as const, line: index < 51 ? line : line - 1 };
      const next =
        kind === "removed"
          ? null
          : { ...base, side: "new" as const, line: index < 51 ? line : line - 1 };
      return {
        kind: "diff",
        text: "x",
        lineKind: kind,
        anchor: old ?? next,
        anchors: { old, new: next },
        preferredSide: kind === "removed" ? "old" : "new",
      };
    },
  );
  expect(selectionComment(many, 0, 1)?.kind).toBe("target");
  const extra = many.at(-1);
  if (extra === undefined || extra.anchors.old === null || extra.anchors.new === null)
    throw new Error("Missing tail");
  many.push({
    ...extra,
    anchors: { old: { ...extra.anchors.old, line: 101 }, new: { ...extra.anchors.new, line: 101 } },
  });
  expect(selectionComment(many, 0, 1)?.kind).toBe("unavailable");
});

test("Old context preference survives an unavailable first Old anchor instead of silently choosing New", () => {
  const rows = diffRows(true).slice(6);
  const first = rows[0];
  if (first === undefined) throw new Error("Missing context");
  rows[0] = { ...first, anchor: null, anchors: { ...first.anchors, old: null } };
  expect(selectionComment(rows, 0, 5)?.kind).toBe("unavailable");
});
