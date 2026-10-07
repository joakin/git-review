import { useCallback, useRef } from "preact/hooks";

/** Keep memoized presentation handlers stable while invoking the current owner's command. */
export function useStableCallback<Arguments extends unknown[], Result>(
  callback: (...args: Arguments) => Result,
): (...args: Arguments) => Result {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Arguments) => latest.current(...args), []);
}
