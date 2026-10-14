import { isProjectPath } from "@git-review/shared/project-path";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { normalizeAgentEndpoint } from "./agent-connection.ts";
import { projectResourceKey, type ProjectReference } from "./agent-project.ts";
import { validateCommentStore, type CommentStore } from "./comments.ts";
import { isNavigationPath } from "./navigation-path.ts";
import {
  defaultAppearance,
  defaultCodeTypography,
  isLanguageOverride,
  validateAppearance,
  validateCodeTypography,
  validateOpenCards,
  type Appearance,
  type CodeTypography,
} from "./storage.ts";

export const maxAgentBackupBytes = 25 * 1024 * 1024;
const maxProjects = 512;
const maxConnections = 64;
const maxConnectionLabel = 200;
const maxWorkspaces = 128;
const maxRecent = 8;
export const maxRecentProjects = 32;
const maxLanguages = 1000;

export type SavedAgentConnection = { endpoint: string; label: string };
export type SavedAgentProject = ProjectReference & {
  name: string;
  location:
    { kind: "unknown-root" } | { kind: "known-root"; rootPath: string; relativePath: string };
};
export type AgentProjectPreferences = {
  openCards: string[];
  languages: { path: string; language: string }[];
};
export type SavedAgentReview = {
  version: 1;
  project: SavedAgentProject;
  comments: CommentStore;
  preferences: AgentProjectPreferences;
};
export type AgentWorkspace = {
  endpoint: string;
  rootPath: string;
  recentPaths: string[];
};
export type AgentGlobalPreferences = {
  wrap: boolean;
  appearance: Appearance;
  codeTypography: CodeTypography;
};
export type AgentCatalog = {
  version: 1;
  connections: SavedAgentConnection[];
  projects: SavedAgentProject[];
  workspaces: AgentWorkspace[];
  recentProjects: ProjectReference[];
  global: AgentGlobalPreferences;
};
export type AgentBackup = {
  format: "git-review-agent-backup";
  version: 1;
  catalog: AgentCatalog;
  reviews: SavedAgentReview[];
};

export function emptyAgentCatalog(): AgentCatalog {
  return {
    version: 1,
    connections: [],
    projects: [],
    workspaces: [],
    recentProjects: [],
    global: {
      wrap: true,
      appearance: { ...defaultAppearance },
      codeTypography: { ...defaultCodeTypography },
    },
  };
}

