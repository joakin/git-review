import { useEffect, useState } from "preact/hooks";
import type { Project } from "@git-review/shared/api";
import type { CommitDetail, GitHistoryPage, GitRefs } from "@git-review/shared/git";
import type { GitRoute } from "./navigation.ts";
import { useAgentApi, useAgentLifetime } from "./AgentApiProvider.tsx";
import { ResourceCache } from "@git-review/shared/resource-cache";
import type { LoadState } from "./load-state.ts";
import { projectResourceKey } from "./agent-project.ts";

const refsCache = new ResourceCache<GitRefs>(16, 1024 * 1024);
const historyCache = new ResourceCache<GitHistoryPage>(16, 4 * 1024 * 1024);
const commitCache = new ResourceCache<CommitDetail>(64, 4 * 1024 * 1024);

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Git history could not be loaded";
}
function state<T>(
  key: string | null,
  loaded: { key: string; state: LoadState<T> } | null,
  cached: T | null,
): LoadState<T> {
  return key !== null && loaded?.key === key
    ? loaded.state
    : cached === null
      ? { kind: "loading" }
      : { kind: "ready", value: cached };
}

export function useGitBrowser(project: Project | null, route: GitRoute | null) {
  const api = useAgentApi();
  const lifetime = useAgentLifetime();
  const projectPath = route === null ? null : (project?.absolutePath ?? null);
  const ref = route?.ref ?? null;
  const oid = route?.target.kind === "commit" ? route.target.oid : null;
  const resourceKey = (...resource: readonly unknown[]) =>
    projectResourceKey(
      { endpoint: api.connection.endpoint, projectPath: projectPath ?? "" },
      ...resource,
    );
  const refsKey = projectPath === null ? null : resourceKey("refs");
  const historyKey = projectPath === null || ref === null ? null : resourceKey("history", ref);
  const commitKey = projectPath === null || oid === null ? null : resourceKey("commit", oid);
  const [refsLoad, setRefs] = useState<{ key: string; state: LoadState<GitRefs> } | null>(null);
  const [historyLoad, setHistory] = useState<{
    key: string;
    state: LoadState<GitHistoryPage>;
  } | null>(null);
  const [commitLoad, setCommit] = useState<{ key: string; state: LoadState<CommitDetail> } | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageRequest, setPageRequest] = useState<{
    projectPath: string;
    key: string;
    snapshot: GitHistoryPage;
  } | null>(null);
  const refs = state(refsKey, refsLoad, refsKey === null ? null : refsCache.read(refsKey));
  const history = state(
    historyKey,
    historyLoad,
    historyKey === null ? null : historyCache.read(historyKey),
  );
  const detail = state(
    commitKey,
    commitLoad,
    commitKey === null ? null : commitCache.read(commitKey),
  );
  const unborn =
    refs.kind === "ready" &&
    refs.value.kind === "git" &&
    refs.value.head.kind === "unborn" &&
    ref === refs.value.head.ref &&
    !refs.value.branches.some((branch) => branch.ref === ref);

  useEffect(() => {
    if (projectPath === null || refsKey === null || refsCache.read(refsKey) !== null) return;
    const controller = lifetime.createController();
    setRefs((current) =>
      current?.key === refsKey && current.state.kind === "ready"
        ? current
        : { key: refsKey, state: { kind: "loading" } },
    );
    api.fetchGitRefs(projectPath, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        refsCache.remember(refsKey, value);
        setRefs({ key: refsKey, state: { kind: "ready", value } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setRefs((current) =>
            current?.key === refsKey && current.state.kind === "ready"
              ? current
              : { key: refsKey, state: { kind: "error", message: message(error) } },
          );
          setPageError(message(error));
        }
      },
    );
    return () => controller.abort();
  }, [projectPath, refsKey, refresh]);

  useEffect(() => {
    setPageError(null);
    setPaging(false);
    setPageRequest(null);
    if (
      projectPath === null ||
      ref === null ||
      historyKey === null ||
      unborn ||
      historyCache.read(historyKey) !== null
    ) {
      setRefreshing(false);
      return;
    }
    const controller = lifetime.createController();
    setRefreshing(true);
    setHistory((current) =>
      current?.key === historyKey && current.state.kind === "ready"
        ? current
        : { key: historyKey, state: { kind: "loading" } },
    );
    api.fetchGitHistory(projectPath, { kind: "ref", ref }, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        historyCache.remember(historyKey, value);
        setHistory({ key: historyKey, state: { kind: "ready", value } });
        setRefreshing(false);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setHistory((current) =>
          current?.key === historyKey && current.state.kind === "ready"
            ? current
            : { key: historyKey, state: { kind: "error", message: message(error) } },
        );
        setPageError(message(error));
        setRefreshing(false);
      },
    );
    return () => controller.abort();
  }, [projectPath, ref, historyKey, unborn, refresh]);

  useEffect(() => {
    if (
      projectPath === null ||
      oid === null ||
      commitKey === null ||
      commitCache.read(commitKey) !== null
    )
      return;
    const controller = lifetime.createController();
    setCommit({ key: commitKey, state: { kind: "loading" } });
    api.fetchCommit(projectPath, oid, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        commitCache.remember(commitKey, value);
        setCommit({ key: commitKey, state: { kind: "ready", value } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setCommit({ key: commitKey, state: { kind: "error", message: message(error) } });
      },
    );
    return () => controller.abort();
  }, [projectPath, oid, commitKey, refresh]);

  useEffect(() => {
    if (
      pageRequest === null ||
      pageRequest.projectPath !== projectPath ||
      pageRequest.key !== historyKey
    )
      return;
    const controller = lifetime.createController();
    const snapshot = pageRequest.snapshot;
    const offset = snapshot.nextOffset;
    if (offset === null) return;
    setPaging(true);
    setPageError(null);
    api
      .fetchGitHistory(
        pageRequest.projectPath,
        { kind: "page", tip: snapshot.tip, offset },
        controller.signal,
      )
      .then(
        (value) => {
          if (controller.signal.aborted) return;
          const seen = new Set(snapshot.commits.map((commit) => commit.oid));
          const combined = {
            tip: snapshot.tip,
            commits: [
              ...snapshot.commits,
              ...value.commits.filter((commit) => !seen.has(commit.oid)),
            ],
            nextOffset: value.nextOffset,
          };
          historyCache.remember(pageRequest.key, combined);
          setHistory({ key: pageRequest.key, state: { kind: "ready", value: combined } });
          setPaging(false);
          setPageRequest(null);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setPageError(message(error));
            setPaging(false);
            setPageRequest(null);
          }
        },
      );
    return () => controller.abort();
    // Only an explicit Load older action starts another page; list updates don't.
  }, [pageRequest, projectPath, historyKey]);

  function refreshHistory(): void {
    if (projectPath === null) return;
    if (refsKey !== null) refsCache.remove(refsKey);
    if (historyKey !== null) historyCache.remove(historyKey);
    setPageRequest(null);
    setRefresh((value) => value + 1);
  }

  return {
    refs,
    history,
    detail,
    unborn,
    refreshing,
    paging,
    pageError,
    refreshHistory,
    loadOlder: () => {
      if (
        !paging &&
        !refreshing &&
        projectPath !== null &&
        historyKey !== null &&
        history.kind === "ready" &&
        history.value.nextOffset !== null
      ) {
        setPaging(true);
        setPageRequest({ projectPath, key: historyKey, snapshot: history.value });
      }
    },
    retryCommit: () => setRefresh((value) => value + 1),
  };
}
