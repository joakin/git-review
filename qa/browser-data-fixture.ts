import {
  createAgentDataRepository,
  agentCatalogStorageKey,
  agentReviewStorageKey,
} from "../apps/web/src/agent-data.ts";
import {
  emptyCommentStore,
  validateCommentStore,
  upgradeCommentStore,
} from "../apps/web/src/comments.ts";
import { expectRecord, expectString } from "@git-review/shared/validation";
import { readLegacyGlobal } from "../apps/web/src/legacy-data.ts";
import { emptyWorkspace } from "../apps/web/src/storage.ts";
import type { AgentGlobalPreferences } from "../apps/web/src/agent-data-format.ts";

function endpoint(): string {
  return new URLSearchParams(location.search).get("agent") ?? location.origin;
}
function repository() {
  const data = createAgentDataRepository(localStorage);
  if (localStorage.getItem(agentCatalogStorageKey) === null)
    data.saveCatalog({ ...data.readCatalog(), global: readLegacyGlobal(localStorage) });
  return data;
}
const fixture = {
  hasReview(projectPath: string, owner = endpoint()) {
    return repository().readReview({ endpoint: owner, projectPath }) !== null;
  },
  commentKey(projectPath: string, owner = endpoint()) {
    const raw: unknown = JSON.parse(localStorage.getItem(agentCatalogStorageKey) ?? "null");
    return agentReviewStorageKey(
      expectString(expectRecord(raw, "catalog")["generation"], "generation"),
      { endpoint: owner, projectPath },
    );
  },
  readComments(projectPath: string, owner = endpoint()) {
    return (
      repository().readReview({ endpoint: owner, projectPath })?.comments ??
      emptyCommentStore(projectPath)
    );
  },
  writeComments(value: unknown, owner = endpoint()) {
    const path = expectString(expectRecord(value, "comments")["projectPath"], "project path");
    const comments = validateCommentStore(value, path) ?? upgradeCommentStore(value, path);
    if (comments === null) throw new Error("Invalid QA review fixture");
    const data = repository();
    const current = data.readReview({ endpoint: owner, projectPath: comments.projectPath });
    data.saveReview(
      current === null
        ? {
            version: 1,
            project: {
              endpoint: owner,
              projectPath: comments.projectPath,
              name: "QA project",
              location: { kind: "unknown-root" },
            },
            comments,
            preferences: { openCards: [], languages: [] },
          }
        : { ...current, comments },
    );
  },
  commentRecords(): [string, string][] {
    return repository()
      .exportBackup()
      .reviews.map((record) => [
        fixture.commentKey(record.project.projectPath, record.project.endpoint),
        JSON.stringify(record.comments),
      ]);
  },
  cardsRecords(): [string, string][] {
    return repository()
      .exportBackup()
      .reviews.map((record) => [
        fixture.commentKey(record.project.projectPath, record.project.endpoint),
        JSON.stringify({ version: 1, keys: record.preferences.openCards }),
      ]);
  },
  clearCards() {
    const data = repository();
    for (const review of data.exportBackup().reviews)
      data.saveReview({ ...review, preferences: { ...review.preferences, openCards: [] } });
  },
  global: () => repository().readCatalog().global,
  writeGlobal(global: Partial<AgentGlobalPreferences>) {
    const data = repository();
    const catalog = data.readCatalog();
    data.saveCatalog({ ...catalog, global: { ...catalog.global, ...global } });
  },
  workspace(rootPath: string, owner = endpoint()) {
    const record = repository()
      .readCatalog()
      .workspaces.find((record) => record.endpoint === owner && record.rootPath === rootPath);
    return record === undefined
      ? emptyWorkspace(rootPath)
      : { version: 4 as const, rootPath, recentPaths: record.recentPaths };
  },
};
declare global {
  interface Window {
    reviewDataQa: typeof fixture;
  }
}
window.reviewDataQa = fixture;
