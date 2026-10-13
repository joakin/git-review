import { createAgentConnection } from "../apps/web/src/agent-connection.ts";
import { createAgentApi, type AgentApi } from "../apps/web/src/agent-api.ts";

declare const __QA_AGENT_A__: string;
declare const __QA_AGENT_B__: string;
declare const __QA_PROJECT__: string;
declare const __QA_COMMIT__: string;

const connectionA = createAgentConnection(__QA_AGENT_A__, { allowLoopbackHttp: true });
const connectionB = createAgentConnection(__QA_AGENT_B__, { allowLoopbackHttp: true });
const apiA = createAgentApi(connectionA);
const apiB = createAgentApi(connectionB);

async function exercise(api: AgentApi): Promise<void> {
  const project = __QA_PROJECT__;
  const signal = new AbortController().signal;
  const info = await api.fetchAgentInfo(signal);
  if (info.kind !== "compatible") throw new Error("Incompatible fixture agent");
  await api.fetchRoot(signal);
  await api.fetchDirectory("", signal);
  await api.lookupProject(project, signal);
  await api.fetchLanguages(signal);
  await api.fetchProjectTree(project, "", signal);
  await api.fetchProjectFile(project, "notes.ts", null, signal);
  await api.fetchProjectSearch(project, "transportLine", signal);
  const snapshot = await api.fetchProjectChangeCheck(project, signal);
  if (snapshot.kind !== "git") throw new Error("Expected fixture Git snapshot");
  await api.fetchProjectStatus(project, signal);
  const diff = await api.fetchProjectDiff(project, "unstaged", "notes.ts", snapshot, null, signal);
  await api.fetchChangeDiff(
    project,
    { layer: "unstaged", path: "notes.ts", language: null },
    { ...snapshot, refreshKey: 0 },
    signal,
  );
  const contextFile = {
    revision: snapshot.revision,
    changeToken: snapshot.changeToken,
    layer: "unstaged" as const,
    path: "notes.ts",
    language: null,
  };
  const anchor = {
    side: "new" as const,
    line: 1,
    sourceText: "export const transportLine1 = 1;",
    before: null,
    after: "export const transportLine2 = 2;",
  };
  if (diff.kind !== "text" || diff.context?.kind !== "available")
    throw new Error("Missing fixture context");
  const gap = diff.context.gaps[0];
  if (gap === undefined) throw new Error("Missing fixture gap");
  await api.fetchDiffContext(
    project,
    {
      ...contextFile,
      kind: "expand",
      source: diff.context.source,
      gap: gap.id,
      up: 0,
      down: 0,
      direction: gap.id === 0 ? "up" : "down",
    },
    gap,
    signal,
  );
  if ((await api.checkContextAnchors(project, contextFile, [anchor], signal))[0] !== true)
    throw new Error("Context check failed");
  if (
    (
      await api.checkFeedbackSources(
        project,
        [
          {
            kind: "file",
            source: "worktree",
            path: "notes.ts",
            line: anchor.line,
            sourceText: anchor.sourceText,
            before: anchor.before,
            after: anchor.after,
          },
        ],
        signal,
      )
    )[0] !== true
  )
    throw new Error("Feedback check failed");
  await api.fetchGitRefs(project, signal);
  const history = await api.fetchGitHistory(project, { kind: "ref", ref: "HEAD" }, signal);
  await api.fetchGitHistory(project, { kind: "page", tip: history.tip, offset: 0 }, signal);
  await api.fetchCommit(project, __QA_COMMIT__, signal);
  const inspected = await api.fetchCommitDiff(project, __QA_COMMIT__, "image.svg", null, signal);
  const changed = await api.fetchChangeDiff(
    project,
    { layer: "unstaged", path: "image.svg", language: null },
    { ...snapshot, refreshKey: 0 },
    signal,
  );
  for (const media of [inspected, changed]) {
    if (media.kind !== "media") throw new Error("Missing fixture media diff");
    for (const side of [media.old, media.new]) {
      if (side.kind !== "ready") continue;
      if (new URL(side.resource.url).origin !== api.connection.endpoint)
        throw new Error("Media changed its chosen agent");
      const head = await api.connection.request(
        side.resource.url.slice(api.connection.endpoint.length),
        { method: "HEAD", signal },
      );
      if (!head.ok) throw new Error("Comparison media HEAD failed");
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = side.resource.url;
      await image.decode();
      if (image.naturalWidth !== 320) throw new Error("Comparison image could not be decoded");
    }
  }
  for (const path of ["image.svg", "sound.wav", "clip.mp4"]) {
    const value = await api.fetchProjectFile(project, path, null, signal);
    if (value.kind !== "media") throw new Error("Missing file media");
    const head = await api.connection.request(
      value.resource.url.slice(api.connection.endpoint.length),
      { method: "HEAD", signal },
    );
    if (!head.ok) throw new Error("Media HEAD failed");
  }
  if (
    (await api.transcribeRecording(
      new Blob(["synthetic recording"], { type: "audio/wav" }),
      signal,
    )) !== "Controlled transport transcript"
  )
    throw new Error("Voice request used a different transport");
}

declare global {
  interface Window {
    agentTransportQa: {
      exercise: () => Promise<void>;
      rejectRedirect: () => Promise<boolean>;
    };
  }
}
window.agentTransportQa = {
  async exercise() {
    await exercise(apiA);
    await exercise(apiB);
  },
  async rejectRedirect() {
    try {
      await connectionA.request("/api/qa-redirect");
      return false;
    } catch (error: unknown) {
      return error instanceof TypeError;
    }
  },
};
