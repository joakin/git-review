import { describe, expect, test } from "bun:test";
import { NavigationHistory } from "./navigation-history.ts";

const picker = "/?section=projects";
const file = "/?section=files&project=demo&dir=src&file=src%2Fa.ts";
const search = "/?section=search&project=demo&q=hello";
const result = `${search}&file=src%2Fa.ts&line=3`;
const settings = "/?section=settings&project=demo";

function harness(initial: { state: unknown; url: string }[] = [{ state: null, url: picker }], storage = true, browserLimit = Infinity) {
  let entries = initial;
  let index = entries.length - 1;
  let journal: unknown = null;
  let serial = 0;
  let request: -1 | 1 | null = null;
  const ports = {
    readEntry: () => {
      const entry = entries[index];
      if (entry === undefined) throw new Error("Missing current browser entry");
      return { ...entry, length: entries.length };
    },
    push: (state: unknown, url: string) => {
      entries = [...entries.slice(0, index + 1), { state, url }].slice(-browserLimit);
      index = entries.length - 1;
    },
    replace: (state: unknown, url: string) => { entries[index] = { state, url }; },
    go: (direction: -1 | 1) => { request = direction; },
    readJournal: () => storage ? structuredClone(journal) : null,
    saveJournal: (value: unknown) => { if (storage) journal = structuredClone(value); },
    newId: () => (++serial).toString(16).padStart(32, "0"),
  };
  return {
    ports,
    create: (reload = false) => new NavigationHistory(ports, reload),
    current: ports.readEntry,
    native: (direction: -1 | 1) => { index += direction; },
    settle: (owner: NavigationHistory) => {
      if (request !== null) { index += request; request = null; }
      owner.acceptCurrent();
    },
    replaceJournal: (value: unknown) => { journal = value; },
    journal: () => structuredClone(journal),
  };
}

function traverse(h: ReturnType<typeof harness>, owner: NavigationHistory, direction: -1 | 1): void {
  expect(owner.traverse(direction, () => {})).toBe(true);
  h.settle(owner);
}

