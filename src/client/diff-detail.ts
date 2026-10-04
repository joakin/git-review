import type { DiffDetail, SyntaxToken } from "../shared/api.ts";

export type DecoratedToken = SyntaxToken & { changed: boolean };

export function decorateDiffTokens(
  tokens: readonly SyntaxToken[],
  detail: DiffDetail,
): DecoratedToken[] {
  if (detail.kind === "none") return tokens.map((token) => ({ ...token, changed: false }));
  const output: DecoratedToken[] = [];
  let offset = 0;
  let spanIndex = 0;
  for (const token of tokens) {
    let inside = 0;
    while (inside < token.text.length) {
      const position = offset + inside;
      while (
        detail.spans[spanIndex] !== undefined &&
        (detail.spans[spanIndex]?.end ?? 0) <= position
      )
        spanIndex += 1;
      const span = detail.spans[spanIndex];
      const changed = span !== undefined && position >= span.start;
      const boundary =
        span === undefined ? offset + token.text.length : changed ? span.end : span.start;
      const end = Math.min(offset + token.text.length, boundary);
      output.push({ text: token.text.slice(inside, end - offset), role: token.role, changed });
      inside = end - offset;
    }
    offset += token.text.length;
  }
  return output;
}
