import { expect, spyOn, test } from "bun:test";
import {
  parseChangeDiffBatchRequest,
  changeDiffBatchSource,
  changeDiffRequestKey,
  type ChangeDiffRequest,
} from "@git-review/shared/change-diff-batch";
import { fetchChangeDiff } from "./change-diff-api.ts";

test("one stale batch delivers stale to every requested layer", async () => {
  const snapshot = { revision: "a".repeat(20), changeToken: "b".repeat(20), refreshKey: 0 };
  const files: ChangeDiffRequest[] = [
    { layer: "staged", path: "same.ts", language: null },
    { layer: "unstaged", path: "same.ts", language: null },
  ];
  let calls = 0;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[_url, init]: Parameters<typeof globalThis.fetch>) => {
        calls += 1;
        const request = parseChangeDiffBatchRequest(JSON.parse(String(init?.body)) as unknown);
        expect(request).toEqual({
          revision: snapshot.revision,
          changeToken: snapshot.changeToken,
          files,
        });
        return Response.json({
          kind: "stale",
          source: changeDiffBatchSource("/repo/project", request.revision, request.changeToken),
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    expect(
      await Promise.all(
        files.map((file) =>
          fetchChangeDiff("/repo/project", file, snapshot, new AbortController().signal),
        ),
      ),
    ).toEqual([{ kind: "stale" }, { kind: "stale" }]);
    expect(calls).toBe(1);
  } finally {
    fetch.mockRestore();
  }
});

test("deferred Changes reads keep both snapshot tokens on the individual fallback", async () => {
  const snapshot = { revision: "c".repeat(20), changeToken: "d".repeat(20), refreshKey: 1 };
  const file = {
    layer: "unstaged",
    path: "odd\n[1].ts",
    language: "text",
  } satisfies ChangeDiffRequest;
  let fallback = false;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[input, init]: Parameters<typeof globalThis.fetch>) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
          "http://localhost",
        );
        if (url.pathname.endsWith("/diffs"))
          return Response.json({
            kind: "ready",
            source: changeDiffBatchSource("/repo/project", snapshot.revision, snapshot.changeToken),
            results: [{ key: changeDiffRequestKey(file), kind: "deferred" }],
          });
        fallback = true;
        expect(url.pathname).toBe("/api/project/diff");
        expect(Object.fromEntries(url.searchParams)).toEqual({
          projectPath: "/repo/project",
          layer: file.layer,
          path: file.path,
          language: file.language,
          revision: snapshot.revision,
          changeToken: snapshot.changeToken,
        });
        expect(init?.signal?.aborted).toBe(false);
        return Response.json({ kind: "stale" });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    expect(
      await fetchChangeDiff("/repo/project", file, snapshot, new AbortController().signal),
    ).toEqual({
      kind: "stale",
    });
    expect(fallback).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});
