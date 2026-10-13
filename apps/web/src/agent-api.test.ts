import { expect, test } from "bun:test";
import { createAgentConnection } from "./agent-connection.ts";
import { createAgentApi } from "./agent-api.ts";
import {
  changeDiffBatchSource,
  changeDiffRequestKey,
  parseChangeDiffBatchRequest,
} from "@git-review/shared/change-diff-batch";
import {
  commitDiffBatchSource,
  commitDiffRequestKey,
  parseCommitDiffBatchRequest,
} from "@git-review/shared/commit-diff-batch";
import { projectApiUrl } from "@git-review/shared/project-path";
import type { DiffResult } from "@git-review/shared/api";

const project = "/workspace/project";
const snapshot = { revision: "a".repeat(20), changeToken: "b".repeat(20), refreshKey: 0 };
const oid = "c".repeat(40);
const file = { layer: "unstaged" as const, path: "picture.svg", language: null };
const signal = () => new AbortController().signal;
function result(kind: "diff" | "commit", bytes: number): DiffResult {
  return {
    kind: "media",
    old: { kind: "absent" },
    new: {
      kind: "ready",
      path: file.path,
      resource: {
        kind: "image",
        mimeType: "image/svg+xml",
        byteLength: bytes,
        url: projectApiUrl(
          `/raw/${kind}`,
          project,
          kind === "diff"
            ? {
                path: file.path,
                layer: file.layer,
                revision: snapshot.revision,
                side: "new",
                version: snapshot.revision,
              }
            : { path: file.path, commit: oid, side: "new", version: oid },
        ),
      },
    },
  };
}

test("every API request family uses its chosen connection and fixed request policy", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const controller = new AbortController();
  const api = createAgentApi(
    createAgentConnection("https://agent-a.example", {
      fetch: async (url, init) => {
        expect(new URL(url).origin).toBe("https://agent-a.example");
        expect(init.credentials).toBe("omit");
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        calls.push({ path: new URL(url).pathname, method: init.method ?? "GET" });
        return Response.json(
          { error: { code: "forbidden", message: "Controlled endpoint response" } },
          { status: 403 },
        );
      },
    }),
  );
  const anchor = {
    kind: "file" as const,
    source: "worktree" as const,
    path: "review.txt",
    line: 1,
    sourceText: "line",
    before: null,
    after: null,
  };
  const operations = [
    () => api.fetchAgentInfo(controller.signal),
    () => api.fetchRoot(controller.signal),
    () => api.fetchDirectory("", controller.signal),
    () => api.lookupProject(project, controller.signal),
    () => api.fetchProjectTree(project, "", controller.signal),
    () => api.fetchProjectFile(project, "review.txt", null, controller.signal),
    () => api.fetchProjectStatus(project, controller.signal),
    () => api.fetchProjectChangeCheck(project, controller.signal),
    () => api.fetchLanguages(controller.signal),
    () =>
      api.fetchProjectDiff(project, "unstaged", "review.txt", snapshot, null, controller.signal),
    () => api.fetchProjectSearch(project, "literal", controller.signal),
    () => api.transcribeRecording(new Blob(["clip"], { type: "audio/wav" }), controller.signal),
    () => api.fetchGitRefs(project, controller.signal),
    () => api.fetchGitHistory(project, { kind: "ref", ref: "HEAD" }, controller.signal),
    () => api.fetchGitHistory(project, { kind: "page", tip: oid, offset: 50 }, controller.signal),
    () => api.fetchCommit(project, oid, controller.signal),
    () => api.fetchCommitDiff(project, oid, "review.txt", null, controller.signal),
    () => api.fetchChangeDiff(project, file, snapshot, controller.signal),
    () => api.checkFeedbackSources(project, [anchor], controller.signal),
    () =>
      api.checkContextAnchors(
        project,
        {
          revision: snapshot.revision,
          changeToken: snapshot.changeToken,
          layer: "unstaged",
          path: "review.txt",
          language: null,
        },
        [{ side: "new", line: 1, sourceText: "line", before: null, after: null }],
        controller.signal,
      ),
    () =>
      api.fetchDiffContext(
        project,
        {
          kind: "check",
          revision: snapshot.revision,
          changeToken: snapshot.changeToken,
          layer: "unstaged",
          path: "review.txt",
          language: null,
          anchors: [{ side: "new", line: 1, sourceText: "line", before: null, after: null }],
        },
        null,
        controller.signal,
      ),
  ];
  for (const operation of operations)
    await expect(operation()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  expect(calls.length).toBe(operations.length);
  expect(calls.filter(({ method }) => method === "POST").length).toBe(6);
});

