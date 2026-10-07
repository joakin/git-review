import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testGit, withTempDirectory, projectRequestUrl } from "../test-support.ts";
import { parseDiffResponse, type DiffResult } from "../shared/api.ts";
import {
  contextGaps,
  parseDiffContextRequest,
  parseDiffContextResponse,
  type DiffContextRequest,
} from "../shared/diff-context.ts";
import { diffContextContent, contextLines } from "./diff-context-content.ts";
import { parseGitPatch } from "./diff-content.ts";
import { readProjectDiff } from "./git-diff.ts";
import { readProjectStatus } from "./git-status.ts";
import { approveRoot, resolveProject } from "./paths.ts";
import { createApiHandler } from "./api.ts";

function text(diff: DiffResult) {
  if (diff.kind !== "text") throw new Error("Expected fixture text diff");
  return diff;
}

test("context validates exact source, shifted gaps, zero-count boundaries and side neighbors", () => {
  const insertion = text(parseGitPatch(Buffer.from("@@ -2,0 +3,1 @@\n+inserted\n")));
  const content = diffContextContent(insertion, "a\r\nb\r\nc\r\nd", "a\r\nb\r\ninserted\nc\r\nd");
  expect(content.metadata.gaps).toEqual([
    { id: 0, oldStart: 1, newStart: 1, count: 2 },
    { id: 1, oldStart: 3, newStart: 4, count: 2 },
  ]);
  const rows = contextLines(content, 1, 0, 2);
  expect(rows[0]?.neighbors).toEqual({
    old: { kind: "available", before: "b\r", after: "d" },
    new: { kind: "available", before: "inserted", after: "d" },
  });
  expect(rows[1]?.noNewlineAtEnd).toBe(true);
  expect(() =>
    diffContextContent(insertion, "a\r\nb\r\nc\r\nd", "a\r\nb\r\nwrong\nc\r\nd"),
  ).toThrow();
  expect(() => diffContextContent(insertion, "a\nb\nc\nd", "a\r\nb\r\ninserted\nc\r\nd")).toThrow();
  const deletion = text(parseGitPatch(Buffer.from("@@ -3,1 +2,0 @@\n-gone\n")));
  expect(diffContextContent(deletion, "a\nb\ngone\nc\n", "a\nb\nc\n").metadata.gaps).toEqual([
    { id: 0, oldStart: 1, newStart: 1, count: 2 },
    { id: 1, oldStart: 4, newStart: 3, count: 1 },
  ]);
  expect(() => contextGaps(insertion.hunks, 1, 1)).toThrow();
});

