import { expect, test } from "bun:test";
import { createBrowserData, memoryDataStorage } from "./browser-data.ts";
import { createAgentDataRepository, agentCatalogStorageKey } from "./agent-data.ts";
import { assignLegacyData, readLegacyData, parseBackupImport } from "./legacy-data.ts";
import { serializeAgentBackup } from "./agent-data-format.ts";
import {
  emptyCommentStore,
  commentStoragePrefix,
  previousCommentStoragePrefix,
  type DraftComment,
} from "./comments.ts";
import { appearanceStorageKey, workspaceStorageKey } from "./storage.ts";
import { parseAgentTabSelection, agentActiveProjectKey } from "./agent-tab-state.ts";
import { withTestStorage } from "./storage-test-support.ts";

const a = "https://a.example.ts.net";
const b = "https://b.example.ts.net";
const path = "/workspace/project";
const draft: DraftComment = {
  id: "draft",
  anchor: {
    kind: "file",
    source: "worktree",
    path: "file.ts",
    line: 1,
    sourceText: "\tlast last 🦊",
    before: null,
    after: "",
  },
  subject: { kind: "selection", start: 6, end: 10, text: "last" },
  body: "Review this",
  createdAt: 1,
  updatedAt: 2,
  state: "current",
};
const comments = {
  ...emptyCommentStore(path),
  drafts: [draft],
  history: [{ id: "copy", copiedAt: 3, text: "Exact copied history  \r\n🦊\t", comments: [draft] }],
};
function seed(local: Storage, session: Storage) {
  local.setItem(commentStoragePrefix + encodeURIComponent(path), JSON.stringify(comments));
  local.setItem(
    workspaceStorageKey,
    JSON.stringify({ version: 4, rootPath: "/workspace", recentPaths: ["project"] }),
  );
  local.setItem(
    appearanceStorageKey,
    JSON.stringify({ version: 1, appTheme: "dark", codeTheme: "light" }),
  );
  session.setItem(
    "git-review:active-project:v2",
    JSON.stringify({ version: 2, rootPath: "/workspace", activePath: "project" }),
  );
}
function savedKeys(local: Storage): [string | null, string | null][] {
  return Array.from({ length: local.length }, (_, i) => local.key(i)).map((key) => [
    key,
    key === null ? null : local.getItem(key),
  ]);
}

test("legacy conversion requires an explicit endpoint and preserves IDs, quotes, history, preferences and original keys", () => {
  withTestStorage((local, session) => {
    seed(local, session);
    const original = savedKeys(local);
    const data = createBrowserData(local, session);
    expect(data.startup.kind).toBe("legacy");
    expect(savedKeys(local)).toEqual(original);
    if (data.startup.kind !== "legacy") throw new Error("Missing migration preview");
    expect(() =>
      assignLegacyData(
        data.startup.kind === "legacy" ? data.startup.snapshot.data : readLegacyData(local).data,
        "",
      ),
    ).toThrow();
    data.convertLegacy(data.startup.snapshot, b);
    const reload = createBrowserData(local, session);
    expect(reload.startup.kind).toBe("ready");
    expect(reload.projectState(b).readComments(path)).toEqual(comments);
    expect(reload.projectState(a).readComments(path)).toEqual(emptyCommentStore(path));
    expect(reload.readGlobal().appearance.appTheme).toBe("dark");
    expect(reload.readLastSelection()).toEqual({
      version: 1,
      kind: "scoped",
      endpoint: b,
      projectPath: path,
      rootPath: "/workspace",
      relativePath: "project",
    });
    for (const [key, value] of original)
      if (typeof key === "string") expect(local.getItem(key)).toBe(value);
    expect(createAgentDataRepository(local).readLegacyConversion()).toEqual({
      kind: "complete",
      endpoint: b,
    });
    local.setItem(commentStoragePrefix + encodeURIComponent(path), "{old tab changed this}");
    expect(createBrowserData(local, session).startup.kind).toBe("ready");
    expect(createBrowserData(local, session).projectState(b).readComments(path)).toEqual(comments);
  });
});

