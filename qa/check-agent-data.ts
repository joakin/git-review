import { resolve } from "node:path";
import type { AgentBackup, SavedAgentReview } from "../apps/web/src/agent-data-format.ts";
import { emptyAgentCatalog, serializeAgentBackup } from "../apps/web/src/agent-data-format.ts";
import { emptyCommentStore } from "../apps/web/src/comments.ts";
import { agentCatalogStorageKey } from "../apps/web/src/agent-data.ts";
import { projectResourceKey } from "../apps/web/src/agent-project.ts";
import { withQaBrowser, withQaContext } from "./browser-support.ts";
import type {} from "./agent-data-browser.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
function review(endpoint: string, projectPath: string): SavedAgentReview {
  const draft = {
    id: "draft",
    body: "Saved feedback for " + endpoint,
    createdAt: 1,
    updatedAt: 2,
    state: "current" as const,
    anchor: {
      kind: "file" as const,
      source: "worktree" as const,
      path: "review.ts",
      line: 1,
      sourceText: "const saved = true;",
      before: null,
      after: null,
    },
    subject: { kind: "line" as const },
  };
  return {
    version: 1,
    project: { endpoint, projectPath, name: "Saved review", location: { kind: "unknown-root" } },
    comments: {
      ...emptyCommentStore(projectPath),
      drafts: [draft],
      history: [
        { id: "copy", copiedAt: 3, text: "Exact copied text  \r\n🦊\t", comments: [draft] },
      ],
    },
    preferences: { openCards: [], languages: [] },
  };
}
const reviews = [
  review("https://agent-a.example.ts.net", "/cloud/project"),
  review("https://agent-b.example.ts.net", "/cloud/project"),
  review("https://removed.example.ts.net", "/old/root/project"),
];
const initial: AgentBackup = {
  format: "git-review-agent-backup",
  version: 1,
  catalog: {
    ...emptyAgentCatalog(),
    projects: reviews.map((review) => review.project),
    connections: [{ endpoint: "https://agent-a.example.ts.net", label: "A" }],
    workspaces: [
      { endpoint: "https://agent-a.example.ts.net", rootPath: "/cloud", recentPaths: [] },
    ],
  },
  reviews,
};
const expected = serializeAgentBackup({
  ...initial,
  reviews: [...initial.reviews].sort((left, right) =>
    projectResourceKey(left.project).localeCompare(projectResourceKey(right.project)),
  ),
});
const built = await Bun.build({
  entrypoints: [resolve("qa/agent-data-browser.ts")],
  target: "browser",
  minify: true,
});
assert(built.success, built.logs.map(String).join("\n"));
const bundle = built.outputs[0];
assert(bundle !== undefined, "Missing QA foundation bundle");
const script = await bundle.text();
function startServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/foundation.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      return new Response(
        '<!doctype html><title>Agent data QA</title><script type="module" src="/foundation.js"></script>',
        {
          headers: {
            "content-type": "text/html",
            "content-security-policy": "default-src 'self'; connect-src 'none'",
          },
        },
      );
    },
  });
}
const firstServer = startServer();
const secondServer = startServer();
try {
  await withQaBrowser(async (browser) => {
    await withQaContext(browser, { serviceWorkers: "block" }, async (context) => {
      const first = await context.newPage();
      const requests: string[] = [];
      context.on("request", (request) => {
        if (
          ![firstServer.url.origin, secondServer.url.origin].includes(new URL(request.url()).origin)
        )
          requests.push(request.url());
      });
      await first.goto(firstServer.url.href);
      await first.waitForFunction(() => window.agentDataQa !== undefined);
      await first.evaluate((backup) => {
        localStorage.setItem("git-review:comments:v3:legacy", "keep legacy");
        const repository = window.agentDataQa.open();
        repository.applyBackup(backup);
      }, initial);
      await first.reload();
      await first.waitForFunction(() => window.agentDataQa !== undefined);
      const afterReload = await first.evaluate(() =>
        window.agentDataQa.serialize(window.agentDataQa.open().exportBackup()),
      );
      assert(afterReload === expected, "Reload lost endpoint-owned reviews");
      await context.setOffline(true);
      const exported = await first.evaluate(() =>
        window.agentDataQa.serialize(window.agentDataQa.open().exportBackup()),
      );
      assert(exported === expected, "Offline export lost saved data");
      await context.setOffline(false);

      // A distinct browser origin cannot read source storage; transfer only the exported document.
      const second = await context.newPage();
      await second.goto(secondServer.url.href);
      await second.waitForFunction(() => window.agentDataQa !== undefined);
      assert(
        await second.evaluate(() => localStorage.length === 0),
        "Destination unexpectedly inherited origin storage",
      );
      const transferred = await second.evaluate((text) => {
        const repository = window.agentDataQa.open();
        repository.applyBackup(window.agentDataQa.parse(text));
        return window.agentDataQa.serialize(repository.exportBackup());
      }, exported);
      assert(transferred === exported, "Origin transfer changed saved data");

      // Fill actual Web Storage until the browser rejects a write, then try a larger staged record.
      const quota = await second.evaluate(
        ({ headKey, initial }) => {
          const repository = window.agentDataQa.open();
          const before = window.agentDataQa.serialize(repository.exportBackup());
          const head = localStorage.getItem(headKey);
          let filled = 0;
          let quotaName = "";
          try {
            for (; filled < 200; filled += 1)
              localStorage.setItem("qa-fill:" + filled, "x".repeat(100_000));
          } catch (error) {
            if (!(error instanceof DOMException)) throw error;
            quotaName = error.name;
          }
          const incoming = structuredClone(initial);
          const history = incoming.reviews[0]?.comments.history[0];
          if (history === undefined) throw new Error("Missing QA history");
          history.text = "z".repeat(200_000);
          let failed = false;
          try {
            repository.applyBackup(incoming);
          } catch {
            failed = true;
          }
          const unchanged =
            localStorage.getItem(headKey) === head &&
            window.agentDataQa.serialize(repository.exportBackup()) === before;
          for (let index = 0; index < filled; index += 1)
            localStorage.removeItem("qa-fill:" + index);
          return { quotaName, failed, unchanged };
        },
        { headKey: agentCatalogStorageKey, initial },
      );
      assert(
        quota.quotaName === "QuotaExceededError" && quota.failed && quota.unchanged,
        "Real browser quota failure changed the active generation: " + JSON.stringify(quota),
      );
      assert(
        await first.evaluate(
          () => localStorage.getItem("git-review:comments:v3:legacy") === "keep legacy",
        ),
        "The foundation touched legacy storage",
      );
      assert(
        requests.length === 0,
        "Foundation attempted network requests: " + requests.join(", "),
      );
    });
  });
  console.log(
    "Agent data browser check passed: reload, offline export, origin transfer, real quota failure, and legacy preservation.",
  );
} finally {
  firstServer.stop(true);
  secondServer.stop(true);
}
