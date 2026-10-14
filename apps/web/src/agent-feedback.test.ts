import { expect, test } from "bun:test";
import {
  formatAgentFeedback,
  projectReviewBackup,
  snapshotAgentFeedback,
} from "./agent-feedback.ts";
import { emptyCommentStore, type DraftComment } from "./comments.ts";
import { createBrowserData, memoryDataStorage } from "./browser-data.ts";

const a = { endpoint: "https://a.example.ts.net", projectPath: "/workspace/project" };
const b = { ...a, endpoint: "https://b.example.ts.net" };
const first: DraftComment = {
  id: "first",
  anchor: {
    kind: "file",
    source: "worktree",
    path: "notes.ts",
    line: 1,
    sourceText: "\tlast last 🦊",
    before: null,
    after: null,
  },
  subject: { kind: "selection", start: 6, end: 10, text: "last" },
  body: "Keep my question",
  createdAt: 1,
  updatedAt: 2,
  state: "current",
};
const stale: DraftComment = { ...first, id: "stale", body: "Outdated question", state: "outdated" };

test("agent output identifies ownership, recovery retains captured selections and checked output still excludes outdated drafts", () => {
  const original = [stale, first];
  const recovery = formatAgentFeedback(a, original, "recovery");
  expect(recovery).toContain('Agent: "https://a.example.ts.net"');
  expect(recovery).toContain('Review feedback for "/workspace/project"');
  expect(recovery).toContain('"\\tlast last 🦊"');
  expect(recovery).toContain('selected "last" (columns 7–10)');
  expect(recovery).toContain("Saved state: outdated; source freshness unverified");
  expect(recovery).toContain("Outdated question");
  expect(formatAgentFeedback(a, original, "checked")).not.toContain("Outdated question");
  expect(formatAgentFeedback(b, original, "recovery")).not.toContain(a.endpoint);
  const store = { ...emptyCommentStore(a.projectPath), drafts: original };
  expect(snapshotAgentFeedback(a, store, store).text).toBe(
    formatAgentFeedback(a, [first], "checked"),
  );
  expect(store.drafts).toEqual(original);
  expect(() => snapshotAgentFeedback({ ...a, projectPath: "/different" }, store, store)).toThrow(
    "different project",
  );
  expect(formatAgentFeedback(a, [], "recovery")).toBe("");
});

test("a project export keeps exact feedback/history and ownership without exporting another host at an equal path", () => {
  const data = createBrowserData(memoryDataStorage(), memoryDataStorage());
  const comments = {
    ...emptyCommentStore(a.projectPath),
    drafts: [first, stale],
    history: [{ id: "copy", copiedAt: 1, text: "Original  \r\n🦊\t", comments: [first] }],
  };
  data.projectState(a.endpoint).saveComments(comments);
  data.projectState(b.endpoint).saveComments({ ...comments, drafts: [] });
  const backup = projectReviewBackup(data.exportBackup(), a);
  expect(backup.reviews).toHaveLength(1);
  expect(backup.reviews[0]?.comments).toEqual(comments);
  expect(backup.catalog.projects.map((item) => item.endpoint)).toEqual([a.endpoint]);
  expect(backup.catalog.connections.every((item) => item.endpoint === a.endpoint)).toBe(true);
  expect(backup.catalog.workspaces).toEqual([]);
});
