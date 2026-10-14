import { expect, test } from "bun:test";
import {
  emptyAgentCatalog,
  maxAgentBackupBytes,
  parseAgentBackup,
  parseAgentBackupText,
  parseAgentCatalog,
  maxRecentProjects,
  serializeAgentBackup,
  type AgentBackup,
  type SavedAgentProject,
  type SavedAgentReview,
} from "./agent-data-format.ts";
import {
  agentCatalogStorageKey,
  agentReviewStoragePrefix,
  createAgentDataRepository,
} from "./agent-data.ts";
import {
  emptyCommentStore,
  rangeSubject,
  type DraftComment,
  type RangeSelectionPart,
} from "./comments.ts";
import { projectResourceKey } from "./agent-project.ts";
import { withTestStorage } from "./storage-test-support.ts";

const endpointA = "https://agent-a.example.ts.net";
const endpointB = "https://agent-b.example.ts.net";
const projectPath = "/workspace/project : #?% 雪";
function project(endpoint = endpointA, path = projectPath): SavedAgentProject {
  return {
    endpoint,
    projectPath: path,
    name: "Saved project 雪",
    location: { kind: "unknown-root" },
  };
}
function rangePart(side: "old" | "new"): RangeSelectionPart {
  const sources = ["\tconst 🦊 = 1;", "", "last last  "];
  const text = sources.join("\n");
  return {
    anchors: sources.map((sourceText, index) => ({
      kind: "diff",
      layer: "unstaged",
      side,
      path: "src/雪.ts",
      line: index + 1,
      sourceText,
      before: sources[index - 1] ?? null,
      after: sources[index + 1] ?? null,
    })),
    start: 1,
    end: text.length - 5,
    text: text.slice(1, -5),
  };
}
function review(endpoint = endpointA, path = projectPath): SavedAgentReview {
  const subject = rangeSubject([rangePart("old"), rangePart("new")]);
  const anchor = subject?.parts[0]?.anchors[0];
  if (subject === null || anchor === undefined) throw new Error("Invalid test fixture");
  const range: DraftComment = {
    id: "range",
    anchor,
    subject,
    body: "Range feedback for " + endpoint + "  \n",
    createdAt: 1,
    updatedAt: 2,
    state: "current",
  };
  const file: DraftComment = {
    ...range,
    id: "file",
    anchor: {
      kind: "file",
      source: "worktree",
      path: "src/雪.ts",
      line: 3,
      sourceText: "last last  ",
      before: "",
      after: null,
    },
    subject: { kind: "selection", start: 5, end: 9, text: "last" },
    state: "outdated",
  };
  return {
    version: 1,
    project: project(endpoint, path),
    comments: {
      ...emptyCommentStore(path),
      drafts: [range, file],
      history: [{ id: "copy", copiedAt: 3, text: "Exact history\r\n  🦊\n\t", comments: [range] }],
    },
    preferences: {
      openCards: ["unstaged:src/雪.ts"],
      languages: [{ path: "odd : #?% 雪.ts", language: "text" }],
    },
  };
}
function backup(reviews = [review(), review(endpointB)]): AgentBackup {
  return {
    format: "git-review-agent-backup",
    version: 1,
    catalog: {
      ...emptyAgentCatalog(),
      connections: [
        { endpoint: endpointA, label: "A" },
        { endpoint: endpointB, label: "B" },
      ],
      projects: reviews.map((item) => item.project),
      workspaces: [
        { endpoint: endpointA, rootPath: "/workspace", recentPaths: ["project : #?% 雪", ""] },
        { endpoint: endpointB, rootPath: "/workspace", recentPaths: ["other"] },
      ],
      global: {
        wrap: false,
        appearance: { version: 1, appTheme: "system", codeTheme: "dark" },
        codeTypography: { version: 1, fontSize: 16, fontFamily: "jetbrains-mono" },
      },
    },
    reviews,
  };
}
function allStorage(storage: Storage): [string | null, string | null][] {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return [key, key === null ? null : storage.getItem(key)];
  });
}

test("older catalogs seed unified recents from all roots without altering their source", () => {
  const { recentProjects: omitted, ...old } = emptyAgentCatalog();
  const value = {
    ...old,
    projects: [project(endpointA, "/workspace/project")],
    workspaces: [
      { endpoint: endpointA, rootPath: "/workspace", recentPaths: ["project", ""] },
      { endpoint: endpointB, rootPath: "/", recentPaths: ["project"] },
      { endpoint: endpointA, rootPath: "/", recentPaths: ["workspace/project"] },
    ],
  };
  const original = JSON.stringify(value);
  expect(parseAgentCatalog(value).recentProjects).toEqual([
    { endpoint: endpointA, projectPath: "/workspace/project" },
    { endpoint: endpointB, projectPath: "/project" },
    { endpoint: endpointA, projectPath: "/workspace" },
  ]);
  expect(JSON.stringify(value)).toBe(original);
  expect(parseAgentCatalog({ ...value, recentProjects: [] }).recentProjects).toEqual([]);
});

