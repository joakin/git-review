/** Build-time deployment configuration; source-based local development stays at /. */
declare const __GIT_REVIEW_BASE_PATH__: string;

export function parseDeploymentBasePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("/"))
    throw new Error("Deployment base must be an absolute URL path");
  if (value === "/") return value;
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  if (
    path
      .slice(1)
      .split("/")
      .some(
        (segment) => segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/u.test(segment),
      )
  )
    throw new Error("Deployment base must contain plain URL segments without traversal");
  return `${path}/`;
}

export const appBasePath = parseDeploymentBasePath(
  typeof __GIT_REVIEW_BASE_PATH__ === "undefined" ? "/" : __GIT_REVIEW_BASE_PATH__,
);