test("supported previous comment records are upgraded read-only; malformed current data is never replaced by an older record", () => {
  withTestStorage((local) => {
    local.setItem(
      previousCommentStoragePrefix + encodeURIComponent(path),
      JSON.stringify({ ...comments, version: 4 }),
    );
    const before = savedKeys(local);
    expect(assignLegacyData(readLegacyData(local).data, a).reviews[0]?.comments).toEqual(comments);
    expect(savedKeys(local)).toEqual(before);
    local.setItem(commentStoragePrefix + encodeURIComponent(path), "{invalid}");
    expect(createBrowserData(local, null).startup.kind).toBe("error");
    expect(local.getItem(previousCommentStoragePrefix + encodeURIComponent(path))).not.toBeNull();
  });
});

test("conversion cannot publish its marker after a failed project or catalog write and can be retried", () => {
  for (const failureAt of [1, 2])
    withTestStorage((local, session) => {
      seed(local, session);
      const data = createBrowserData(local, session);
      if (data.startup.kind !== "legacy") throw new Error("Missing migration");
      const source = local.getItem(commentStoragePrefix + encodeURIComponent(path));
      const setItem = local.setItem;
      let writes = 0;
      local.setItem = (key, value) => {
        if (++writes === failureAt) throw new Error("Quota");
        setItem(key, value);
      };
      expect(() =>
        data.convertLegacy(
          data.startup.kind === "legacy" ? data.startup.snapshot : readLegacyData(local),
          a,
        ),
      ).toThrow();
      expect(createAgentDataRepository(local).readLegacyConversion().kind).toBe("pending");
      expect(local.getItem(commentStoragePrefix + encodeURIComponent(path))).toBe(source);
      local.setItem = setItem;
      data.convertLegacy(data.startup.snapshot, a);
      expect(createBrowserData(local, session).startup.kind).toBe("ready");
    });
});

test("a conversion preview is invalidated by old-tab changes before confirmation", () => {
  withTestStorage((local, session) => {
    seed(local, session);
    const data = createBrowserData(local, session);
    if (data.startup.kind !== "legacy") throw new Error("Missing migration");
    local.setItem(
      commentStoragePrefix + encodeURIComponent(path),
      JSON.stringify({ ...comments, drafts: [] }),
    );
    expect(() =>
      data.convertLegacy(
        data.startup.kind === "legacy" ? data.startup.snapshot : readLegacyData(local),
        a,
      ),
    ).toThrow("changed in another tab");
    expect(local.getItem(agentCatalogStorageKey)).toBeNull();
  });
});

test("active project stores survive reload independently of endpoint/root and explicit URL selection", () => {
  const local = memoryDataStorage();
  const tabA = memoryDataStorage();
  const tabB = memoryDataStorage();
  const dataA = createBrowserData(local, tabA);
  const dataB = createBrowserData(local, tabB);
  dataA.projectState(a).saveActiveProject("/workspace", "project");
  dataB.projectState(b).saveActiveProject("/workspace", "other");
  expect(createBrowserData(local, tabA).readLastSelection()?.endpoint).toBe(a);
  expect(createBrowserData(local, tabB).readLastSelection()?.endpoint).toBe(b);
  expect(dataA.projectState(b).readActiveProject("/workspace")).toBeNull();
  expect(dataA.projectState(a).readActiveProject("/different")).toBeNull();
  const original = dataA.readLastSelection();
  for (const patch of [
    { endpoint: "http://remote.example" },
    { projectPath: "/wrong" },
    { relativePath: "../escape" },
    { version: 2 },
  ])
    expect(parseAgentTabSelection({ ...original, ...patch })).toBeNull();
  tabA.setItem(agentActiveProjectKey, "{invalid}");
  expect(createBrowserData(local, tabA).readLastSelection()).toBeNull();
});