test("Changes context expands independently from both ends, checks fresh anchors, and rejects stale or invalid requests", async () => {
  await withTempDirectory("git-review-context-", async (directory) => {
    testGit(directory, "init", "-q");
    const path = "odd [1].ts";
    const base = Array.from(
      { length: 120 },
      (_, index) => `const value${index + 1} = ${index + 1};`,
    );
    await writeFile(join(directory, path), base.join("\n") + "\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    const index = base.map((line, i) =>
      i === 24 || i === 89 ? line.replace(" = ", " = 100 + ") : line,
    );
    index.splice(25, 0, "const insertedA = 1;", "const insertedB = 2;");
    await writeFile(join(directory, path), index.join("\n") + "\n");
    testGit(directory, "add", ".");
    await writeFile(
      join(directory, path),
      index.map((line, i) => (i === 66 ? line.replace(" = ", " = 200 + ") : line)).join("\n") +
        "\n",
    );
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    if (status.kind !== "git") throw new Error("Expected Git fixture");
    const entry = status.entries.find((entry) => entry.layer === "staged");
    if (entry === undefined) throw new Error("Missing staged fixture");
    const diff = text(parseDiffResponse(await readProjectDiff(root, project, entry, "text")));
    if (diff.context?.kind !== "available") throw new Error("Missing context capability");
    const gap = diff.context.gaps.find((gap) => gap.id === 1);
    if (gap === undefined) throw new Error("Missing internal gap");
    expect(gap).toEqual({ id: 1, oldStart: 29, newStart: 31, count: 58 });
    const handle = createApiHandler(root);
    const post = (body: unknown) =>
      handle(
        new Request(
          projectRequestUrl("http://localhost/api/project/diff-context", project.absolutePath),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
      );
    const common = {
      revision: status.revision,
      changeToken: status.changeToken,
      layer: entry.layer,
      path,
      language: "typescript",
    };
    let up = 0;
    let down = 0;
    const revealed = new Set<number>();
    for (const direction of ["down", "up", "down"] as const) {
      const request: DiffContextRequest = {
        ...common,
        kind: "expand",
        source: diff.context.source,
        gap: gap.id,
        up,
        down,
        direction,
      };
      const result = parseDiffContextResponse(await (await post(request)).json(), request, gap);
      if (result.kind !== "expanded") throw new Error("Expected expansion");
      expect(result.lines.length).toBe(Math.min(20, gap.count - up - down));
      for (const line of result.lines) {
        expect(revealed.has(line.newLine)).toBe(false);
        revealed.add(line.newLine);
        const expected = index[line.newLine - 1];
        if (expected === undefined) throw new Error("Missing expected source line");
        expect(line.text).toBe(expected);
        expect(line.tokens.map((token) => token.text).join("")).toBe(line.text);
        expect(line.tokens.some((token) => token.role === "keyword")).toBe(true);
      }
      if (direction === "up") up += result.lines.length;
      else down += result.lines.length;
      if (direction === "down" && down === 20) {
        const row = result.lines[0];
        if (row === undefined || row.neighbors.new.kind !== "available")
          throw new Error("Missing source neighbors");
        const anchor = {
          side: "new" as const,
          line: row.newLine,
          sourceText: row.text,
          before: row.neighbors.new.before,
          after: row.neighbors.new.after,
        };
        const check: DiffContextRequest = {
          ...common,
          kind: "check",
          anchors: [anchor, { ...anchor, before: "wrong" }],
        };
        expect(parseDiffContextResponse(await (await post(check)).json(), check, null)).toEqual({
          kind: "checked",
          matches: [true, false],
        });
      }
    }
    expect(revealed.size).toBe(58);
    expect(
      (
        await post({
          ...common,
          kind: "expand",
          source: diff.context.source,
          gap: gap.id,
          up,
          down,
          direction: "down",
        })
      ).status,
    ).toBe(400);
    const valid = {
      ...common,
      kind: "expand",
      source: diff.context.source,
      gap: gap.id,
      up: 0,
      down: 0,
      direction: "up",
    };
    for (const invalid of [
      { ...valid, direction: "left" },
      { ...valid, up: -1 },
      { ...valid, up: Number.MAX_SAFE_INTEGER },
      { ...valid, language: "invalid" },
      { ...valid, extra: true },
      { ...valid, path: "../outside" },
    ])
      expect((await post(invalid)).status).not.toBe(200);
    expect(await (await post({ ...valid, source: "0".repeat(64) })).json()).toEqual({
      kind: "stale",
    });
    const altered = { ...valid, layer: "unstaged" };
    expect(await (await post(altered)).json()).toEqual({ kind: "stale" });
    await writeFile(join(directory, path), index.join("\n") + "\nchanged\n");
    expect(await (await post(valid)).json()).toEqual({ kind: "stale" });
  });
});

test("large source capability falls back without losing a small patch or imposing a source line count gate", async () => {
  await withTempDirectory("git-review-context-limits-", async (directory) => {
    testGit(directory, "init", "-q");
    const large =
      Array.from({ length: 16000 }, (_, i) => `${i} ${"x".repeat(75)}`).join("\n") + "\n";
    const many = "a\n".repeat(21000);
    await writeFile(join(directory, "large.txt"), large);
    await writeFile(join(directory, "many.txt"), many);
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await writeFile(join(directory, "large.txt"), large.replace("8000 ", "EDIT "));
    await writeFile(join(directory, "many.txt"), "b\n" + many.slice(2));
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    if (status.kind !== "git") throw new Error("Expected Git fixture");
    for (const entry of status.entries) {
      const diff = text(await readProjectDiff(root, project, entry, "text"));
      expect(diff.hunks.length).toBe(1);
      if (entry.path === "large.txt")
        expect(diff.context).toEqual({ kind: "unavailable", reason: "limit" });
      else {
        expect(diff.context?.kind).toBe("available");
        if (diff.context?.kind === "available") expect(diff.context.newLines).toBe(21000);
      }
    }
  });
});

test("source anchor checks remain available when the ordinary patch exceeds its display budget", async () => {
  await withTempDirectory("git-review-context-anchor-budget-", async (directory) => {
    testGit(directory, "init", "-q");
    const lines = Array.from({ length: 20_005 }, (_, i) => `original ${i}`);
    await writeFile(join(directory, "many.txt"), lines.join("\n") + "\n");
    testGit(directory, "add", ".");
    testGit(directory, "commit", "-qm", "base");
    await writeFile(
      join(directory, "many.txt"),
      lines.map((line, i) => (i < 2 ? line : `changed ${i}`)).join("\n") + "\n",
    );
    const root = await approveRoot(directory);
    const project = await resolveProject(root, root.realPath);
    const status = await readProjectStatus(project.absolutePath);
    if (status.kind !== "git") throw new Error("Expected Git fixture");
    const entry = status.entries[0];
    if (entry === undefined) throw new Error("Missing fixture entry");
    expect((await readProjectDiff(root, project, entry, "text")).kind).toBe("too_large");
    const request: DiffContextRequest = {
      kind: "check",
      revision: status.revision,
      changeToken: status.changeToken,
      layer: entry.layer,
      path: entry.path,
      language: "text",
      anchors: [
        { side: "new", line: 1, sourceText: "original 0", before: null, after: "original 1" },
      ],
    };
    const response = await createApiHandler(root)(
      new Request(
        projectRequestUrl("http://localhost/api/project/diff-context", project.absolutePath),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    );
    expect(parseDiffContextResponse(await response.json(), request, null)).toEqual({
      kind: "checked",
      matches: [true],
    });
  });
});

test("context boundaries reject malformed metadata, response coordinates and oversized anchor input", () => {
  const patch = text(parseGitPatch(Buffer.from("@@ -2 +2 @@\n-old\n+new\n")));
  const content = diffContextContent(patch, "a\nold\nc\n", "a\nnew\nc\n");
  expect(() =>
    parseDiffResponse({ ...patch, context: { ...content.metadata, gaps: [] } }),
  ).toThrow();
  const gap = content.metadata.gaps[0];
  if (gap === undefined) throw new Error("Missing prefix");
  const request = parseDiffContextRequest({
    kind: "expand",
    revision: "a".repeat(20),
    changeToken: "b".repeat(20),
    layer: "unstaged",
    path: "x",
    language: "text",
    source: content.metadata.source,
    gap: 0,
    up: 0,
    down: 0,
    direction: "up",
  });
  const response = {
    kind: "expanded",
    source: content.metadata.source,
    gap: 0,
    offset: 0,
    lines: contextLines(content, 0, 0, 1),
  };
  expect(parseDiffContextResponse(response, request, gap).kind).toBe("expanded");
  expect(() =>
    parseDiffContextResponse(
      { ...response, lines: response.lines.map((line) => ({ ...line, newLine: 8 })) },
      request,
      gap,
    ),
  ).toThrow();
  expect(() =>
    parseDiffContextRequest({
      kind: "check",
      revision: "a".repeat(20),
      changeToken: "b".repeat(20),
      layer: "unstaged",
      path: "x",
      language: "text",
      anchors: [{ side: "new", line: 1, sourceText: "x".repeat(20001), before: null, after: null }],
    }),
  ).toThrow();
});
