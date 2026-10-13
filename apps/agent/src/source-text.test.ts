import { expect, test } from "bun:test";
import {
  decodedText,
  maxSourceTextBytes,
  maxSourceTextLines,
  parseSourceText,
} from "./source-text.ts";

test("source limits count UTF-8 bytes and accept the exact byte boundary", () => {
  const source = "é".repeat(maxSourceTextBytes / 2);
  const content = Buffer.from(source);
  expect(content.byteLength).toBe(maxSourceTextBytes);
  expect(decodedText(content)).toBe(source);
  expect(parseSourceText(content)).toEqual({
    kind: "text",
    text: source,
    lineCount: 1,
    hasFinalNewline: false,
  });
  const overflow = Buffer.concat([content, Buffer.from("x")]);
  expect(decodedText(overflow)).toBeNull();
  expect(parseSourceText(overflow)).toEqual({ kind: "too_large" });
});

test("source classification accepts the exact line boundary with or without a final newline", () => {
  for (const ending of ["last", "last\n"]) {
    const source = "row\n".repeat(maxSourceTextLines - 1) + ending;
    expect(parseSourceText(Buffer.from(source))).toEqual({
      kind: "text",
      text: source,
      lineCount: maxSourceTextLines,
      hasFinalNewline: ending.endsWith("\n"),
    });
    const overflow = source + (ending.endsWith("\n") ? "extra\n" : "\nextra");
    expect(parseSourceText(Buffer.from(overflow))).toEqual({ kind: "too_large" });
  }
});

test("classification preserves empty, blank, CRLF and lone-carriage-return source text", () => {
  for (const [source, lineCount, hasFinalNewline] of [
    ["", 0, false],
    ["\n", 1, true],
    ["\n\n", 2, true],
    ["first\nlast", 2, false],
    ["first\nlast\n", 2, true],
    ["first\r\nlast\r\n", 2, true],
    ["first\rlast", 1, false],
  ] as const) {
    expect(decodedText(Buffer.from(source))).toBe(source);
    expect(parseSourceText(Buffer.from(source))).toEqual({
      kind: "text",
      text: source,
      lineCount,
      hasFinalNewline,
    });
  }
  expect(decodedText(Buffer.from("\uFEFFfirst\r\n"))).toBe("first\r\n");
});

test("invalid UTF-8 and NUL bytes cannot become reviewable source", () => {
  for (const content of [Buffer.from([65, 0, 66]), Buffer.from([0xff]), Buffer.from([0xc3])]) {
    expect(decodedText(content)).toBeNull();
    expect(parseSourceText(content)).toEqual({ kind: "binary", reason: "binary" });
  }
});

test("syntax decoding retains complete snapshots beyond the display line limit", () => {
  const source = "\n".repeat(maxSourceTextLines) + "const last = true;\n";
  const content = Buffer.from(source);
  expect(decodedText(content)).toBe(source);
  expect(parseSourceText(content)).toEqual({ kind: "too_large" });
  expect(decodedText(Buffer.from("é"), 2)).toBe("é");
  expect(decodedText(Buffer.from("é"), 1)).toBeNull();
});