test("unified recent references reject invalid addresses, paths, duplicates and oversized lists", () => {
  for (const recentProjects of [
    [{ endpoint: endpointA, projectPath: "/workspace/../escape" }],
    [{ endpoint: "https://agent.example/api", projectPath }],
    [
      { endpoint: endpointA, projectPath },
      { endpoint: endpointA + "/", projectPath },
    ],
    Array.from({ length: maxRecentProjects + 1 }, (_, index) => ({
      endpoint: endpointA,
      projectPath: `/workspace/project-${index}`,
    })),
    null,
  ])
    expect(() => parseAgentCatalog({ ...emptyAgentCatalog(), recentProjects })).toThrow();
});

test("agent backups retain endpoint ownership, mixed ranges, repeated quotes and exact history", () => {
  const original = backup();
  expect(parseAgentBackupText(serializeAgentBackup(original))).toEqual(original);
  expect(projectResourceKey(project())).not.toBe(projectResourceKey(project(endpointB)));
  expect(parseAgentBackup({ ...original, catalog: { ...original.catalog, projects: [] } })).toEqual(
    original,
  );
  const known = review();
  known.project.location = {
    kind: "known-root",
    rootPath: "/workspace",
    relativePath: "project : #?% 雪",
  };
  expect(parseAgentBackup(backup([known]))).toEqual(backup([known]));
});

test("agent backups reject duplicate and conflicting ownership before writes", () => {
  const valid = backup();
  const first = review();
  for (const patch of [
    { reviews: [first, first] },
    { reviews: [first, { ...first, project: { ...first.project, endpoint: endpointA + "/" } }] },
    {
      catalog: {
        ...valid.catalog,
        connections: [
          ...valid.catalog.connections,
          { endpoint: "https://AGENT-A.example.ts.net:443/", label: "Alias" },
        ],
      },
    },
    { catalog: { ...valid.catalog, projects: [first.project, first.project] } },
    {
      catalog: {
        ...valid.catalog,
        workspaces: [...valid.catalog.workspaces, ...valid.catalog.workspaces],
      },
    },
    { reviews: [{ ...first, comments: { ...first.comments, projectPath: "/different/project" } }] },
    { catalog: { ...valid.catalog, projects: [{ ...first.project, name: "Conflicting name" }] } },
    {
      reviews: [
        {
          ...first,
          project: {
            ...first.project,
            location: { kind: "known-root", rootPath: "/outside", relativePath: "project" },
          },
        },
      ],
    },
    {
      reviews: [
        {
          ...first,
          preferences: {
            ...first.preferences,
            languages: [...first.preferences.languages, ...first.preferences.languages],
          },
        },
      ],
    },
    {
      reviews: [
        {
          ...first,
          comments: {
            ...first.comments,
            history: [...first.comments.history, ...first.comments.history],
          },
        },
      ],
    },
  ]) {
    expect(() => parseAgentBackup({ ...valid, ...patch })).toThrow();
    withTestStorage((local) => {
      const repository = createAgentDataRepository(local);
      repository.applyBackup(valid);
      const before = allStorage(local);
      expect(() => repository.applyBackup({ ...valid, ...patch })).toThrow();
      expect(allStorage(local)).toEqual(before);
    });
  }
});