function text(value: unknown, label: string, limit: number): string {
  const result = expectString(value, label);
  if (result.trim() === "" || result.length > limit || /[\x00-\x1f\x7f\ufffd]/u.test(result))
    throw new Error(`Invalid ${label}`);
  try {
    encodeURIComponent(result);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  return result;
}

function projectPath(value: unknown): string {
  if (!isProjectPath(value)) throw new Error("Invalid canonical project path");
  return value;
}

export function parseProjectReference(value: unknown): ProjectReference {
  const item = expectRecord(value, "project reference");
  return {
    endpoint: normalizeAgentEndpoint(item["endpoint"], true),
    projectPath: projectPath(item["projectPath"]),
  };
}

export function parseSavedAgentConnection(value: unknown): SavedAgentConnection {
  const item = expectRecord(value, "connection");
  return {
    endpoint: normalizeAgentEndpoint(item["endpoint"], true),
    label: text(item["label"], "connection label", maxConnectionLabel),
  };
}

export function defaultAgentLabel(endpoint: string): string {
  return new URL(endpoint).host.slice(0, maxConnectionLabel);
}

export function parseSavedAgentProject(value: unknown): SavedAgentProject {
  const item = expectRecord(value, "saved project");
  const reference = parseProjectReference(item);
  const name = text(item["name"], "project name", 4096);
  const location = expectRecord(item["location"], "project location");
  if (location["kind"] === "unknown-root") {
    if ("rootPath" in location || "relativePath" in location)
      throw new Error("Unknown project root has conflicting location metadata");
    return { ...reference, name, location: { kind: "unknown-root" } };
  }
  if (location["kind"] !== "known-root") throw new Error("Invalid project location");
  const rootPath = projectPath(location["rootPath"]);
  const relativePath = location["relativePath"];
  if (!isNavigationPath(relativePath, true)) throw new Error("Invalid project picker path");
  const absolute =
    relativePath === "" ? rootPath : `${rootPath === "/" ? "" : rootPath}/${relativePath}`;
  if (absolute !== reference.projectPath) throw new Error("Conflicting project location metadata");
  return { ...reference, name, location: { kind: "known-root", rootPath, relativePath } };
}

function records<T>(
  value: unknown,
  label: string,
  max: number,
  parse: (value: unknown) => T,
  identity: (value: T) => string,
): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid or oversized ${label}`);
  const seen = new Set<string>();
  return value.map((raw: unknown) => {
    const item = parse(raw);
    const key = identity(item);
    if (seen.has(key)) throw new Error(`Duplicate ${label} record`);
    seen.add(key);
    return item;
  });
}

export function parseAgentProjectPreferences(value: unknown): AgentProjectPreferences {
  const item = expectRecord(value, "project preferences");
  const keys = item["openCards"];
  const openCards = validateOpenCards({ version: 1, keys });
  if (openCards === null || !Array.isArray(keys) || openCards.length !== keys.length)
    throw new Error("Invalid or duplicate open cards");
  const languages = records(
    item["languages"],
    "language overrides",
    maxLanguages,
    (raw) => {
      const record = expectRecord(raw, "language override");
      const path = record["path"];
      const language = record["language"];
      if (!isNavigationPath(path, false) || !isLanguageOverride(language))
        throw new Error("Invalid language override");
      return { path, language };
    },
    (record) => record.path,
  );
  return { openCards, languages };
}

export function parseSavedAgentReview(value: unknown): SavedAgentReview {
  const item = expectRecord(value, "saved review");
  if (item["version"] !== 1) throw new Error("Unsupported saved review format");
  const project = parseSavedAgentProject(item["project"]);
  const comments = validateCommentStore(item["comments"], project.projectPath);
  if (comments === null) throw new Error("Invalid review comments or copy history");
  const historyIds = new Set<string>();
  for (const entry of comments.history) {
    if (
      historyIds.has(entry.id) ||
      new Set(entry.comments.map((comment) => comment.id)).size !== entry.comments.length
    )
      throw new Error("Duplicate copy history record");
    historyIds.add(entry.id);
  }
  return {
    version: 1,
    project,
    comments,
    preferences: parseAgentProjectPreferences(item["preferences"]),
  };
}

export function parseAgentWorkspace(value: unknown): AgentWorkspace {
  const item = expectRecord(value, "agent workspace");
  const endpoint = normalizeAgentEndpoint(item["endpoint"], true);
  const rootPath = projectPath(item["rootPath"]);
  const recentPaths = records(
    item["recentPaths"],
    "recent paths",
    maxRecent,
    (path) => {
      if (!isNavigationPath(path, true)) throw new Error("Invalid recent folder path");
      return path;
    },
    (path) => path,
  );
  return { endpoint, rootPath, recentPaths };
}

export function workspaceResourceKey(
  workspace: Pick<AgentWorkspace, "endpoint" | "rootPath">,
): string {
  return JSON.stringify([workspace.endpoint, workspace.rootPath]);
}

export function parseAgentGlobalPreferences(value: unknown): AgentGlobalPreferences {
  const item = expectRecord(value, "global preferences");
  const appearance = validateAppearance(item["appearance"]);
  const codeTypography = validateCodeTypography(item["codeTypography"]);
  if (typeof item["wrap"] !== "boolean" || appearance === null || codeTypography === null)
    throw new Error("Invalid global preferences");
  return { wrap: item["wrap"], appearance, codeTypography };
}

/** Ordered references: earlier entries win, and identities retain their original endpoint. */
export function mergeRecentProjects(
  first: readonly ProjectReference[],
  second: readonly ProjectReference[],
): ProjectReference[] {
  const unique = new Map<string, ProjectReference>();
  for (const reference of [...first, ...second]) {
    const key = projectResourceKey(reference);
    if (!unique.has(key)) unique.set(key, reference);
    if (unique.size === maxRecentProjects) break;
  }
  return [...unique.values()];
}

export function parseAgentCatalog(value: unknown): AgentCatalog {
  const item = expectRecord(value, "agent catalog");
  if (item["version"] !== 1) throw new Error("Unsupported agent catalog format");
  const projects = records(
    item["projects"],
    "saved projects",
    maxProjects,
    parseSavedAgentProject,
    projectResourceKey,
  );
  const workspaces = records(
    item["workspaces"],
    "workspaces",
    maxWorkspaces,
    parseAgentWorkspace,
    workspaceResourceKey,
  );
  // Older catalogs recorded MRU order within roots, but not between roots.
  const recentProjects =
    item["recentProjects"] === undefined
      ? mergeRecentProjects(
          [...workspaces].reverse().flatMap((workspace) =>
            workspace.recentPaths.flatMap((relativePath) => {
              const known = projects.find(
                (project) =>
                  project.endpoint === workspace.endpoint &&
                  project.location.kind === "known-root" &&
                  project.location.rootPath === workspace.rootPath &&
                  project.location.relativePath === relativePath,
              );
              const projectPath =
                known?.projectPath ??
                (relativePath === ""
                  ? workspace.rootPath
                  : `${workspace.rootPath === "/" ? "" : workspace.rootPath}/${relativePath}`);
              return isProjectPath(projectPath)
                ? [{ endpoint: workspace.endpoint, projectPath }]
                : [];
            }),
          ),
          [],
        )
      : records(
          item["recentProjects"],
          "recent projects",
          maxRecentProjects,
          parseProjectReference,
          projectResourceKey,
        );
  return {
    version: 1,
    connections: records(
      item["connections"],
      "connections",
      maxConnections,
      parseSavedAgentConnection,
      (record) => record.endpoint,
    ),
    projects,
    workspaces,
    recentProjects,
    global: parseAgentGlobalPreferences(item["global"]),
  };
}

/** Review metadata wins over a stale index after a save whose index write failed. */
export function reconcileAgentProjects(
  catalog: AgentCatalog,
  reviews: readonly SavedAgentReview[],
): AgentCatalog {
  const projects = new Map(
    catalog.projects.map((project) => [projectResourceKey(project), project]),
  );
  for (const review of reviews) projects.set(projectResourceKey(review.project), review.project);
  return parseAgentCatalog({ ...catalog, projects: [...projects.values()] });
}

export function parseAgentBackup(value: unknown): AgentBackup {
  const item = expectRecord(value, "agent backup");
  if (item["format"] !== "git-review-agent-backup" || item["version"] !== 1)
    throw new Error("Unsupported agent backup format");
  const catalog = parseAgentCatalog(item["catalog"]);
  const reviews = records(
    item["reviews"],
    "saved reviews",
    maxProjects,
    parseSavedAgentReview,
    (review) => projectResourceKey(review.project),
  );
  const indexed = new Map(
    catalog.projects.map((project) => [projectResourceKey(project), project]),
  );
  for (const review of reviews) {
    const project = indexed.get(projectResourceKey(review.project));
    if (project !== undefined && JSON.stringify(project) !== JSON.stringify(review.project))
      throw new Error("Backup project index conflicts with saved review metadata");
  }
  return {
    format: "git-review-agent-backup",
    version: 1,
    catalog: reconcileAgentProjects(catalog, reviews),
    reviews,
  };
}

export function serializeAgentBackup(backup: AgentBackup): string {
  const text = JSON.stringify(parseAgentBackup(backup));
  if (new TextEncoder().encode(text).byteLength > maxAgentBackupBytes)
    throw new Error("Review data exceeds the 25 MiB backup limit");
  return text;
}

export function parseAgentBackupText(text: string): AgentBackup {
  if (
    text.length > maxAgentBackupBytes ||
    new TextEncoder().encode(text).byteLength > maxAgentBackupBytes
  )
    throw new Error("Review data exceeds the 25 MiB backup limit");
  return parseAgentBackup(JSON.parse(text) as unknown);
}