test("endpoint-owned ports persist comments and preferences after reload and retain failed saves for export", () => {
  const local = memoryDataStorage();
  const data = createBrowserData(local, memoryDataStorage());
  const first = data.projectState(a);
  const second = data.projectState(b);
  first.saveComments(comments);
  first.saveOpenCards(path, new Set(["staged:file.ts"]));
  first.saveLanguageOverride(path, "file.ts", "text");
  second.saveComments({ ...comments, drafts: [] });
  const reloaded = createBrowserData(local, null);
  expect(reloaded.projectState(a).readComments(path)).toEqual(comments);
  expect(reloaded.projectState(a).readOpenCards(path)).toEqual(new Set(["staged:file.ts"]));
  expect(reloaded.projectState(a).readLanguageOverride(path, "file.ts")).toBe("text");
  expect(reloaded.projectState(b).readComments(path).drafts).toEqual([]);
  const setItem = local.setItem;
  local.setItem = () => {
    throw new Error("Quota");
  };
  const changed = { ...comments, history: [] };
  expect(first.saveComments(changed)).toBe(false);
  expect(data.readProblem()).toContain(path);
  expect(data.readProblem()).toContain(a);
  expect(
    data.exportBackup().reviews.find((review) => review.project.endpoint === a)?.comments,
  ).toEqual(changed);
  local.setItem = setItem;
});

test("temporary mode is explicit; unreadable project records are never overwritten", () => {
  const denied = createBrowserData(null, null);
  expect(denied.startup.kind).toBe("error");
  denied.continueTemporarily();
  denied.projectState(a).saveComments(comments);
  expect(denied.isTemporary()).toBe(true);
  expect(denied.exportBackup().reviews[0]?.comments).toEqual(comments);
  withTestStorage((local) => {
    const data = createBrowserData(local, null);
    data.projectState(a).saveComments(comments);
    const key = Array.from({ length: local.length }, (_, i) => local.key(i)).find((key) =>
      key?.startsWith("git-review:agents:v1:reviews:"),
    );
    if (key === null || key === undefined) throw new Error("Missing stored record");
    local.setItem(key, "{corrupt}");
    const next = createBrowserData(local, null);
    expect(next.projectState(a).saveComments(comments)).toBe(false);
    expect(local.getItem(key)).toBe("{corrupt}");
    expect(() => next.exportBackup()).toThrow();
  });
});

test("global preferences follow the catalog and legacy-file import keeps explicit assignment separate from new backups", () => {
  withTestStorage((local, tab) => {
    local.setItem(
      appearanceStorageKey,
      JSON.stringify({ version: 1, appTheme: "dark", codeTheme: "light" }),
    );
    const data = createBrowserData(local, tab);
    data.saveGlobal({ wrap: false });
    const backup = data.exportBackup();
    expect(createBrowserData(local, tab).readGlobal().wrap).toBe(false);
    expect(local.getItem(appearanceStorageKey)).toContain("dark");
    expect(parseBackupImport(serializeAgentBackup(backup)).kind).toBe("agent");
    const legacy = {
      version: 7,
      rootPath: "/workspace",
      workspace: { version: 4, rootPath: "/workspace", recentPaths: [] },
      wrap: true,
      codeTypography: backup.catalog.global.codeTypography,
      appearance: backup.catalog.global.appearance,
      comments: [comments],
      openCards: [],
      languages: [],
    };
    const source = parseBackupImport(JSON.stringify(legacy));
    if (source.kind !== "legacy") throw new Error("Missing legacy import");
    const assigned = assignLegacyData(source.data, b);
    data.applyBackup(assigned);
    expect(data.projectState(b).readComments(path)).toEqual(comments);
    // Import cannot mark this origin's legacy source as converted.
    expect(createAgentDataRepository(local).readLegacyConversion().kind).toBe("pending");
    for (const version of [1, 2, 3, 4, 5, 8])
      expect(() => parseBackupImport(JSON.stringify({ ...legacy, version }))).toThrow();
  });
});