test("agent records validate origins, paths, preferences, ranges, labels and bounded formats", () => {
  const first = review();
  for (const endpoint of [
    "http://private.example",
    "https://a.example/api",
    "https://user:secret@a.example",
    "https://a.example?token=secret",
    "https://a.example#part",
    "javascript:alert(1)",
  ])
    expect(() =>
      parseAgentBackup(backup([{ ...first, project: { ...first.project, endpoint } }])),
    ).toThrow();
  for (const projectPath of [
    "relative",
    "/workspace/../other",
    "/workspace//project",
    "/workspace/project/",
    "/workspace/\ud800",
  ])
    expect(() =>
      parseAgentBackup(backup([{ ...first, project: { ...first.project, projectPath } }])),
    ).toThrow();
  for (const patch of [
    { version: 2 },
    { format: "git-review" },
    { catalog: { ...backup().catalog, version: 2 } },
    { catalog: { ...backup().catalog, connections: [{ endpoint: endpointA, label: "\n" }] } },
    { catalog: { ...backup().catalog, projects: Array(513).fill(first.project) } },
    { catalog: { ...backup().catalog, global: { ...backup().catalog.global, wrap: "yes" } } },
    {
      catalog: {
        ...backup().catalog,
        global: {
          ...backup().catalog.global,
          codeTypography: { version: 1, fontSize: 30, fontFamily: "system" },
        },
      },
    },
    {
      catalog: {
        ...backup().catalog,
        workspaces: [
          { endpoint: endpointA, rootPath: "/workspace", recentPaths: Array(9).fill("project") },
        ],
      },
    },
    { reviews: [{ ...first, preferences: { ...first.preferences, openCards: ["same", "same"] } }] },
    {
      reviews: [
        {
          ...first,
          preferences: {
            ...first.preferences,
            languages: [{ path: "../escape", language: "text" }],
          },
        },
      ],
    },
    {
      reviews: [
        {
          ...first,
          comments: {
            ...first.comments,
            drafts: [
              {
                ...first.comments.drafts[0],
                subject: { kind: "selection", start: 0, end: 4, text: "wrong" },
              },
            ],
          },
        },
      ],
    },
  ])
    expect(() => parseAgentBackup({ ...backup(), ...patch })).toThrow();
  const loopback = backup([review("http://localhost:1234")]);
  expect(parseAgentBackup(loopback)).toEqual(loopback);
  expect(() => parseAgentBackupText("🦊".repeat(maxAgentBackupBytes / 4 + 1))).toThrow("25 MiB");
});

test("local-only export includes unreachable, removed and out-of-root projects without touching legacy data", () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(
    () => {
      requests += 1;
      throw new Error("All agents are offline");
    },
    { preconnect: previousFetch.preconnect },
  );
  try {
    withTestStorage((local) => {
      const legacy = [
        "unrelated",
        "git-review:comments:v3:legacy",
        "git-review:workspace:v4",
        "git-review:appearance:v1",
      ];
      for (const key of legacy) local.setItem(key, "legacy value");
      const repository = createAgentDataRepository(local);
      const initial = backup([review(), review(endpointB), review(endpointA, "/old/root/project")]);
      repository.applyBackup(initial);
      repository.saveCatalog({ ...initial.catalog, connections: [] });
      expect(repository.exportBackup()).toEqual({
        ...initial,
        catalog: { ...initial.catalog, connections: [] },
      });
      for (const key of legacy) expect(local.getItem(key)).toBe("legacy value");
      expect(requests).toBe(0);
      const exported = serializeAgentBackup(repository.exportBackup());
      withTestStorage((destination) => {
        const target = createAgentDataRepository(destination);
        target.applyBackup(parseAgentBackupText(exported));
        expect(serializeAgentBackup(target.exportBackup())).toBe(exported);
      });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("equal canonical paths persist independently across repository reloads", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.saveReview(review());
    repository.saveReview(review(endpointB));
    const reloaded = createAgentDataRepository(local);
    expect(reloaded.readReview(project())).toEqual(review());
    expect(reloaded.readReview(project(endpointB))).toEqual(review(endpointB));
    expect(reloaded.readReview(project(endpointA, "/missing"))).toBeNull();
    expect(reloaded.exportBackup().catalog.projects).toEqual([project(), project(endpointB)]);
  });
});

test("saved-project reconciliation recovers a failed index update without changing connections or recents", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    const initial = backup([]);
    repository.applyBackup(initial);
    const setItem = local.setItem;
    local.setItem = (key, value) => {
      if (key === agentCatalogStorageKey) throw new Error("Quota");
      setItem(key, value);
    };
    expect(() => repository.saveReview(review())).toThrow("review was saved");
    expect(repository.readReview(project())).toEqual(review());
    expect(repository.exportBackup().catalog.projects).toEqual([project()]);
    expect(repository.exportBackup().catalog.connections).toEqual(initial.catalog.connections);
    expect(repository.exportBackup().catalog.workspaces).toEqual(initial.catalog.workspaces);
    local.setItem = setItem;
    expect(repository.reconcile().projects).toEqual([project()]);
    const head: unknown = JSON.parse(local.getItem(agentCatalogStorageKey) ?? "null");
    expect(head).toMatchObject({ catalog: { projects: [project()] } });
    local.setItem = (key, value) => {
      if (key === agentCatalogStorageKey) throw new Error("Quota");
      setItem(key, value);
    };
    const changed = { ...review(), project: { ...project(), name: "Updated name" } };
    expect(() => repository.saveReview(changed)).toThrow("review was saved");
    expect(repository.exportBackup().catalog.projects).toEqual([changed.project]);
  });
});

