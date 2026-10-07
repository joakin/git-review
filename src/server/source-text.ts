export const maxSourceTextBytes = 1024 * 1024;
export const maxSourceTextLines = 20_000;

type SourceText =
  | { kind: "text"; text: string; lineCount: number; hasFinalNewline: boolean }
  | { kind: "binary"; reason: "binary" }
  | { kind: "too_large" };

/** Exact, bounded source for syntax; complete snapshots have no display line limit. */
export function decodedText(content: Buffer, maxBytes = maxSourceTextBytes): string | null {
  if (content.byteLength > maxBytes || content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

/** Classify and count source without normalizing line endings or building display rows. */
export function parseSourceText(content: Buffer): SourceText {
  if (content.byteLength > maxSourceTextBytes) return { kind: "too_large" };
  const text = decodedText(content);
  if (text === null) return { kind: "binary", reason: "binary" };
  const hasFinalNewline = text.endsWith("\n");
  let lineCount = text === "" || hasFinalNewline ? 0 : 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lineCount += 1;
    if (lineCount > maxSourceTextLines) return { kind: "too_large" };
  }
  return { kind: "text", text, lineCount, hasFinalNewline };
}
