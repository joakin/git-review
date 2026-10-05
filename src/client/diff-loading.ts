import { useEffect, useRef, useState } from "preact/hooks";
import type { DiffResult } from "../shared/api.ts";
import { readCachedDiff, rememberDiff } from "./diff-cache.ts";
import type { LoadState } from "./load-state.ts";

export type DiffState = LoadState<DiffResult>;

type DiffRequest = {
  key: string;
  read: (signal: AbortSignal) => Promise<DiffResult>;
  errorMessage: string;
  onLoaded?: (value: DiffResult) => void;
};

/** The adapter's key must include every input that changes the requested payload. */
export function useDiffLoading(expanded: boolean, request: DiffRequest) {
  const [loaded, setLoaded] = useState<{ key: string; state: DiffState } | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef({ expanded, request });
  latest.current = { expanded, request };
  const cached = expanded ? readCachedDiff(request.key) : null;
  const current: DiffState =
    loaded?.key === request.key
      ? loaded.state
      : cached === null
        ? { kind: "loading" }
        : { kind: "ready", value: cached };

  useEffect(() => {
    if (!expanded || current.kind === "ready") return;
    const controller = new AbortController();
    const ownsResult = () =>
      !controller.signal.aborted &&
      latest.current.expanded &&
      latest.current.request.key === request.key;
    setLoaded({ key: request.key, state: { kind: "loading" } });
    request.read(controller.signal).then(
      (value) => {
        if (!ownsResult()) return;
        rememberDiff(request.key, value);
        setLoaded({ key: request.key, state: { kind: "ready", value } });
        latest.current.request.onLoaded?.(value);
      },
      (error: unknown) => {
        if (!ownsResult()) return;
        setLoaded({
          key: request.key,
          state: {
            kind: "error",
            message: error instanceof Error ? error.message : request.errorMessage,
          },
        });
      },
    );
    return () => controller.abort();
    // Callback identity is presentation state; the resource key owns request lifetime.
  }, [expanded, request.key, retry]);

  return { current, retry: () => setRetry((value) => value + 1) };
}
