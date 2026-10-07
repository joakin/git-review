import { expect, test } from "bun:test";
import { normalizeSearchQuery } from "./search-query.ts";

test("Search normalization keeps literal text and the existing UTF-16 length bound", () => {
  for (const query of [
    "-word",
    "a+b ?#%",
    "term�",
    "café🦊",
    "a\tb",
    "x".repeat(128),
    "🦊".repeat(64),
  ]) {
    expect(normalizeSearchQuery(query)).toBe(query);
    expect(normalizeSearchQuery(` \t${query}\r\n`)).toBe(query);
  }
});

test("Search rejects empty, multiline, oversized, and unrepresentable input", () => {
  for (const query of [
    null,
    undefined,
    1,
    {},
    "",
    " \t\r\n",
    "a\0b",
    "a\rb",
    "a\nb",
    "x".repeat(129),
    "🦊".repeat(65),
    "a\ud800",
    "\udc00b",
  ]) {
    expect(normalizeSearchQuery(query)).toBeNull();
  }
});
