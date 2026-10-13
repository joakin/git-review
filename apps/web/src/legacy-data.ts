import { isRecord } from "@git-review/shared/validation";
import { isProjectPath } from "@git-review/shared/project-path";
import { normalizeAgentEndpoint } from "./agent-connection.ts";
import {
  parseAgentBackup,
  defaultAgentLabel,
  parseAgentBackupText,
  maxAgentBackupBytes,
  type AgentBackup,
  type AgentGlobalPreferences,
  type SavedAgentProject,
} from "./agent-data-format.ts";
import { parseReviewBackup, type ReviewBackup } from "./backup.ts";
import {
  commentStoragePrefix,
  previousCommentStoragePrefix,
  emptyCommentStore,
  validateCommentStore,
  upgradeCommentStore,
  type CommentStore,
} from "./comments.ts";
import {
  appearanceStorageKey,
  codeTypographyStorageKey,
  defaultAppearance,
  defaultCodeTypography,
  validateAppearance,
  validateCodeTypography,
  workspaceStorageKey,
  validateSavedWorkspace,
  openCardsStoragePrefix,
  validateOpenCards,
  languageStoragePrefix,
  isLanguageOverride,
  wrapStorageKey,
  type SavedWorkspace,
} from "./storage.ts";

type StorageReader = Pick<Storage, "length" | "key" | "getItem">;
export type LegacyData = {
  comments: CommentStore[];
  openCards: { projectPath: string; keys: string[] }[];
  languages: { projectPath: string; path: string; language: string }[];
  workspace: SavedWorkspace | null;
  global: AgentGlobalPreferences;
};
export type LegacySnapshot = { data: LegacyData; fingerprint: string };
export type BackupImport =
  { kind: "agent"; backup: AgentBackup } | { kind: "legacy"; data: LegacyData };

