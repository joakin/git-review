/** Operator-provided static deployment URL; origin allowlisting remains a separate boundary. */
export function parseClientUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("GIT_REVIEW_CLIENT_URL must be an HTTPS deployment URL ending in /");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid GIT_REVIEW_CLIENT_URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(url.pathname)
  )
    throw new Error(
      "GIT_REVIEW_CLIENT_URL must be an HTTPS deployment URL ending in / without credentials, query or fragment",
    );
  return url.href;
}
export function agentConnectionLink(clientUrl: string, endpoint: string): string {
  const url = new URL(parseClientUrl(clientUrl));
  url.searchParams.set("connect", endpoint);
  return url.href;
}
