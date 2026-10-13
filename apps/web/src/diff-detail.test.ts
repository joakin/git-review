import { expect, test } from "bun:test";
import { decorateDiffTokens } from "./diff-detail.ts";

test("word decoration preserves selectable source text and syntax roles", () => {
  const parts = decorateDiffTokens(
    [
      { text: "const ", role: "keyword" },
      { text: "value = 42;", role: "plain" },
    ],
    { kind: "word_change", spans: [{ start: 14, end: 16 }] },
  );
  expect(parts.map((part) => part.text).join("")).toBe("const value = 42;");
  expect(parts.filter((part) => part.changed)).toEqual([
    { text: "42", role: "plain", changed: true },
  ]);
  expect(parts[0]).toEqual({ text: "const ", role: "keyword", changed: false });
});
