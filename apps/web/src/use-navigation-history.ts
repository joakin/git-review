import { useEffect, useRef, useState } from "preact/hooks";
import {
  maxHistoryJournalLength,
  navigationHistoryKey,
  NavigationHistory,
  type HistoryAvailability,
} from "./navigation-history.ts";

type NavigationHistoryControls = HistoryAvailability & {
  write: (url: string, mode: "push" | "replace") => void;
  acceptCurrent: () => void;
  back: () => boolean;
  forward: () => boolean;
};

function newHistoryId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function browserHistory(legacyEndpoint: string | null): NavigationHistory {
  const navigation = performance.getEntriesByType("navigation")[0];
  return new NavigationHistory(
    {
      readEntry: () => ({
        state: window.history.state as unknown,
        url: location.pathname + location.search + location.hash,
        length: window.history.length,
      }),
      push: (state, url) => window.history.pushState(state, "", url),
      replace: (state, url) => window.history.replaceState(state, "", url),
      go: (direction) => window.history.go(direction),
      readJournal: () => {
        try {
          const raw = sessionStorage.getItem(navigationHistoryKey);
          return raw === null || raw.length > maxHistoryJournalLength
            ? null
            : (JSON.parse(raw) as unknown);
        } catch {
          return null;
        }
      },
      saveJournal: (journal) => {
        try {
          sessionStorage.setItem(navigationHistoryKey, JSON.stringify(journal));
        } catch {
          /* Known history still works for this page lifetime. */
        }
      },
      newId: newHistoryId,
    },
    navigation instanceof PerformanceNavigationTiming && navigation.type === "reload",
    undefined,
    legacyEndpoint,
  );
}

export function useNavigationHistory(
  prepareTraversal: () => void,
  legacyEndpoint: string | null = null,
): NavigationHistoryControls {
  const [owner] = useState(() => browserHistory(legacyEndpoint));
  const [availability, setAvailability] = useState(() => owner.availability());
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPendingTimeout(): void {
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = null;
  }

  function acceptCurrent(): void {
    clearPendingTimeout();
    owner.acceptCurrent();
    setAvailability(owner.availability());
  }

  function write(url: string, mode: "push" | "replace"): void {
    clearPendingTimeout();
    owner.write(url, mode);
    setAvailability(owner.availability());
  }

  function traverse(direction: -1 | 1): boolean {
    const started = owner.traverse(direction, prepareTraversal);
    setAvailability(owner.availability());
    if (!started) return false;
    // Recover if the browser ignores a traversal; popstate normally clears this.
    timeout.current = setTimeout(acceptCurrent, 2_000);
    return true;
  }

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return;
      // Leaving this document can replace its forward branch with another site.
      clearPendingTimeout();
      owner.resetCurrent();
      setAvailability(owner.availability());
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearPendingTimeout();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [owner]);

  return {
    ...availability,
    write,
    acceptCurrent,
    back: () => traverse(-1),
    forward: () => traverse(1),
  };
}
