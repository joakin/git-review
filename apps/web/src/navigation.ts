import { isChangeLayer, type ChangeLayer } from "@git-review/shared/api";
import { isGitOid, validGitRef } from "@git-review/shared/git";
import { normalizeSearchQuery } from "@git-review/shared/search-query";
import { isValidUrlEncoding } from "@git-review/shared/validation";
import { isNavigationPath } from "./navigation-path.ts";
import { appBasePath } from "./deployment.ts";
import { isProjectPath } from "@git-review/shared/project-path";

export type ChangesTarget =
  { kind: "all" } | { kind: "list" } | { kind: "file"; layer: ChangeLayer; path: string };
export type FileTarget = { kind: "list" } | { kind: "file"; path: string; line: number | null };
export type SearchTarget = { kind: "results" } | { kind: "file"; path: string; line: number };
export type GitRoute = {
  section: "git";
  projectPath: string;
  ref: string | null;
  target: { kind: "list" } | { kind: "commit"; oid: string };
};
export type Route =
  | { section: "projects"; directory: string }
  | { section: "changes"; projectPath: string; target: ChangesTarget }
  | { section: "files"; projectPath: string; directory: string; target: FileTarget }
  | { section: "search"; projectPath: string; query: string | null; target: SearchTarget }
  | GitRoute
  | { section: "settings"; projectPath: string | null };
export type RouteState =
  { kind: "empty" } | { kind: "ready"; route: Route } | { kind: "invalid"; message: string };

const keys = new Set([
  "section",
  "project",
  "dir",
  "target",
  "layer",
  "file",
  "line",
  "q",
  "ref",
  "commit",
]);
const routeError = "This link has invalid navigation information. Choose a project to continue.";