test("malformed active storage and key ownership stop export while preserving the original records", () => {
  for (const mutation of [
    (local: Storage, key: string) => local.setItem(key, "{broken"),
    (local: Storage, key: string) => local.setItem(key, JSON.stringify(review(endpointB))),
    (local: Storage, key: string) => local.setItem(key + "%XX", JSON.stringify(review())),
    (local: Storage) => local.setItem(agentCatalogStorageKey, '{"version":99}'),
  ])
    withTestStorage((local) => {
      const repository = createAgentDataRepository(local);
      repository.saveReview(review());
      const key = allStorage(local).find(([key]) => key?.startsWith(agentReviewStoragePrefix))?.[0];
      if (key === undefined || key === null) throw new Error("Missing fixture key");
      mutation(local, key);
      const before = allStorage(local);
      expect(() => repository.exportBackup()).toThrow();
      expect(allStorage(local)).toEqual(before);
    });
});

test("import replaces matching owners, merges unrelated projects and preferences, and preserves legacy storage", () => {
  withTestStorage((local) => {
    local.setItem("git-review:comments:v3:legacy", "retain");
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const added = review(endpointA, "/new/project");
    const replaced = { ...review(), preferences: { openCards: [], languages: [] } };
    const incoming = backup([added, replaced]);
    incoming.catalog.connections = [{ endpoint: endpointA, label: "Renamed" }];
    incoming.catalog.workspaces = [
      { endpoint: endpointA, rootPath: "/new", recentPaths: ["project"] },
    ];
    incoming.catalog.global.wrap = true;
    expect(repository.applyBackup(incoming)).toEqual({ cleanup: "complete" });
    const exported = repository.exportBackup();
    expect(exported.reviews).toEqual([replaced, review(endpointB), added]);
    expect(exported.catalog.connections).toEqual([
      { endpoint: endpointA, label: "Renamed" },
      { endpoint: endpointB, label: "B" },
    ]);
    expect(exported.catalog.workspaces).toHaveLength(3);
    expect(exported.catalog.global.wrap).toBe(true);
    expect(local.getItem("git-review:comments:v3:legacy")).toBe("retain");
    expect(
      allStorage(local).filter(([key]) => key?.startsWith(agentReviewStoragePrefix)),
    ).toHaveLength(3);
  });
});

test("denied reads, listing, saves and quota failures are explicit and never erase the prior review", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.saveReview(review());
    const before = repository.exportBackup();
    const getItem = local.getItem;
    local.getItem = () => {
      throw new Error("Denied");
    };
    expect(() => repository.readAll()).toThrow("unavailable");
    local.getItem = getItem;
    const key = local.key;
    local.key = () => {
      throw new Error("Denied");
    };
    expect(() => repository.exportBackup()).toThrow("could not be listed");
    local.key = key;
    const setItem = local.setItem;
    local.setItem = () => {
      throw new Error("Quota");
    };
    expect(() =>
      repository.saveReview({ ...review(), preferences: { openCards: [], languages: [] } }),
    ).toThrow("could not save");
    expect(() => repository.applyBackup(backup())).toThrow("could not save");
    local.setItem = setItem;
    expect(repository.exportBackup()).toEqual(before);
  });
});

test("failed or interrupted import staging and catalog publication retain the active generation", () => {
  for (const failureAt of [1, 2, 3])
    withTestStorage((local) => {
      const repository = createAgentDataRepository(local);
      repository.applyBackup(backup());
      const before = repository.exportBackup();
      const head = local.getItem(agentCatalogStorageKey);
      const setItem = local.setItem;
      let writes = 0;
      local.setItem = (key, value) => {
        if (++writes === failureAt) throw new Error("Interrupted");
        setItem(key, value);
      };
      const incoming = backup();
      incoming.catalog.global.wrap = true;
      expect(() => repository.applyBackup(incoming)).toThrow();
      local.setItem = setItem;
      expect(local.getItem(agentCatalogStorageKey)).toBe(head);
      expect(createAgentDataRepository(local).exportBackup()).toEqual(before);
      expect(repository.applyBackup(incoming)).toEqual({ cleanup: "complete" });
      expect(repository.exportBackup()).toEqual(incoming);
    });
});

