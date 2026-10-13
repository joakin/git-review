import { describe, expect, test } from "bun:test";
import {
  parseDiffResponse,
  parseFileReadResponse,
  parseSearchResponse,
  type DiffLine,
  type SyntaxRole,
  type SyntaxToken,
} from "./api.ts";

test("Search responses contain normalized, browser-safe literal queries", () => {
  for (const query of ["term�", "a+b ?#%", "café🦊", "x".repeat(128), "🦊".repeat(64)]) {
    const response = { query, matches: [], truncated: false };
    expect(parseSearchResponse(response)).toEqual(response);
  }
  for (const query of [
    null,
    "",
    " \t",
    " padded ",
    "a\nb",
    "a\rb",
    "a\0b",
    "x".repeat(129),
    "🦊".repeat(65),
    "a\ud800",
    "\udc00b",
  ]) {
    expect(() => parseSearchResponse({ query, matches: [], truncated: false })).toThrow();
  }
});

type RawLine = { text: string; tokens: unknown };
const plain = { kind: "plain", reason: "selected" };
const roles: SyntaxRole[] = [
  "plain",
  "comment",
  "keyword",
  "string",
  "number",
  "type",
  "function",
  "variable",
  "property",
  "operator",
  "punctuation",
  "tag",
  "attribute",
];
const boundaries = [
  {
    name: "Files",
    parse: parseFileReadResponse,
    response: (syntax: unknown, lines: RawLine[]) => ({
      kind: "text",
      path: "src/example.ts",
      byteLength: Buffer.byteLength(lines.map((line) => line.text).join("\n")),
      syntax,
      lines: lines.map((line, index) => ({ number: index + 1, ...line })),
    }),
  },
  {
    name: "diff",
    parse: parseDiffResponse,
    response: (syntax: unknown, lines: RawLine[]) => ({
      kind: "text",
      syntax,
      hunks: lines.map((line, index) => ({
        oldStart: 0,
        oldCount: 0,
        newStart: index + 1,
        newCount: 1,
        lines: [
          {
            kind: "added",
            oldLine: null,
            newLine: index + 1,
            ...line,
            detail: { kind: "none" },
            noNewlineAtEnd: false,
          },
        ],
      })),
    }),
  },
];

function tokenSequence(count: number): SyntaxToken[] {
  return Array.from({ length: count }, () => ({ text: "x", role: "plain" }));
}

