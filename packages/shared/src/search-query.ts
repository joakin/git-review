export const maxSearchQueryLength = 128;

/** Search trims input; comment fragments retain their exact text and offsets. */
export function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim();
  if (query.length === 0 || query.length > maxSearchQueryLength || /[\0\r\n]/u.test(query))
    return null;
  try {
    // Keep literal Unicode, but reject lone surrogates that URLs would replace.
    encodeURIComponent(query);
    return query;
  } catch {
    return null;
  }
}
