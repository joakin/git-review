import { isRecord } from "@git-review/shared/validation";
import { parseNavigationSearch } from "./navigation.ts";
import { appBasePath } from "./deployment.ts";

export const navigationHistoryKey = "git-review:navigation-history:v1";
const markerKey = "gitReviewNavigation";
const maxEntries = 100;
const maxUrlLength = 32_768;
export const maxHistoryJournalLength = maxEntries * (maxUrlLength + 100) + 200;

type Marker = { version: 1; trail: string; position: number; entry: string };
type Journal = {
  version: 1;
  trail: string;
  start: number;
  historyLength: number;
  entries: { id: string; url: string | null }[];
};
export type HistoryAvailability = { canGoBack: boolean; canGoForward: boolean; pending: boolean };
type HistoryPorts = {
  readEntry: () => { state: unknown; url: string; length: number };
  push: (state: unknown, url: string) => void;
  replace: (state: unknown, url: string) => void;
  go: (direction: -1 | 1) => void;
  readJournal: () => unknown;
  saveJournal: (journal: Journal) => void;
  newId: () => string;
};

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

function isPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validUrl(value: unknown, basePath: string): value is string {
  if (typeof value !== "string" || value.length > maxUrlLength) return false;
  if (value !== basePath && !value.startsWith(`${basePath}?`)) return false;
  return (
    !value.includes("#") && parseNavigationSearch(value.slice(basePath.length)).kind !== "invalid"
  );
}

function parseMarker(state: unknown): Marker | null {
  if (!isRecord(state)) return null;
  const value = state[markerKey];
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !isId(value["trail"]) ||
    !isId(value["entry"]) ||
    !isPosition(value["position"])
  )
    return null;
  return { version: 1, trail: value["trail"], position: value["position"], entry: value["entry"] };
}

function parseJournal(value: unknown, basePath: string): Journal | null {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !isId(value["trail"]) ||
    !isPosition(value["start"]) ||
    !isPosition(value["historyLength"]) ||
    value["historyLength"] < 1
  )
    return null;
  const rawEntries = value["entries"];
  if (
    !Array.isArray(rawEntries) ||
    rawEntries.length === 0 ||
    rawEntries.length > maxEntries ||
    !Number.isSafeInteger(value["start"] + rawEntries.length) ||
    rawEntries.length > value["historyLength"]
  )
    return null;
  const entries: Journal["entries"] = [];
  const ids = new Set<string>();
  for (const item of rawEntries) {
    if (
      !isRecord(item) ||
      !isId(item["id"]) ||
      (item["url"] !== null && !validUrl(item["url"], basePath)) ||
      ids.has(item["id"])
    )
      return null;
    ids.add(item["id"]);
    entries.push({ id: item["id"], url: item["url"] });
  }
  return {
    version: 1,
    trail: value["trail"],
    start: value["start"],
    historyLength: value["historyLength"],
    entries,
  };
}

function recognizes(
  journal: Journal,
  marker: Marker | null,
  current: ReturnType<HistoryPorts["readEntry"]>,
): marker is Marker {
  if (marker === null || marker.trail !== journal.trail || journal.historyLength !== current.length)
    return false;
  const entry = journal.entries[marker.position - journal.start];
  return entry?.id === marker.entry && entry.url === current.url;
}

/** Tracks known adjacent entries; URLs remain the sole source of route data. */
export class NavigationHistory {
  private journal: Journal;
  private marker: Marker;
  private pending = false;

  constructor(
    private readonly ports: HistoryPorts,
    restoreReload: boolean,
    private readonly basePath = appBasePath,
  ) {
    const current = ports.readEntry();
    const journal = restoreReload ? parseJournal(ports.readJournal(), basePath) : null;
    const marker = parseMarker(current.state);
    if (journal !== null && recognizes(journal, marker, current)) {
      this.journal = journal;
      this.marker = marker;
    } else {
      const initial = this.fresh(current);
      this.journal = initial.journal;
      this.marker = initial.marker;
      this.replaceMarker(current.state, current.url);
      this.persist();
    }
  }

  private fresh(current: ReturnType<HistoryPorts["readEntry"]>): {
    journal: Journal;
    marker: Marker;
  } {
    const trail = this.ports.newId();
    const entry = this.ports.newId();
    return {
      journal: {
        version: 1,
        trail,
        start: 0,
        historyLength: current.length,
        entries: [{ id: entry, url: validUrl(current.url, this.basePath) ? current.url : null }],
      },
      marker: { version: 1, trail, position: 0, entry },
    };
  }

  private replaceMarker(state: unknown, url: string): void {
    this.ports.replace({ ...(isRecord(state) ? state : {}), [markerKey]: this.marker }, url);
  }

  private persist(): void {
    this.ports.saveJournal(this.journal);
  }

  availability(): HistoryAvailability {
    const offset = this.marker.position - this.journal.start;
    if (this.journal.entries[offset]?.url === null)
      return { canGoBack: false, canGoForward: false, pending: this.pending };
    const previous = this.journal.entries[offset - 1];
    const next = this.journal.entries[offset + 1];
    return {
      canGoBack: previous !== undefined && previous.url !== null,
      canGoForward: next !== undefined && next.url !== null,
      pending: this.pending,
    };
  }

  resetCurrent(): void {
    const current = this.ports.readEntry();
    const initial = this.fresh(current);
    this.journal = initial.journal;
    this.marker = initial.marker;
    this.pending = false;
    this.replaceMarker(current.state, current.url);
    this.persist();
  }

  acceptCurrent(): void {
    const current = this.ports.readEntry();
    const marker = parseMarker(current.state);
    if (!recognizes(this.journal, marker, current)) {
      this.resetCurrent();
      return;
    }
    this.marker = marker;
    this.pending = false;
  }

  write(url: string, mode: "push" | "replace"): void {
    this.acceptCurrent();
    const current = this.ports.readEntry();
    const offset = this.marker.position - this.journal.start;
    if (mode === "push" && url !== current.url) {
      const entry = this.ports.newId();
      const marker: Marker = { ...this.marker, position: this.marker.position + 1, entry };
      this.ports.push({ [markerKey]: marker }, url);
      this.marker = marker;
      this.journal.entries = [
        ...this.journal.entries.slice(0, offset + 1),
        { id: entry, url: validUrl(url, this.basePath) ? url : null },
      ];
      // Some browsers evict the oldest entries when their own limit is reached.
      const limit = Math.min(maxEntries, this.ports.readEntry().length);
      const removed = this.journal.entries.length - limit;
      if (removed > 0) {
        this.journal.entries = this.journal.entries.slice(removed);
        this.journal.start += removed;
      }
    } else {
      this.replaceMarker(current.state, url);
      this.journal.entries[offset] = {
        id: this.marker.entry,
        url: validUrl(url, this.basePath) ? url : null,
      };
    }
    this.journal.historyLength = this.ports.readEntry().length;
    this.persist();
  }

  traverse(direction: -1 | 1, prepare: () => void): boolean {
    if (this.pending) return false;
    this.acceptCurrent();
    const availability = this.availability();
    if (!(direction === -1 ? availability.canGoBack : availability.canGoForward)) return false;
    prepare();
    this.pending = true;
    try {
      this.ports.go(direction);
    } catch {
      this.pending = false;
      return false;
    }
    return true;
  }
}
