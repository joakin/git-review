import { useEffect, useState } from "preact/hooks";
import type { Project } from "../shared/api.ts";
import type { CommitDetail, GitHistoryPage, GitRefs } from "../shared/git.ts";
import type { GitRoute } from "./navigation.ts";
import { fetchCommit, fetchGitHistory, fetchGitRefs } from "./git-api.ts";
import { ResourceCache } from "../shared/resource-cache.ts";

export type GitLoad<T> =
  { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };
export type GitHistorySnapshot = GitHistoryPage;
const refsCache = new ResourceCache<GitRefs>(16, 1024 * 1024);
const historyCache = new ResourceCache<GitHistorySnapshot>(16, 4 * 1024 * 1024);
const commitCache = new ResourceCache<CommitDetail>(64, 4 * 1024 * 1024);

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Git history could not be loaded";
}
function state<T>(
  key: string | null,
  loaded: { key: string; state: GitLoad<T> } | null,
  cached: T | null,
): GitLoad<T> {
  return key !== null && loaded?.key === key
    ? loaded.state
    : cached === null
      ? { kind: "loading" }
      : { kind: "ready", value: cached };
}

export function useGitBrowser(project: Project | null, route: GitRoute | null) {
  const id = route === null ? null : (project?.id ?? null);
  const ref = route?.ref ?? null;
  const oid = route?.target.kind === "commit" ? route.target.oid : null;
  const historyKey = id === null || ref === null ? null : JSON.stringify([id, ref]);
  const commitKey = id === null || oid === null ? null : JSON.stringify([id, oid]);
  const [refsLoad, setRefs] = useState<{ key: string; state: GitLoad<GitRefs> } | null>(null);
  const [historyLoad, setHistory] = useState<{
    key: string;
    state: GitLoad<GitHistorySnapshot>;
  } | null>(null);
  const [commitLoad, setCommit] = useState<{ key: string; state: GitLoad<CommitDetail> } | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageRequest, setPageRequest] = useState<{
    id: string;
    key: string;
    snapshot: GitHistorySnapshot;
  } | null>(null);
  const refs = state(id, refsLoad, id === null ? null : refsCache.read(id));
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
    if (id === null || refsCache.read(id) !== null) return;
    const controller = new AbortController();
    setRefs((current) =>
      current?.key === id && current.state.kind === "ready"
        ? current
        : { key: id, state: { kind: "loading" } },
    );
    fetchGitRefs(id, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        refsCache.remember(id, value);
        setRefs({ key: id, state: { kind: "ready", value } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setRefs((current) =>
            current?.key === id && current.state.kind === "ready"
              ? current
              : { key: id, state: { kind: "error", message: message(error) } },
          );
          setPageError(message(error));
        }
      },
    );
    return () => controller.abort();
  }, [id, refresh]);

  useEffect(() => {
    setPageError(null);
    setPaging(false);
    setPageRequest(null);
    if (
      id === null ||
      ref === null ||
      historyKey === null ||
      unborn ||
      historyCache.read(historyKey) !== null
    ) {
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    setRefreshing(true);
    setHistory((current) =>
      current?.key === historyKey && current.state.kind === "ready"
        ? current
        : { key: historyKey, state: { kind: "loading" } },
    );
    fetchGitHistory(id, { kind: "ref", ref }, controller.signal).then(
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
  }, [id, ref, historyKey, unborn, refresh]);

  useEffect(() => {
    if (id === null || oid === null || commitKey === null || commitCache.read(commitKey) !== null)
      return;
    const controller = new AbortController();
    setCommit({ key: commitKey, state: { kind: "loading" } });
    fetchCommit(id, oid, controller.signal).then(
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
  }, [id, oid, commitKey, refresh]);

  useEffect(() => {
    if (pageRequest === null || pageRequest.id !== id || pageRequest.key !== historyKey) return;
    const controller = new AbortController();
    const snapshot = pageRequest.snapshot;
    const offset = snapshot.nextOffset;
    if (offset === null) return;
    setPaging(true);
    setPageError(null);
    fetchGitHistory(
      pageRequest.id,
      { kind: "page", tip: snapshot.tip, offset },
      controller.signal,
    ).then(
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
  }, [pageRequest, id, historyKey]);

  function refreshHistory(): void {
    if (id === null) return;
    refsCache.remove(id);
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
        id !== null &&
        historyKey !== null &&
        history.kind === "ready" &&
        history.value.nextOffset !== null
      ) {
        setPaging(true);
        setPageRequest({ id, key: historyKey, snapshot: history.value });
      }
    },
    retryCommit: () => setRefresh((value) => value + 1),
  };
}