test("unpublished staging is ignored after interruption; successful imports report failed cleanup", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const prefix = agentReviewStoragePrefix + "a".repeat(32) + ":";
    local.setItem(prefix + "interrupted", "corrupt staged data");
    expect(repository.exportBackup()).toEqual(backup());
    const removeItem = local.removeItem;
    local.removeItem = () => {
      throw new Error("Denied cleanup");
    };
    expect(repository.applyBackup(backup())).toEqual({ cleanup: "incomplete" });
    expect(repository.exportBackup()).toEqual(backup());
    local.removeItem = removeItem;
    expect(repository.applyBackup(backup())).toEqual({ cleanup: "complete" });
    expect(
      allStorage(local).filter(([key]) => key?.startsWith(agentReviewStoragePrefix)),
    ).toHaveLength(2);
  });
});

test("unverified writes cannot publish a new import generation", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const head = local.getItem(agentCatalogStorageKey);
    const setItem = local.setItem;
    local.setItem = (key, value) => {
      if (key === agentCatalogStorageKey) setItem(key, value);
    };
    expect(() => repository.applyBackup(backup())).toThrow("could not save");
    expect(local.getItem(agentCatalogStorageKey)).toBe(head);
    expect(repository.exportBackup()).toEqual(backup());
  });
});

test("metadata-only import updates matching saved metadata without discarding its review or preferences", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const metadata = { ...project(), name: "New display name" };
    const incoming = { ...backup([]), catalog: { ...backup([]).catalog, projects: [metadata] } };
    repository.applyBackup(incoming);
    expect(repository.readReview(project())).toEqual({ ...review(), project: metadata });
    expect(repository.readReview(project(endpointB))).toEqual(review(endpointB));
    expect(repository.exportBackup().catalog.projects).toEqual([metadata, project(endpointB)]);
  });
});

test("saved projects remain indexed independently of the eight-entry root recents list", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    const catalog = emptyAgentCatalog();
    catalog.workspaces = [
      {
        endpoint: endpointA,
        rootPath: "/workspace",
        recentPaths: Array.from({ length: 8 }, (_, index) => "project-" + index),
      },
    ];
    repository.saveCatalog(catalog);
    for (let index = 0; index < 10; index += 1)
      repository.saveReview(review(endpointA, "/workspace/project-" + index));
    const reloaded = createAgentDataRepository(local).exportBackup();
    expect(reloaded.catalog.projects).toHaveLength(10);
    expect(reloaded.reviews).toHaveLength(10);
    expect(reloaded.catalog.workspaces).toEqual(catalog.workspaces);
  });
});

test("oversized valid backups are rejected before any import write", () => {
  const reviews = Array.from({ length: 7 }, (_, index): SavedAgentReview => ({
    ...review(endpointA, "/workspace/project-" + index),
    comments: {
      ...emptyCommentStore("/workspace/project-" + index),
      history: Array.from({ length: 20 }, (_, copy) => ({
        id: "copy-" + copy,
        copiedAt: copy,
        text: "x".repeat(200_000),
        comments: [],
      })),
    },
  }));
  const oversized = backup(reviews);
  expect(() => serializeAgentBackup(oversized)).toThrow("25 MiB");
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const before = allStorage(local);
    expect(() => repository.applyBackup(oversized)).toThrow("25 MiB");
    expect(allStorage(local)).toEqual(before);
  });
});

test("uncertain publication and denied catalog restoration retain both recoverable generations", () => {
  withTestStorage((local) => {
    const repository = createAgentDataRepository(local);
    repository.applyBackup(backup());
    const previousHead = local.getItem(agentCatalogStorageKey);
    const setItem = local.setItem;
    const getItem = local.getItem;
    let published = false;
    let denyVerification = true;
    local.setItem = (key, value) => {
      if (key === agentCatalogStorageKey && published) throw new Error("Restoration denied");
      setItem(key, value);
      if (key === agentCatalogStorageKey) published = true;
    };
    local.getItem = (key) => {
      if (key === agentCatalogStorageKey && published && denyVerification) {
        denyVerification = false;
        throw new Error("Verification denied");
      }
      return getItem(key);
    };
    const incoming = backup();
    incoming.catalog.global.wrap = true;
    expect(() => repository.applyBackup(incoming)).toThrow("Both generations were retained");
    local.setItem = setItem;
    local.getItem = getItem;
    expect(local.getItem(agentCatalogStorageKey)).not.toBe(previousHead);
    expect(createAgentDataRepository(local).exportBackup()).toEqual(incoming);
    expect(
      allStorage(local).filter(([key]) => key?.startsWith(agentReviewStoragePrefix)),
    ).toHaveLength(4);
  });
});
