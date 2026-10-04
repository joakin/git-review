import type { DiffResult } from "../shared/api.ts";
import { detectLanguage, highlightSource } from "./syntax.ts";

type TextDiff = Extract<DiffResult, { kind: "text" }>;

// Read complete source snapshots so multiline grammar state survives hunk boundaries.
export async function withDiffSyntax(
  diff: TextDiff,
  path: string,
  override: string | null,
  readOld: () => Promise<string | null>,
  readNew: () => Promise<string | null>,
): Promise<TextDiff> {
  if (diff.hunks.length === 0) return diff;
  if (override === "text") return { ...diff, syntax: { kind: "plain", reason: "selected" } };
  const language = override ?? detectLanguage(path);
  if (language === null) return { ...diff, syntax: { kind: "plain", reason: "unknown_language" } };
  try {
    const lines = diff.hunks.flatMap((hunk) => hunk.lines);
    const needsOld = lines.some((line) => line.kind === "removed");
    const needsNew = lines.some((line) => line.kind !== "removed");
    const [oldSource, newSource] = await Promise.all([
      needsOld ? readOld() : Promise.resolve(""),
      needsNew ? readNew() : Promise.resolve(""),
    ]);
    if (oldSource === null || newSource === null) return diff;
    const [oldTokens, newTokens] = await Promise.all([
      needsOld ? highlightSource(oldSource, language) : Promise.resolve([]),
      needsNew ? highlightSource(newSource, language) : Promise.resolve([]),
    ]);
    if (oldTokens === null || newTokens === null) return diff;
    const hunks = diff.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => {
        const index = (line.kind === "removed" ? line.oldLine : line.newLine) ?? 0;
        const tokens = (line.kind === "removed" ? oldTokens : newTokens)[index - 1];
        if (tokens === undefined || tokens.map((token) => token.text).join("") !== line.text)
          throw new Error("Syntax tokens do not match the diff");
        return { ...line, tokens };
      }),
    }));
    return { kind: "text", syntax: { kind: "highlighted", language }, hunks };
  } catch {
    return diff;
  }
}