export function parentDirectory(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function parseNavigationSearch(search: string, absoluteProjects = false): RouteState {
  if (search === "") return { kind: "empty" };
  if (!isValidUrlEncoding(search)) return { kind: "invalid", message: routeError };
  const params = new URLSearchParams(search);
  const seen = new Set<string>();
  for (const [key] of params) {
    if (!keys.has(key) || seen.has(key)) return { kind: "invalid", message: routeError };
    seen.add(key);
  }
  const section = params.get("section");
  const project = params.get("project");
  const directory = params.get("dir");
  const target = params.get("target");
  const layer = params.get("layer");
  const file = params.get("file");
  const lineText = params.get("line");
  const query = params.get("q");
  const ref = params.get("ref");
  const commit = params.get("commit");
  const validProject = (value: string) =>
    absoluteProjects ? isProjectPath(value) : isNavigationPath(value, true);
  if (section !== "git" && (ref !== null || commit !== null))
    return { kind: "invalid", message: routeError };
  if (section === "projects") {
    if (
      project !== null ||
      target !== null ||
      layer !== null ||
      file !== null ||
      lineText !== null ||
      query !== null ||
      !isNavigationPath(directory ?? "", true)
    )
      return { kind: "invalid", message: routeError };
    return { kind: "ready", route: { section, directory: directory ?? "" } };
  }
  if (section === "settings") {
    if (
      directory !== null ||
      target !== null ||
      layer !== null ||
      file !== null ||
      lineText !== null ||
      query !== null ||
      (project !== null && !validProject(project))
    )
      return { kind: "invalid", message: routeError };
    return { kind: "ready", route: { section, projectPath: project } };
  }
  if (project === null || !validProject(project)) return { kind: "invalid", message: routeError };
  if (section === "git") {
    if (
      directory !== null ||
      target !== null ||
      layer !== null ||
      file !== null ||
      lineText !== null ||
      query !== null ||
      (ref !== null && !validGitRef(ref)) ||
      (commit !== null && !isGitOid(commit))
    )
      return { kind: "invalid", message: routeError };
    return {
      kind: "ready",
      route: {
        section,
        projectPath: project,
        ref,
        target: commit === null ? { kind: "list" } : { kind: "commit", oid: commit },
      },
    };
  }
  if (section === "changes") {
    if (directory !== null || lineText !== null || query !== null)
      return { kind: "invalid", message: routeError };
    if (target === "list" && layer === null && file === null)
      return { kind: "ready", route: { section, projectPath: project, target: { kind: "list" } } };
    if (target === null && layer === null && file === null)
      return { kind: "ready", route: { section, projectPath: project, target: { kind: "all" } } };
    if (
      target === null &&
      layer !== null &&
      isChangeLayer(layer) &&
      file !== null &&
      isNavigationPath(file, false)
    )
      return {
        kind: "ready",
        route: { section, projectPath: project, target: { kind: "file", layer, path: file } },
      };
    return { kind: "invalid", message: routeError };
  }
  if (section === "files") {
    if (
      layer !== null ||
      query !== null ||
      target !== null ||
      !isNavigationPath(directory ?? "", true)
    )
      return { kind: "invalid", message: routeError };
    if (file === null && lineText === null)
      return {
        kind: "ready",
        route: {
          section,
          projectPath: project,
          directory: directory ?? "",
          target: { kind: "list" },
        },
      };
    if (
      file === null ||
      !isNavigationPath(file, false) ||
      (directory !== null && directory !== parentDirectory(file))
    )
      return { kind: "invalid", message: routeError };
    const line = parseLine(lineText);
    if (line === false) return { kind: "invalid", message: routeError };
    return {
      kind: "ready",
      route: {
        section,
        projectPath: project,
        directory: directory ?? parentDirectory(file),
        target: { kind: "file", path: file, line },
      },
    };
  }
  if (section === "search") {
    const normalizedQuery = query === null ? null : normalizeSearchQuery(query);
    if (
      directory !== null ||
      target !== null ||
      layer !== null ||
      (query !== null && normalizedQuery === null)
    )
      return { kind: "invalid", message: routeError };
    if (file === null && lineText === null)
      return {
        kind: "ready",
        route: {
          section,
          projectPath: project,
          query: normalizedQuery,
          target: { kind: "results" },
        },
      };
    if (normalizedQuery === null || file === null || !isNavigationPath(file, false))
      return { kind: "invalid", message: routeError };
    const line = parseLine(lineText);
    if (line === false || line === null) return { kind: "invalid", message: routeError };
    return {
      kind: "ready",
      route: {
        section,
        projectPath: project,
        query: normalizedQuery,
        target: { kind: "file", path: file, line },
      },
    };
  }
  return { kind: "invalid", message: routeError };
}

function parseLine(value: string | null): number | null | false {
  if (value === null) return null;
  if (!/^[1-9][0-9]*$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 10_000_000 ? parsed : false;
}

export function routeUrl(route: Route, basePath = appBasePath): string {
  const params = new URLSearchParams();
  params.set("section", route.section);
  if (route.section === "projects") {
    if (route.directory !== "") params.set("dir", route.directory);
  } else if (route.section === "settings") {
    if (route.projectPath !== null) params.set("project", route.projectPath);
  } else {
    params.set("project", route.projectPath);
    if (route.section === "changes") {
      if (route.target.kind === "list") params.set("target", "list");
      if (route.target.kind === "file") {
        params.set("layer", route.target.layer);
        params.set("file", route.target.path);
      }
    } else if (route.section === "files") {
      if (route.directory !== "") params.set("dir", route.directory);
      if (route.target.kind === "file") {
        params.set("file", route.target.path);
        if (route.target.line !== null) params.set("line", String(route.target.line));
      }
    } else if (route.section === "git") {
      if (route.ref !== null) params.set("ref", route.ref);
      if (route.target.kind === "commit") params.set("commit", route.target.oid);
    } else {
      if (route.query !== null) params.set("q", route.query);
      if (route.target.kind === "file") {
        params.set("file", route.target.path);
        params.set("line", String(route.target.line));
      }
    }
  }
  return `${basePath}?${params.toString()}`;
}

export function routeProjectPath(route: Route): string | null {
  return route.section === "projects" ? null : route.projectPath;
}

export function routeSection(route: Route): "changes" | "files" | "search" | "git" | null {
  return route.section === "changes" ||
    route.section === "files" ||
    route.section === "search" ||
    route.section === "git"
    ? route.section
    : null;
}
