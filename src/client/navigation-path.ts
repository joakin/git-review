/** Browser paths are relative to the host root or selected project, not access grants. */
export function isNavigationPath(value: unknown, allowRoot: boolean): value is string {
  if (typeof value !== "string" || value.length > 4096 || /[\0\ufffd]/u.test(value)) return false;
  if (value === "") return allowRoot;
  if (
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return false;
  try {
    // Lone surrogates would become replacement characters when serialized into a URL.
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}
