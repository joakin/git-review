import { expect, test } from "bun:test";
import type { DiffResult } from "@git-review/shared/api";
import {
  contextStep,
  maxContextBodyBytes,
  parseDiffContextRequest,
  type DiffContextLine,
} from "@git-review/shared/diff-context";
import {
  appendContext,
  consumedContext,
  contextDisplayResource,
  emptyContext,
} from "./diff-context-state.ts";
import { anchorForContextLine } from "./diff-context-anchor.ts";
import { checkContextAnchors } from "./diff-context-api.ts";

const diff: Extract<DiffResult, { kind: "text" }> = {
  kind: "text",
  syntax: { kind: "plain", reason: "selected" },
  hunks: [],
};
const gap = { id: 1, oldStart: 10, newStart: 12, count: 41 };
function rows(offset: number, count: number): DiffContextLine[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "context",
    oldLine: gap.oldStart + offset + index,
    newLine: gap.newStart + offset + index,
    text: `line ${offset + index}`,
    tokens: [{ text: `line ${offset + index}`, role: "plain" }],
    detail: { kind: "none" },
    noNewlineAtEnd: false,
    neighbors: {
      old: { kind: "available", before: "old before", after: "old after" },
      new: { kind: "available", before: "new before", after: "new after" },
    },
  }));
}

test("mixed-end context has no overlaps and preserves exact source-side anchors and display ownership", () => {
  const down = appendContext(emptyContext, diff, gap, "down", 0, rows(0, contextStep));
  const both = appendContext(down, diff, gap, "up", 21, rows(21, contextStep));
  expect(consumedContext(both, gap)).toEqual({ up: 20, down: 20, remaining: 1 });
  const full = appendContext(both, diff, gap, "down", 20, rows(20, 1));
  expect(consumedContext(full, gap).remaining).toBe(0);
  expect(() => appendContext(full, diff, gap, "up", 20, rows(20, 1))).toThrow();
  const row = rows(0, 1)[0];
  if (row === undefined) throw new Error("Missing row");
  expect(anchorForContextLine("staged", "x", row, "old")).toMatchObject({
    line: 10,
    before: "old before",
    after: "old after",
  });
  expect(anchorForContextLine("unstaged", "x", row, "new")).toMatchObject({
    line: 12,
    before: "new before",
    after: "new after",
  });
  expect(contextDisplayResource(diff, emptyContext)).toBe(diff);
  expect(contextDisplayResource(diff, both)).toBe(contextDisplayResource(diff, both));
  expect(contextDisplayResource(diff, full)).not.toBe(contextDisplayResource(diff, both));
});

test("fresh context checks split valid long anchors by encoded byte budget and retain result order", async () => {
  const original = globalThis.fetch;
  const counts: number[] = [];
  globalThis.fetch = Object.assign(
    async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (typeof init?.body !== "string") throw new Error("Missing body");
      expect(new TextEncoder().encode(init.body).byteLength).toBeLessThanOrEqual(
        maxContextBodyBytes,
      );
      const request = parseDiffContextRequest(JSON.parse(init.body) as unknown);
      if (request.kind !== "check") throw new Error("Expected check");
      counts.push(request.anchors.length);
      return Response.json({
        kind: "checked",
        matches: request.anchors.map((anchor) => anchor.line % 2 === 0),
      });
    },
    { preconnect: original.preconnect },
  );
  try {
    const text = "\u0001".repeat(20_000);
    const anchors = Array.from({ length: 12 }, (_, index) => ({
      side: "new" as const,
      line: index + 1,
      sourceText: text,
      before: text,
      after: text,
    }));
    const matches = await checkContextAnchors(
      "/repo",
      {
        revision: "a".repeat(20),
        changeToken: "b".repeat(20),
        layer: "unstaged",
        path: "x",
        language: "text",
      },
      anchors,
      new AbortController().signal,
    );
    expect(counts.length).toBeGreaterThan(1);
    expect(matches).toEqual(anchors.map((anchor) => anchor.line % 2 === 0));
  } finally {
    globalThis.fetch = original;
  }
});
