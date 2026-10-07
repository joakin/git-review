import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DiffResult } from "../shared/api.ts";
import type { DiffContextGap, DiffContextRequest } from "../shared/diff-context.ts";
import type { DiffCacheIdentity } from "./diff-cache.ts";
import { fetchDiffContext } from "./diff-context-api.ts";
import {
  appendContext,
  consumedContext,
  contextCache,
  emptyContext,
  plainContext,
  preserveContextPosition,
  type ContextExpansion,
} from "./diff-context-state.ts";
import { useStableCallback } from "./use-stable-callback.ts";

type Activity =
  | { kind: "idle" }
  | { kind: "loading"; gap: number | null }
  | { kind: "error"; gap: number | null; direction: "up" | "down" | null; message: string }
  | { kind: "stale" };
type View = { data: ContextExpansion; activity: Activity };
export type DiffContextControl = View & {
  expand: (gap: DiffContextGap, direction: "up" | "down", separator: HTMLElement) => void;
  retry: () => void;
};

export function useDiffContext(
  expanded: boolean,
  identity: DiffCacheIdentity,
  diff: DiffResult | null,
  onStale: () => void,
): DiffContextControl | null {
  const metadata =
    diff?.kind === "text" && diff.context?.kind === "available" ? diff.context : null;
  const baseKey = JSON.stringify([
    identity.projectPath,
    identity.layer,
    identity.path,
    identity.revision,
    identity.changeToken,
    identity.refreshKey,
    metadata?.source,
  ]);
  const key = JSON.stringify([baseKey, identity.language]);
  const initial = useMemo(() => {
    const cached = contextCache.read(baseKey);
    return {
      view: {
        data:
          cached === null
            ? emptyContext
            : cached.language === identity.language
              ? cached.data
              : plainContext(cached.data),
        activity:
          cached !== null && cached.language !== identity.language
            ? { kind: "loading" as const, gap: null }
            : { kind: "idle" as const },
      },
    };
  }, [key]);
  const [state, setState] = useState<{ key: string; view: View } | null>(null);
  const [retry, setRetry] = useState(0);
  const view = state?.key === key ? state.view : initial.view;
  const latest = useRef({ expanded, key, view, identity, diff, metadata });
  latest.current = { expanded, key, view, identity, diff, metadata };
  const pending = useRef<AbortController | null>(null);
  const pendingKey = useRef<string | null>(null);
  const afterLayout = useRef<(() => void) | null>(null);
  const stale = useStableCallback(onStale);
  useLayoutEffect(() => {
    afterLayout.current?.();
    afterLayout.current = null;
  }, [view.data]);

  const read = async (
    data: ContextExpansion,
    gap: DiffContextGap,
    direction: "up" | "down",
    controller: AbortController,
  ) => {
    const current = latest.current;
    if (current.metadata === null || current.diff?.kind !== "text")
      throw new Error("Context source is unavailable");
    const { up, down } = consumedContext(data, gap);
    const request: DiffContextRequest = {
      kind: "expand",
      revision: current.identity.revision,
      changeToken: current.identity.changeToken,
      layer: current.identity.layer,
      path: current.identity.path,
      language: current.identity.language,
      source: current.metadata.source,
      gap: gap.id,
      up,
      down,
      direction,
    };
    const response = await fetchDiffContext(
      current.identity.projectPath,
      request,
      gap,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    if (latest.current.key !== current.key || !latest.current.expanded)
      throw new Error("Context request was superseded");
    if (response.kind === "stale") {
      stale();
      throw new Error("New edits are available. Choose Update or Refresh.");
    }
    if (response.kind !== "expanded")
      throw new Error(
        response.kind === "unavailable" && response.reason === "limit"
          ? "This context exceeds the current read limit"
          : "Context could not be loaded",
      );
    return appendContext(data, current.diff, gap, direction, response.offset, response.lines);
  };

  useEffect(() => {
    const cached = contextCache.read(baseKey);
    if (!expanded || metadata === null || cached === null || cached.language === identity.language)
      return () => {
        if (pendingKey.current === key) {
          pending.current?.abort();
          pending.current = null;
          pendingKey.current = null;
        }
        setState((state) =>
          state?.key === key && state.view.activity.kind === "loading"
            ? { ...state, view: { ...state.view, activity: { kind: "idle" } } }
            : state,
        );
      };
    const controller = new AbortController();
    pending.current = controller;
    pendingKey.current = key;
    const replayData = plainContext(cached.data);
    setState({ key, view: { data: replayData, activity: { kind: "loading", gap: null } } });
    const owns = () =>
      !controller.signal.aborted && latest.current.expanded && latest.current.key === key;
    void (async () => {
      let data = emptyContext;
      for (const chunk of cached.data.chunks) {
        const gap = metadata.gaps.find((gap) => gap.id === chunk.gap);
        if (gap === undefined) throw new Error("Context gap changed");
        data = await read(data, gap, chunk.direction, controller);
        if (!owns()) return;
      }
      if (!owns()) return;
      contextCache.remember(baseKey, { language: identity.language, data });
      setState({ key, view: { data, activity: { kind: "idle" } } });
    })()
      .catch((error: unknown) => {
        if (owns())
          setState({
            key,
            view: {
              data: replayData,
              activity: {
                kind: "error",
                gap: null,
                direction: null,
                message: error instanceof Error ? error.message : "Context could not be loaded",
              },
            },
          });
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
      });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [expanded, key, retry]);

  const expand = useStableCallback(
    (gap: DiffContextGap, direction: "up" | "down", separator: HTMLElement) => {
      const current = latest.current;
      if (
        !current.expanded ||
        current.metadata === null ||
        pending.current !== null ||
        current.view.activity.kind === "loading" ||
        (current.view.activity.kind === "error" && current.view.activity.gap === null)
      )
        return;
      const controller = new AbortController();
      pending.current = controller;
      pendingKey.current = current.key;
      setState({
        key: current.key,
        view: { ...current.view, activity: { kind: "loading", gap: gap.id } },
      });
      const owns = () =>
        !controller.signal.aborted && latest.current.expanded && latest.current.key === current.key;
      void read(current.view.data, gap, direction, controller)
        .then(
          (data) => {
            if (!owns()) return;
            afterLayout.current = preserveContextPosition(separator);
            contextCache.remember(baseKey, { language: current.identity.language, data });
            setState({ key: current.key, view: { data, activity: { kind: "idle" } } });
          },
          (error: unknown) => {
            if (owns())
              setState({
                key: current.key,
                view: {
                  data: current.view.data,
                  activity: {
                    kind: "error",
                    gap: gap.id,
                    direction,
                    message: error instanceof Error ? error.message : "Context could not be loaded",
                  },
                },
              });
          },
        )
        .finally(() => {
          if (pending.current === controller) pending.current = null;
        });
    },
  );
  return metadata === null
    ? null
    : { ...view, expand, retry: () => setRetry((value) => value + 1) };
}
