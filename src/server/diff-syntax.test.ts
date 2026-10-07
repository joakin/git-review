import { expect, test } from "bun:test";
import { parseDiffResponse } from "../shared/api.ts";
import { withDiffSyntax } from "./diff-syntax.ts";
import { diffFromContent, parseGitPatch } from "./git-diff.ts";
import { decodedText, maxSourceTextLines, parseSourceText } from "./source-text.ts";

function editedDiff() {
  const diff = parseGitPatch(
    Buffer.from("@@ -1 +1 @@\n-const value = 'before';\n+const value = 'after';\n"),
  );
  if (diff.kind !== "text") throw new Error("Expected a text fixture");
  return diff;
}

test("empty text diffs need no syntax source reads", async () => {
  const diff = diffFromContent(Buffer.alloc(0));
  if (diff.kind !== "text") throw new Error("Expected an empty text fixture");
  let reads = 0;
  const read = async () => {
    reads += 1;
    return "";
  };
  expect(await withDiffSyntax(diff, "empty.ts", null, read, read)).toEqual(diff);
  expect(reads).toBe(0);
});

test("plain selection and unknown language preserve decorated rows without reading sources", async () => {
  const diff = editedDiff();
  const original = structuredClone(diff);
  let reads = 0;
  const read = async () => {
    reads += 1;
    return "";
  };
  const choices = [
    { path: "value.ts", override: "text", reason: "selected" },
    { path: "value.unknown_ext", override: null, reason: "unknown_language" },
  ] satisfies { path: string; override: string | null; reason: "selected" | "unknown_language" }[];
  for (const choice of choices) {
    const result = await withDiffSyntax(diff, choice.path, choice.override, read, read);
    expect(result).toEqual({ ...original, syntax: { kind: "plain", reason: choice.reason } });
    expect(parseDiffResponse(result)).toEqual(result);
  }
  expect(diff).toEqual(original);
  expect(reads).toBe(0);
});

test("unavailable, rejected, or mismatched syntax sources retain the valid plain diff", async () => {
  const oldSource = "const value = 'before';\n";
  const newSource = "const value = 'after';\n";
  const unavailable = async () => null;
  const rejected = async (): Promise<string> => {
    throw new Error("Snapshot read failed");
  };
  const mismatched = async () => "const wrong = true;\n";
  const readOld = async () => oldSource;
  const readNew = async () => newSource;
  for (const failed of [unavailable, rejected, mismatched]) {
    for (const side of ["old", "new"]) {
      const diff = editedDiff();
      const original = structuredClone(diff);
      const result = await withDiffSyntax(
        diff,
        "value.ts",
        null,
        side === "old" ? failed : readOld,
        side === "new" ? failed : readNew,
      );
      expect(result).toEqual(original);
      expect(parseDiffResponse(result)).toEqual(original);
    }
  }
});

test("small diffs retain syntax context from source beyond the display line limit", async () => {
  const line = maxSourceTextLines + 1;
  const prefix = "\n".repeat(maxSourceTextLines);
  const oldContent = Buffer.from(prefix + "const value = false;\n");
  const newContent = Buffer.from(prefix + "const value = true;\n");
  expect(parseSourceText(oldContent)).toEqual({ kind: "too_large" });
  expect(parseSourceText(newContent)).toEqual({ kind: "too_large" });
  const diff = parseGitPatch(
    Buffer.from(`@@ -${line} +${line} @@\n-const value = false;\n+const value = true;\n`),
  );
  if (diff.kind !== "text") throw new Error("Expected the small changed hunk");
  const decorated = await withDiffSyntax(
    diff,
    "source.ts",
    null,
    async () => decodedText(oldContent),
    async () => decodedText(newContent),
  );
  expect(decorated.syntax).toEqual({ kind: "highlighted", language: "typescript" });
  expect(decorated.hunks[0]?.lines.map((row) => row.text)).toEqual([
    "const value = false;",
    "const value = true;",
  ]);
  expect(parseDiffResponse(decorated)).toEqual(decorated);
});