describe("known app history", () => {
  test("starts without guessing from browser history or unrelated entry state", () => {
    const h = harness([{ state: null, url: "https://elsewhere.test/" }, { state: { unrelated: 7 }, url: file }]);
    const owner = h.create();
    expect(owner.availability()).toEqual({ canGoBack: false, canGoForward: false, pending: false });
    expect(owner.traverse(-1, () => { throw new Error("Unavailable traversal prepared a draft"); })).toBe(false);
    expect(h.current().state).toMatchObject({ unrelated: 7 });
    owner.write(search, "push");
    traverse(h, owner, -1);
    expect(h.current().url).toBe(file);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: true });
  });

  test("Search Back/Forward and reload at an earlier destination retain availability", () => {
    const h = harness([{ state: null, url: file }]);
    let owner = h.create();
    owner.write(search, "push");
    owner.write(result, "push");
    owner = h.create(true);
    expect(owner.availability()).toMatchObject({ canGoBack: true, canGoForward: false });
    traverse(h, owner, -1);
    expect(h.current().url).toBe(search);
    owner = h.create(true);
    expect(owner.availability()).toMatchObject({ canGoBack: true, canGoForward: true });
    traverse(h, owner, -1);
    expect(h.current().url).toBe(file);
    traverse(h, owner, 1);
    traverse(h, owner, 1);
    expect(h.current().url).toBe(result);
  });

  test("pushing after Back discards the old forward branch", () => {
    const h = harness();
    let owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    traverse(h, owner, -1);
    owner.write(settings, "push");
    owner = h.create(true);
    expect(owner.availability().canGoForward).toBe(false);
    traverse(h, owner, -1);
    traverse(h, owner, 1);
    expect(h.current().url).toBe(settings);
  });

  test("same destinations and canonical replacements preserve real neighbors", () => {
    const h = harness();
    let owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    traverse(h, owner, -1);
    owner.write(file, "push");
    expect(h.current().length).toBe(3);
    expect(owner.availability().canGoForward).toBe(true);
    owner.write(`${file}&line=3`, "replace");
    owner = h.create(true);
    traverse(h, owner, 1);
    traverse(h, owner, -1);
    expect(h.current().url).toBe(`${file}&line=3`);
    traverse(h, owner, -1);
    expect(h.current().url).toBe(picker);
  });

  test("native traversal uses the same trail and unknown entries start conservatively", () => {
    const h = harness([{ state: null, url: "https://elsewhere.test/" }, { state: null, url: picker }]);
    const owner = h.create();
    owner.write(file, "push");
    h.native(-1);
    owner.acceptCurrent();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: true });
    h.ports.push(null, settings);
    owner.acceptCurrent();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
    owner.write(search, "push");
    traverse(h, owner, -1);
    expect(h.current().url).toBe(settings);
  });

  test("URL mismatch and an unexpected browser length revoke remembered neighbors", () => {
    const h = harness();
    let owner = h.create();
    owner.write(file, "push");
    h.ports.replace(h.current().state, settings);
    owner = h.create(true);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
    owner.write(file, "push");
    h.ports.push(null, search);
    h.native(-1);
    owner.acceptCurrent();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
  });

  test("only reload restores a persisted trail; document returns start a new trail", () => {
    const h = harness();
    let owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    traverse(h, owner, -1);
    owner = h.create();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
    owner.write(settings, "push");
    owner.resetCurrent();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
  });

  test("storage denial preserves current-page history and reload falls back safely", () => {
    const h = harness(undefined, false);
    let owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    traverse(h, owner, -1);
    expect(owner.availability()).toMatchObject({ canGoBack: true, canGoForward: true });
    owner = h.create(true);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
  });

  test("rapid traversal prepares once and ignored traversal can recover", () => {
    const h = harness();
    const owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    let prepared = 0;
    expect(owner.traverse(-1, () => { prepared += 1; })).toBe(true);
    expect(owner.traverse(-1, () => { prepared += 1; })).toBe(false);
    expect(owner.availability().pending).toBe(true);
    expect(prepared).toBe(1);
    h.settle(owner);
    expect(h.current().url).toBe(file);
    expect(owner.availability().pending).toBe(false);
    expect(owner.traverse(-1, () => {})).toBe(true);
    owner.acceptCurrent();
    expect(owner.availability().pending).toBe(false);
  });

  test("the retained trail is bounded and older native entries become unknown", () => {
    const h = harness();
    let owner = h.create();
    for (let index = 0; index < 110; index += 1) owner.write(`${search}${index}`, "push");
    owner = h.create(true);
    for (let index = 0; index < 99; index += 1) traverse(h, owner, -1);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: true });
    h.native(-1);
    owner.acceptCurrent();
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
  });

  test("browser eviction trims the known trail and reload preserves retained entries", () => {
    const h = harness(undefined, true, 3);
    let owner = h.create();
    owner.write(file, "push");
    owner.write(search, "push");
    owner.write(result, "push");
    owner = h.create(true);
    traverse(h, owner, -1);
    expect(h.current().url).toBe(search);
    traverse(h, owner, -1);
    expect(h.current().url).toBe(file);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: true });
    expect(owner.traverse(-1, () => {})).toBe(false);
    owner.write(settings, "push");
    owner = h.create(true);
    traverse(h, owner, -1);
    expect(h.current().url).toBe(file);
    expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: true });
  });

  test("malformed or inconsistent persisted journals fail closed", () => {
    const changes = [
      { version: 2 }, { trail: "bad" }, { start: -1 }, { start: Number.MAX_SAFE_INTEGER },
      { historyLength: 0 }, { historyLength: 99 }, { entries: [] },
      { entries: [{ id: "a".repeat(32), url: "https://elsewhere.test/" }] },
      { entries: [{ id: "a".repeat(32), url: "/?section=files&project=x&file=../secret" }] },
      { entries: [{ id: "a".repeat(32), url: `/?${"x".repeat(40_000)}` }] },
      { entries: [{ id: "a".repeat(32), url: picker }, { id: "a".repeat(32), url: file }] },
    ];
    for (const change of changes) {
      const h = harness();
      h.create().write(file, "push");
      h.replaceJournal({ ...Object(h.journal()), ...change });
      expect(h.create(true).availability()).toMatchObject({ canGoBack: false, canGoForward: false });
    }
  });

  test("invalid, hash, and oversized initial URLs never become advertised neighbors", () => {
    for (const url of ["/?section=unknown", `${file}#other`, `/?${"x".repeat(100_000)}`]) {
      const h = harness([{ state: null, url }]);
      let owner = h.create();
      owner.write(file, "push");
      expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
      owner = h.create(true);
      expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
      expect(JSON.stringify(h.journal()).length).toBeLessThan(1000);
      owner.write(url, "push");
      expect(owner.availability()).toMatchObject({ canGoBack: false, canGoForward: false });
      expect(JSON.stringify(h.journal()).length).toBeLessThan(1000);
    }
  });
});
