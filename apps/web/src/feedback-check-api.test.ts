import { expect, test } from "bun:test";
import { checkFeedbackSources } from "./feedback-check-api.ts";
import type { CommentAnchor } from "@git-review/shared/feedback-check";

const anchor: CommentAnchor = {
  kind: "file",
  source: "worktree",
  path: "odd β.txt",
  line: 1,
  sourceText: "source",
  before: null,
  after: null,
};
test("feedback check sends only bounded anchors and validates matches, stale and HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  let reply: Response = Response.json({ kind: "checked", matches: [true] });
  let calls = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      calls++;
      expect(String(input)).toContain("/api/project/feedback/check?");
      expect(options?.method).toBe("POST");
      expect(options?.cache).toBe("no-store");
      expect(JSON.parse(String(options?.body))).toEqual({ anchors: [anchor] });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return reply;
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    const signal = new AbortController().signal;
    expect(await checkFeedbackSources("/repo", [anchor], signal)).toEqual([true]);
    expect(calls).toBe(1);
    reply = Response.json({ kind: "stale" });
    await expect(checkFeedbackSources("/repo", [anchor], signal)).rejects.toThrow("files changed");
    reply = Response.json({ kind: "checked", matches: [] });
    await expect(checkFeedbackSources("/repo", [anchor], signal)).rejects.toThrow("do not match");
    reply = Response.json(
      { error: { code: "forbidden", message: "Could not check file" } },
      { status: 403 },
    );
    await expect(checkFeedbackSources("/repo", [anchor], signal)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
