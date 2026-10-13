import { posix } from "node:path";
import { bundledLanguagesInfo, createHighlighter, type BundledLanguage } from "shiki";
import type { LanguageOption, SyntaxRole, SyntaxToken } from "@git-review/shared/api";

const languageByName = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  languageByName.set(info.id.toLowerCase(), info.id);
  for (const alias of info.aliases ?? []) languageByName.set(alias.toLowerCase(), info.id);
}

const filenameLanguages = new Map<string, string>([
  ["dockerfile", "docker"],
  ["makefile", "make"],
  ["cmakelists.txt", "cmake"],
]);
const extensionLanguages = new Map<string, string>([
  ["h", "c"],
  ["hh", "cpp"],
  ["hpp", "cpp"],
  ["hxx", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["yml", "yaml"],
  ["vue", "vue"],
  ["svelte", "svelte"],
]);

export const languages: LanguageOption[] = bundledLanguagesInfo
  .map(({ id, name }) => ({ id, name }))
  .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

export function languageOverride(value: string): string | null {
  if (value === "text") return value;
  return bundledLanguagesInfo.some((info) => info.id === value) ? value : null;
}

export function detectLanguage(path: string): string | null {
  const name = posix.basename(path).toLowerCase();
  const filenameMatch = filenameLanguages.get(name);
  if (filenameMatch !== undefined) return filenameMatch;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return extensionLanguages.get(extension) ?? languageByName.get(extension) ?? null;
}

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;
const loadPromises = new Map<string, Promise<void>>();

function roleForScopes(scopes: readonly string[]): SyntaxRole {
  if (scopes.some((scope) => /(?:^|\.)comment(?:\.|$)/.test(scope))) return "comment";
  if (scopes.some((scope) => /(?:^|\.)string(?:\.|$)/.test(scope))) return "string";
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index] ?? "";
    if (/constant\.numeric/.test(scope)) return "number";
    if (/entity\.name\.tag/.test(scope)) return "tag";
    if (/entity\.other\.attribute-name|entity\.name\.attribute/.test(scope)) return "attribute";
    if (
      /entity\.name\.(?:type|class|struct|enum)|support\.(?:type|class)|storage\.type\.built-in\.primitive/.test(
        scope,
      )
    )
      return "type";
    if (/entity\.name\.(?:function|method)|support\.function/.test(scope)) return "function";
    if (/variable\.(?:other\.)?(?:property|member)|support\.variable\.property/.test(scope))
      return "property";
    if (/^variable\b|\.variable\./.test(scope)) return "variable";
    if (/keyword\.operator|\.operator\b/.test(scope)) return "operator";
    if (/^keyword\b|\.keyword\.|storage\.modifier|^storage\.type\b|constant\.language/.test(scope))
      return "keyword";
    if (/^punctuation\b|\.punctuation\./.test(scope)) return "punctuation";
  }
  return "plain";
}

function append(tokens: SyntaxToken[], text: string, role: SyntaxRole): void {
  if (text === "") return;
  const previous = tokens[tokens.length - 1];
  if (previous?.role === role) previous.text += text;
  else tokens.push({ text, role });
}

export async function highlightSource(
  source: string,
  language: string,
): Promise<SyntaxToken[][] | null> {
  if (languageOverride(language) !== language || language === "text") return null;
  const checkedLanguage = language as BundledLanguage;
  const highlighter = await (highlighterPromise ??= createHighlighter({ langs: [], themes: [] }));
  let loading = loadPromises.get(language);
  if (loading === undefined) {
    loading = highlighter
      .loadLanguage(checkedLanguage)
      .then(() => undefined)
      .catch((error: unknown) => {
        loadPromises.delete(language);
        throw error;
      });
    loadPromises.set(language, loading);
  }
  await loading;
  const result = highlighter.codeToTokensBase(source, {
    lang: checkedLanguage,
    includeExplanation: true,
  });
  let tokenCount = 0;
  const lines = result.map((shikiLine) => {
    const tokens: SyntaxToken[] = [];
    for (const token of shikiLine) {
      if (token.explanation === undefined || token.explanation.length === 0) {
        append(tokens, token.content, "plain");
        continue;
      }
      for (const part of token.explanation) {
        append(tokens, part.content, roleForScopes(part.scopes.map((scope) => scope.scopeName)));
      }
    }
    tokenCount += tokens.length;
    return tokens;
  });
  return tokenCount <= 100_000 ? lines : null;
}