test("identical project/snapshot/commit keys on two agents never merge queued requests or fallbacks", async () => {
  const calls: Array<{ agent: string; path: string }> = [];
  function api(agent: string, bytes: number) {
    return createAgentApi(
      createAgentConnection(`https://${agent}.example`, {
        fetch: async (input, init) => {
          const url = new URL(input);
          calls.push({ agent, path: url.pathname });
          if (url.pathname === "/api/project/diffs") {
            const request = parseChangeDiffBatchRequest(JSON.parse(String(init.body)) as unknown);
            return Response.json({
              kind: "ready",
              source: changeDiffBatchSource(project, request.revision, request.changeToken),
              results: request.files.map((file) => ({
                key: changeDiffRequestKey(file),
                kind: agent === "a" ? "deferred" : "ready",
                ...(agent === "a" ? {} : { value: result("diff", bytes) }),
              })),
            });
          }
          if (url.pathname.endsWith("/diffs")) {
            const request = parseCommitDiffBatchRequest(JSON.parse(String(init.body)) as unknown);
            return Response.json({
              kind: "ready",
              source: commitDiffBatchSource(project, oid),
              results: request.map((file) => ({
                key: commitDiffRequestKey(file),
                kind: agent === "a" ? "deferred" : "ready",
                ...(agent === "a" ? {} : { value: result("commit", bytes) }),
              })),
            });
          }
          return Response.json(result(url.pathname.includes("/git/") ? "commit" : "diff", bytes));
        },
      }),
    );
  }
  const a = api("a", 100);
  const b = api("b", 200);
  const pendingA = a.fetchChangeDiff(project, file, snapshot, signal());
  const pendingB = b.fetchChangeDiff(project, file, snapshot, signal());
  const values = await Promise.all([
    pendingA,
    pendingB,
    a.fetchCommitDiff(project, oid, file.path, null, signal()),
    b.fetchCommitDiff(project, oid, file.path, null, signal()),
  ]);
  for (const [index, value] of values.entries()) {
    if (value.kind !== "media" || value.new.kind !== "ready")
      throw new Error("Expected media diff");
    const agent = index % 2 === 0 ? "a" : "b";
    expect(value.new.resource.url.startsWith(`https://${agent}.example/`)).toBe(true);
    expect(value.new.resource.byteLength).toBe(agent === "a" ? 100 : 200);
  }
  expect(
    calls
      .filter(({ path }) => path === "/api/project/diffs")
      .map(({ agent }) => agent)
      .sort(),
  ).toEqual(["a", "b"]);
  expect(
    calls
      .filter(({ path }) => path === `/api/project/git/commits/${oid}/diff`)
      .map(({ agent }) => agent),
  ).toEqual(["a"]);
  expect(
    calls.filter(({ path }) => path === "/api/project/diff").map(({ agent }) => agent),
  ).toEqual(["a"]);
  expect(
    calls
      .filter(({ path }) => path.endsWith("/diffs") && path !== "/api/project/diffs")
      .map(({ agent }) => agent)
      .sort(),
  ).toEqual(["a", "b"]);
  const aborted = new AbortController();
  aborted.abort();
  const before = calls.length;
  await expect(a.fetchChangeDiff(project, file, snapshot, aborted.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(
    a.fetchCommitDiff(project, oid, file.path, null, aborted.signal),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(calls.length).toBe(before);
});