export function readLegacyGlobal(storage: Pick<Storage, "getItem">): AgentGlobalPreferences {
  function value(key: string): unknown {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  const wrap = value(wrapStorageKey);
  return {
    wrap: typeof wrap === "boolean" ? wrap : true,
    appearance: validateAppearance(value(appearanceStorageKey)) ?? { ...defaultAppearance },
    codeTypography: validateCodeTypography(value(codeTypographyStorageKey)) ?? {
      ...defaultCodeTypography,
    },
  };
}

function canonicalKey(key: string, prefix: string): string {
  const path = decodeURIComponent(key.slice(prefix.length));
  if (!isProjectPath(path) || prefix + encodeURIComponent(path) !== key)
    throw new Error("Invalid legacy project key; original data is retained.");
  return path;
}

/** Reads only supported formats, with no upgrade writes or obsolete-key cleanup. */
export function readLegacyData(storage: StorageReader): LegacySnapshot {
  const rawRecords = new Map<string, string>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    if (
      [
        workspaceStorageKey,
        appearanceStorageKey,
        codeTypographyStorageKey,
        wrapStorageKey,
      ].includes(key) ||
      [
        commentStoragePrefix,
        previousCommentStoragePrefix,
        openCardsStoragePrefix,
        languageStoragePrefix,
      ].some((prefix) => key.startsWith(prefix))
    ) {
      const raw = storage.getItem(key);
      if (raw !== null) rawRecords.set(key, raw);
    }
  }
  const comments = new Map<string, CommentStore>();
  const previous = new Map<string, CommentStore>();
  const openCards: LegacyData["openCards"] = [];
  const languages: LegacyData["languages"] = [];
  for (const [key, raw] of rawRecords) {
    if (key.startsWith(commentStoragePrefix) || key.startsWith(previousCommentStoragePrefix)) {
      const older = key.startsWith(previousCommentStoragePrefix);
      const path = canonicalKey(key, older ? previousCommentStoragePrefix : commentStoragePrefix);
      // Current records take precedence, even if an older tab later changed its previous record.
      if (older && rawRecords.has(commentStoragePrefix + encodeURIComponent(path))) continue;
      const value: unknown = JSON.parse(raw);
      const store = older ? upgradeCommentStore(value, path) : validateCommentStore(value, path);
      if (store === null)
        throw new Error("Invalid legacy comments or history; original data is retained.");
      (older ? previous : comments).set(path, store);
    } else if (key.startsWith(openCardsStoragePrefix)) {
      const projectPath = canonicalKey(key, openCardsStoragePrefix);
      const keys = validateOpenCards(JSON.parse(raw) as unknown);
      if (keys === null)
        throw new Error("Invalid legacy card preferences; original data is retained.");
      openCards.push({ projectPath, keys });
    } else if (key.startsWith(languageStoragePrefix)) {
      const suffix = key.slice(languageStoragePrefix.length);
      const separator = suffix.indexOf(":");
      if (separator < 0) throw new Error("Invalid legacy language key.");
      const projectPath = decodeURIComponent(suffix.slice(0, separator));
      const path = decodeURIComponent(suffix.slice(separator + 1));
      if (
        !isProjectPath(projectPath) ||
        !isLanguageOverride(raw) ||
        languageStoragePrefix + encodeURIComponent(projectPath) + ":" + encodeURIComponent(path) !==
          key
      )
        throw new Error("Invalid legacy language preferences; original data is retained.");
      languages.push({ projectPath, path, language: raw });
    }
  }
  for (const [path, store] of previous) if (!comments.has(path)) comments.set(path, store);
  const rawWorkspace = rawRecords.get(workspaceStorageKey);
  let workspace: SavedWorkspace | null = null;
  if (rawWorkspace !== undefined) {
    const value: unknown = JSON.parse(rawWorkspace);
    if (!isRecord(value) || !isProjectPath(value["rootPath"]))
      throw new Error("Invalid legacy root metadata.");
    workspace = validateSavedWorkspace(value, value["rootPath"]);
    if (workspace === null) throw new Error("Invalid legacy recent folders.");
  }
  return {
    data: {
      comments: [...comments.values()],
      openCards,
      languages,
      workspace,
      global: readLegacyGlobal(storage),
    },
    fingerprint: JSON.stringify([...rawRecords].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function hasLegacyProjects(data: LegacyData): boolean {
  return (
    data.comments.length +
      data.openCards.length +
      data.languages.length +
      (data.workspace?.recentPaths.length ?? 0) >
    0
  );
}

export function assignLegacyData(data: LegacyData, input: unknown): AgentBackup {
  const endpoint = normalizeAgentEndpoint(input, true);
  const paths = new Set([
    ...data.comments.map((store) => store.projectPath),
    ...data.openCards.map((record) => record.projectPath),
    ...data.languages.map((record) => record.projectPath),
  ]);
  const comments = new Map(data.comments.map((store) => [store.projectPath, store]));
  function metadata(projectPath: string): SavedAgentProject {
    const root = data.workspace?.rootPath;
    const inside =
      root !== undefined &&
      (projectPath === root || projectPath.startsWith(root === "/" ? "/" : root + "/"));
    const name =
      projectPath
        .split("/")
        .at(-1)
        ?.replace(/[\x00-\x1f\x7f]/g, " ")
        .trim() || "Root folder";
    return {
      endpoint,
      projectPath,
      name,
      location:
        inside && root !== undefined
          ? {
              kind: "known-root",
              rootPath: root,
              relativePath:
                projectPath === root ? "" : projectPath.slice(root === "/" ? 1 : root.length + 1),
            }
          : { kind: "unknown-root" },
    };
  }
  const reviews = [...paths].map((path) => ({
    version: 1 as const,
    project: metadata(path),
    comments: comments.get(path) ?? emptyCommentStore(path),
    preferences: {
      openCards: data.openCards.find((record) => record.projectPath === path)?.keys ?? [],
      languages: data.languages
        .filter((record) => record.projectPath === path)
        .map(({ path, language }) => ({ path, language })),
    },
  }));
  return parseAgentBackup({
    format: "git-review-agent-backup",
    version: 1,
    catalog: {
      version: 1,
      connections: [{ endpoint, label: defaultAgentLabel(endpoint) }],
      projects: reviews.map((review) => review.project),
      workspaces:
        data.workspace === null
          ? []
          : [
              {
                endpoint,
                rootPath: data.workspace.rootPath,
                recentPaths: data.workspace.recentPaths,
              },
            ],
      global: data.global,
    },
    reviews,
  });
}

function legacyBackupData(backup: ReviewBackup): LegacyData {
  return {
    comments: backup.comments,
    openCards: backup.openCards,
    languages: backup.languages,
    workspace: backup.workspace,
    global: {
      wrap: backup.wrap,
      appearance: backup.appearance,
      codeTypography: backup.codeTypography,
    },
  };
}

export function parseBackupImport(text: string): BackupImport {
  if (
    text.length > maxAgentBackupBytes ||
    new TextEncoder().encode(text).byteLength > maxAgentBackupBytes
  )
    throw new Error("Backup exceeds the 25 MiB limit.");
  const value: unknown = JSON.parse(text);
  if (isRecord(value) && value["format"] === "git-review-agent-backup")
    return { kind: "agent", backup: parseAgentBackupText(text) };
  if (!isRecord(value) || !isProjectPath(value["rootPath"]))
    throw new Error("Unsupported backup format.");
  return { kind: "legacy", data: legacyBackupData(parseReviewBackup(value, value["rootPath"])) };
}
