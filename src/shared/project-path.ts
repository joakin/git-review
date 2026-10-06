/** Syntactic canonical POSIX paths; filesystem identity is checked by the host. */
export function isProjectPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    /[\0\ufffd]/u.test(value)
  )
    return false;
  if (
    value !== "/" &&
    value
      .slice(1)
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

export function projectApiUrl(
  resource: string,
  projectPath: string,
  fields: Record<string, string> = {},
): string {
  return `/api/project${resource}?${new URLSearchParams({ ...fields, projectPath })}`;
}
