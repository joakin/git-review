import { expect, test } from "bun:test";
import { selectionComment } from "./code-selection-target.ts";
import { anchorForFileLine } from "./comments.ts";
import { maxFeedbackRangeLines, maxFeedbackRangeText } from "../shared/feedback-check.ts";

function rows(texts: string[]) {
  const lines = texts.map((text, index) => ({ number: index + 1, text, tokens: [] }));
  return texts.map((text, index) => ({
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
  expect(selectionComment([{ text: "first", anchor: null }, last], 0, 4)?.kind).toBe("unavailable");
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
