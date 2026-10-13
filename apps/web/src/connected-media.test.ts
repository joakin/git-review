import { expect, test } from "bun:test";
import type { FileReadResult, DiffResult } from "@git-review/shared/api";
import { projectApiUrl } from "@git-review/shared/project-path";
import { connectDiffMedia, connectFileMedia } from "./connected-media.ts";
import { createAgentConnection } from "./agent-connection.ts";

const connection = createAgentConnection("https://agent.example");
const projectPath = "/workspace/odd : #?% 雪";
const path = "picture β.svg";
const revision = "a".repeat(20);
const commit = "b".repeat(40);
const media = (url: string) => ({
  kind: "image" as const,
  mimeType: "image/svg+xml" as const,
  byteLength: 100,
  url,
});
function file(
  url = projectApiUrl("/raw/file", projectPath, { path, version: revision }),
): FileReadResult {
  return { kind: "media", path, byteLength: 100, resource: media(url) };
}
function diff(url: string): DiffResult {
  return {
    kind: "media",
    old: { kind: "absent" },
    new: { kind: "ready", path, resource: media(url) },
  };
}

test("media is bound to the captured agent, including rename source paths and commit sides", () => {
  const working = connectFileMedia(connection, file(), projectPath, path);
  expect(working.kind === "media" && working.resource.url).toBe(
    "https://agent.example" + projectApiUrl("/raw/file", projectPath, { path, version: revision }),
  );
  const source = { kind: "diff" as const, projectPath, path, layer: "staged" as const, revision };
  const value: DiffResult = {
    kind: "media",
    old: {
      kind: "ready",
      path: "old name.svg",
      resource: media(
        projectApiUrl("/raw/diff", projectPath, {
          path,
          layer: "staged",
          revision,
          side: "old",
          version: commit,
        }),
      ),
    },
    new: { kind: "absent" },
  };
  const bound = connectDiffMedia(connection, value, source);
  expect(
    bound.kind === "media" &&
      bound.old.kind === "ready" &&
      bound.old.resource.url.startsWith(connection.endpoint),
  ).toBe(true);
  const inspected = connectDiffMedia(
    connection,
    diff(projectApiUrl("/raw/commit", projectPath, { path, commit, side: "new", version: commit })),
    { kind: "commit", projectPath, path, commit },
  );
  expect(
    inspected.kind === "media" &&
      inspected.new.kind === "ready" &&
      inspected.new.resource.url.startsWith(connection.endpoint),
  ).toBe(true);
});

test("working media rejects another project/path, route, version and duplicate or injected fields", () => {
  const valid = projectApiUrl("/raw/file", projectPath, { path, version: revision });
  for (const url of [
    projectApiUrl("/raw/file", "/other", { path, version: revision }),
    projectApiUrl("/raw/file", projectPath, { path: "other.svg", version: revision }),
    projectApiUrl("/raw/diff", projectPath, { path, version: revision }),
    projectApiUrl("/raw/file", projectPath, { path, version: commit }),
    projectApiUrl("/raw/file", projectPath, { path }),
    valid + "&version=" + revision,
    valid + "&projectPath=" + encodeURIComponent(projectPath),
    valid + "&extra=1",
    valid + "#fragment",
    "https://other.example" + valid,
  ])
    expect(() => connectFileMedia(connection, file(url), projectPath, path)).toThrow();
  expect(() =>
    connectFileMedia(connection, { ...file(), path: "other.svg" }, projectPath, path),
  ).toThrow("requested path");
});

test("diff descriptors cannot change their layer/revision/commit or swap sides", () => {
  const source = { kind: "diff" as const, projectPath, path, layer: "unstaged" as const, revision };
  const fields = { path, layer: "unstaged", revision, side: "new", version: revision };
  for (const changed of [
    { layer: "staged" },
    { revision: "c".repeat(20) },
    { side: "old" },
    { version: "invalid" },
  ])
    expect(() =>
      connectDiffMedia(
        connection,
        diff(projectApiUrl("/raw/diff", projectPath, { ...fields, ...changed })),
        source,
      ),
    ).toThrow();
  expect(() =>
    connectDiffMedia(
      connection,
      diff(
        projectApiUrl("/raw/commit", projectPath, {
          path,
          commit: "c".repeat(40),
          side: "new",
          version: commit,
        }),
      ),
      { kind: "commit", projectPath, path, commit },
    ),
  ).toThrow();
});