for (const boundary of boundaries) {
  describe(`${boundary.name} syntax response boundary`, () => {
    const response = (syntax: unknown, tokens: unknown, text = "x") =>
      boundary.response(syntax, [{ text, tokens }]);

    test("accepts the supported syntax states and every token role", () => {
      const tokens = roles.map((role) => ({ text: `${role}\t`, role }));
      const source = tokens.map((token) => token.text).join("");
      const states = [
        { kind: "highlighted", language: "c" },
        { kind: "highlighted", language: "x".repeat(80) },
        ...["unknown_language", "selected", "unavailable"].map((reason) => ({
          kind: "plain",
          reason,
        })),
      ];
      for (const syntax of states) {
        const input = response(syntax, tokens, source);
        expect<unknown>(boundary.parse(input)).toEqual(input);
      }
    });

    test("rejects malformed syntax variants, languages and plain reasons", () => {
      const invalid = [
        undefined,
        null,
        [],
        "plain",
        {},
        { kind: "unknown" },
        { kind: "highlighted" },
        { kind: "highlighted", language: 1 },
        { kind: "highlighted", language: "" },
        { kind: "highlighted", language: "x".repeat(81) },
        { kind: "plain" },
        { kind: "plain", reason: "disabled" },
        { kind: "plain", reason: null },
      ];
      for (const syntax of invalid)
        expect(() => boundary.parse(response(syntax, [{ text: "x", role: "plain" }]))).toThrow();
    });

    test("preserves empty, whitespace, Unicode and CRLF source exactly", () => {
      for (const source of ["", "\t \r", "a🙂é\r"]) {
        const tokens =
          source === ""
            ? []
            : [
                { text: source.slice(0, 1), role: "keyword" },
                { text: source.slice(1), role: "plain" },
              ];
        const input = response(plain, tokens, source);
        expect<unknown>(boundary.parse(input)).toEqual(input);
      }
    });

    test("rejects malformed token collections, records, text and roles", () => {
      const invalid = [
        undefined,
        null,
        {},
        "x",
        [null],
        [[]],
        [{}],
        [{ text: 1, role: "plain" }],
        [{ text: "x" }],
        [{ text: "x", role: "unknown" }],
        [{ text: "x", role: null }],
      ];
      for (const tokens of invalid) expect(() => boundary.parse(response(plain, tokens))).toThrow();
    });

    test("rejects missing text and any token/source normalization", () => {
      const cases = [
        { source: "x", tokens: [] },
        { source: " x", tokens: [{ text: "x", role: "plain" }] },
        { source: "a\r", tokens: [{ text: "a", role: "plain" }] },
        { source: "é", tokens: [{ text: "e\u0301", role: "plain" }] },
      ];
      for (const item of cases)
        expect(() => boundary.parse(response(plain, item.tokens, item.source))).toThrow(
          "Syntax tokens do not match their source line",
        );
    });

    test("accepts 20,000 tokens per line and rejects one more", () => {
      const tokens = tokenSequence(20_000);
      const input = response(plain, tokens, "x".repeat(tokens.length));
      expect<unknown>(boundary.parse(input)).toEqual(input);
      expect(() =>
        boundary.parse(
          response(plain, [...tokens, { text: "x", role: "plain" }], "x".repeat(20_001)),
        ),
      ).toThrow("Expected bounded syntax tokens");
    });

    test("accepts 100,000 tokens across lines and rejects one more", () => {
      const lines = Array.from({ length: 5 }, () => ({
        text: "x".repeat(20_000),
        tokens: tokenSequence(20_000),
      }));
      const input = boundary.response(plain, lines);
      expect<unknown>(boundary.parse(input)).toEqual(input);
      expect(() =>
        boundary.parse(
          boundary.response(plain, [
            ...lines,
            { text: "x", tokens: [{ text: "x", role: "plain" }] },
          ]),
        ),
      ).toThrow(
        boundary.name === "Files"
          ? "Expected bounded file syntax tokens"
          : "Expected bounded syntax tokens",
      );
    });
  });
}

test("diff aggregate token overflow rejects before parsing another token batch", () => {
  const diff = boundaries.find((boundary) => boundary.name === "diff");
  if (diff === undefined) throw new Error("Missing diff boundary fixture");
  const lines = Array.from({ length: 5 }, () => ({
    text: "x".repeat(20_000),
    tokens: tokenSequence(20_000),
  }));
  expect(() =>
    parseDiffResponse(
      diff.response(plain, [...lines, { text: "x", tokens: [{ text: 1, role: "plain" }] }]),
    ),
  ).toThrow("Expected bounded syntax tokens");
});

test("diff syntax validation preserves side, newline, word-span and hunk guards", () => {
  const line: DiffLine = {
    kind: "removed",
    oldLine: 1,
    newLine: null,
    text: "a🙂z\r",
    tokens: [{ text: "a🙂z\r", role: "plain" }],
    detail: { kind: "word_change", spans: [{ start: 1, end: 3 }] },
    noNewlineAtEnd: true,
  };
  const response = (rawLine: unknown, oldCount = 1, newCount = 0) => ({
    kind: "text",
    syntax: plain,
    hunks: [{ oldStart: 1, oldCount, newStart: 0, newCount, lines: [rawLine] }],
  });
  const input = response(line);
  expect<unknown>(parseDiffResponse(input)).toEqual(input);
  const invalid = [
    { ...line, oldLine: 0 },
    { ...line, newLine: 1 },
    { ...line, noNewlineAtEnd: "yes" },
    { ...line, detail: { kind: "word_change", spans: [{ start: 2, end: 3 }] } },
    {
      ...line,
      detail: {
        kind: "word_change",
        spans: [
          { start: 0, end: 3 },
          { start: 1, end: 4 },
        ],
      },
    },
  ];
  for (const malformed of invalid) expect(() => parseDiffResponse(response(malformed))).toThrow();
  expect(() => parseDiffResponse(response({ ...line, kind: "context", newLine: 1 }, 1, 1))).toThrow(
    "Expected a diff detail kind",
  );
  expect(() => parseDiffResponse(response(line, 0))).toThrow(
    "Diff hunk counts do not match its lines",
  );
});