test("canonical tab restoration survives unavailable or stale root metadata without substituting a folder", () => {
  const local = memoryDataStorage();
  const tab = memoryDataStorage();
  const data = createBrowserData(local, tab);
  const port = data.projectState(b);
  port.rememberProject({ name: "Project", absolutePath: path, relativePath: "" }, null);
  expect(data.readLastSelection()).toEqual({
    version: 1,
    kind: "canonical",
    endpoint: b,
    projectPath: path,
  });
  expect(createBrowserData(local, tab).readLastSelection()?.projectPath).toBe(path);
  port.rememberProject({ name: "Project", absolutePath: path, relativePath: "" }, "/different");
  expect(data.exportBackup().catalog.projects[0]?.location).toEqual({ kind: "unknown-root" });
  expect(data.readLastSelection()?.projectPath).toBe(path);
});

test("export uses current stored reviews and global preference patches preserve unrelated choices from another tab", () => {
  const local = memoryDataStorage();
  const first = createBrowserData(local, memoryDataStorage());
  const second = createBrowserData(local, memoryDataStorage());
  first.projectState(a).saveComments(comments);
  second.projectState(a).readComments(path);
  const changed = { ...comments, history: [] };
  first.projectState(a).saveComments(changed);
  expect(second.exportBackup().reviews[0]?.comments).toEqual(changed);
  first.saveGlobal({ appearance: { version: 1, appTheme: "dark", codeTheme: "light" } });
  second.saveGlobal({ wrap: false });
  expect(first.exportBackup().catalog.global.appearance.appTheme).toBe("dark");
  expect(first.exportBackup().catalog.global.wrap).toBe(false);
});

test("a second tab cannot apply its stale conversion preview after conversion completes", () => {
  withTestStorage((local, tab) => {
    seed(local, tab);
    const first = createBrowserData(local, tab);
    const second = createBrowserData(local, memoryDataStorage());
    if (first.startup.kind !== "legacy" || second.startup.kind !== "legacy")
      throw new Error("Missing previews");
    first.convertLegacy(first.startup.snapshot, a);
    createBrowserData(local, tab)
      .projectState(a)
      .saveComments({ ...comments, history: [] });
    expect(() =>
      second.convertLegacy(
        second.startup.kind === "legacy" ? second.startup.snapshot : readLegacyData(local),
        a,
      ),
    ).toThrow("already converted");
    expect(createBrowserData(local, tab).projectState(a).readComments(path).history).toEqual([]);
  });
});

test("valid unusual project paths keep their identity when the display name needs a fallback", () => {
  const local = memoryDataStorage();
  const data = createBrowserData(local, memoryDataStorage());
  const unusual = "/workspace/ \n ";
  const store = emptyCommentStore(unusual);
  const port = data.projectState(a);
  port.rememberProject({ name: " \n ", absolutePath: unusual, relativePath: " \n " }, "/workspace");
  expect(port.saveComments(store)).toBe(true);
  expect(data.exportBackup().reviews[0]?.project.projectPath).toBe(unusual);
  expect(data.exportBackup().reviews[0]?.project.name.trim().length).toBeGreaterThan(0);
});

test("a saved import with incomplete cleanup carries a notice across the required reload", () => {
  const local = memoryDataStorage();
  const tab = memoryDataStorage();
  const data = createBrowserData(local, tab);
  data.projectState(a).saveComments(comments);
  const backup = data.exportBackup();
  local.removeItem = () => {
    throw new Error("Cleanup denied");
  };
  expect(data.applyBackup(backup).cleanup).toBe("incomplete");
  const reloaded = createBrowserData(local, tab);
  expect(reloaded.readProblem()).toContain("Reviews were saved");
  expect(reloaded.projectState(a).readComments(path)).toEqual(comments);
});
