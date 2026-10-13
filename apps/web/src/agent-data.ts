import { expectRecord } from "@git-review/shared/validation";
import { projectResourceKey, type ProjectReference } from "./agent-project.ts";
import {
  emptyAgentCatalog,
  parseAgentBackup,
  parseAgentCatalog,
  parseProjectReference,
  parseSavedAgentReview,
  reconcileAgentProjects,
  serializeAgentBackup,
  workspaceResourceKey,
  type AgentBackup,
  type AgentCatalog,
  type SavedAgentReview,
} from "./agent-data-format.ts";
import { newLocalId } from "./comments.ts";
import { normalizeAgentEndpoint } from "./agent-connection.ts";

export const agentCatalogStorageKey = "git-review:agents:v1:catalog";
export const agentReviewStoragePrefix = "git-review:agents:v1:reviews:";
type DataStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type LegacyConversion = { kind: "pending" } | { kind: "complete"; endpoint: string };
type Head = { version: 1; generation: string; catalog: AgentCatalog; legacy: LegacyConversion };

function parseHead(raw: string): Head {
  const item = expectRecord(JSON.parse(raw) as unknown, "agent storage catalog");
  if (
    item["version"] !== 1 ||
    typeof item["generation"] !== "string" ||
    !/^[a-f0-9]{32}$/.test(item["generation"])
  )
    throw new Error("Invalid agent storage generation");
  return {
    version: 1,
    generation: item["generation"],
    catalog: parseAgentCatalog(item["catalog"]),
    legacy: parseLegacyConversion(item["legacy"]),
  };
}

function parseLegacyConversion(value: unknown): LegacyConversion {
  if (value === undefined) return { kind: "pending" };
  const item = expectRecord(value, "legacy conversion");
  if (item["kind"] === "pending") return { kind: "pending" };
  if (item["kind"] === "complete")
    return { kind: "complete", endpoint: normalizeAgentEndpoint(item["endpoint"], true) };
  throw new Error("Invalid legacy conversion marker");
}

export function agentReviewStorageKey(generation: string, reference: ProjectReference): string {
  return `${agentReviewStoragePrefix}${generation}:${encodeURIComponent(projectResourceKey(reference))}`;
}

function merged<T>(previous: readonly T[], incoming: readonly T[], key: (item: T) => string): T[] {
  const result = new Map(previous.map((item) => [key(item), item]));
  for (const item of incoming) result.set(key(item), item);
  return [...result.values()];
}

/** Local-only persistence. No connection creation, filesystem authorization or network calls. */
export function createAgentDataRepository(storage: DataStorage) {
  function readItem(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      throw new Error("Browser storage is unavailable; saved agent data could not be read");
    }
  }

  function keys(): string[] {
    try {
      const result: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) result.push(key);
      }
      return result;
    } catch {
      throw new Error("Browser storage is unavailable; saved agent data could not be listed");
    }
  }

  function writeVerified(key: string, value: string): void {
    try {
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw new Error("Write verification failed");
    } catch {
      throw new Error(
        "Browser storage could not save agent data; check storage access and available space",
      );
    }
  }

  function readHead(): Head | null {
    const raw = readItem(agentCatalogStorageKey);
    return raw === null ? null : parseHead(raw);
  }

  function ensureHead(): Head {
    const previous = readHead();
    if (previous !== null) return previous;
    const head: Head = {
      version: 1,
      generation: newLocalId(),
      catalog: emptyAgentCatalog(),
      legacy: { kind: "pending" },
    };
    writeVerified(agentCatalogStorageKey, JSON.stringify(head));
    return head;
  }

  function readRecord(key: string, generation: string): SavedAgentReview {
    const raw = readItem(key);
    if (raw === null) throw new Error("Saved review disappeared while reading; retry export");
    const review = parseSavedAgentReview(JSON.parse(raw) as unknown);
    if (key !== agentReviewStorageKey(generation, review.project))
      throw new Error(
        "Stored review key conflicts with its endpoint/project ownership; data retained",
      );
    return review;
  }

  function readAll(): AgentBackup {
    const head = readHead();
    const catalog = head?.catalog ?? emptyAgentCatalog();
    const reviews: SavedAgentReview[] = [];
    if (head !== null) {
      const prefix = `${agentReviewStoragePrefix}${head.generation}:`;
      for (const key of keys()) {
        if (key.startsWith(prefix)) reviews.push(readRecord(key, head.generation));
      }
    }
    // Index reconciliation also recovers an ordinary save whose catalog write failed.
    return parseAgentBackup({
      format: "git-review-agent-backup",
      version: 1,
      catalog: reconcileAgentProjects(catalog, reviews),
      reviews,
    });
  }

  function readReview(value: ProjectReference): SavedAgentReview | null {
    const reference = parseProjectReference(value);
    const head = readHead();
    if (head === null) return null;
    const key = agentReviewStorageKey(head.generation, reference);
    return readItem(key) === null ? null : readRecord(key, head.generation);
  }

  function saveCatalog(value: AgentCatalog): void {
    const catalog = parseAgentCatalog(value);
    const head = ensureHead();
    writeVerified(agentCatalogStorageKey, JSON.stringify({ ...head, catalog }));
  }

  function saveReview(value: SavedAgentReview): void {
    const review = parseSavedAgentReview(value);
    const head = ensureHead();
    const catalog = reconcileAgentProjects(head.catalog, [review]);
    writeVerified(agentReviewStorageKey(head.generation, review.project), JSON.stringify(review));
    if (JSON.stringify(catalog) === JSON.stringify(head.catalog)) return;
    try {
      writeVerified(agentCatalogStorageKey, JSON.stringify({ ...head, catalog }));
    } catch {
      throw new Error(
        "The review was saved, but its project index could not be updated. Reconciliation can recover it.",
      );
    }
  }

  function cleanup(keysToRemove: readonly string[]): boolean {
    let complete = true;
    for (const key of keysToRemove) {
      try {
        storage.removeItem(key);
      } catch {
        complete = false;
      }
    }
    return complete;
  }

  function applyBackup(
    value: unknown,
    conversion: LegacyConversion = { kind: "pending" },
  ): { cleanup: "complete" | "incomplete" } {
    const requestedConversion = parseLegacyConversion(conversion);
    const incoming = parseAgentBackup(value);
    // Enforce the byte limit even when callers bypass the text parser.
    serializeAgentBackup(incoming);
    const current = readAll();
    const importedProjects = new Map(
      incoming.catalog.projects.map((project) => [projectResourceKey(project), project]),
    );
    const reviews = merged(current.reviews, incoming.reviews, (review) =>
      projectResourceKey(review.project),
    ).map((review) => ({
      ...review,
      project: importedProjects.get(projectResourceKey(review.project)) ?? review.project,
    }));
    const catalog = reconcileAgentProjects(
      parseAgentCatalog({
        version: 1,
        connections: merged(
          current.catalog.connections,
          incoming.catalog.connections,
          (connection) => connection.endpoint,
        ),
        projects: merged(current.catalog.projects, incoming.catalog.projects, projectResourceKey),
        workspaces: merged(
          current.catalog.workspaces,
          incoming.catalog.workspaces,
          workspaceResourceKey,
        ),
        global: incoming.catalog.global,
      }),
      reviews,
    );
    const next = parseAgentBackup({ ...incoming, catalog, reviews });
    serializeAgentBackup(next);
    const previousHead = readItem(agentCatalogStorageKey);
    const legacy =
      requestedConversion.kind === "complete"
        ? requestedConversion
        : previousHead === null
          ? { kind: "pending" as const }
          : parseHead(previousHead).legacy;
    const existingKeys = keys();
    const generation = newLocalId();
    const stagedKeys: string[] = [];
    try {
      for (const review of next.reviews) {
        const key = agentReviewStorageKey(generation, review.project);
        stagedKeys.push(key);
        writeVerified(key, JSON.stringify(review));
      }
    } catch (error) {
      cleanup(stagedKeys);
      throw error;
    }
    // Project writes have been verified. This single atomic Web Storage write publishes them.
    try {
      writeVerified(
        agentCatalogStorageKey,
        JSON.stringify({ version: 1, generation, catalog, legacy }),
      );
    } catch {
      try {
        if (previousHead === null) storage.removeItem(agentCatalogStorageKey);
        else if (storage.getItem(agentCatalogStorageKey) !== previousHead)
          storage.setItem(agentCatalogStorageKey, previousHead);
      } catch {
        // Retain staged data if publication/rollback is uncertain, so either generation is recoverable.
        throw new Error(
          "Import publication failed and the previous catalog could not be restored. Both generations were retained.",
        );
      }
      throw new Error(
        "Import could not be published. The previous catalog remains active; staged data was retained.",
      );
    }
    // Ignore legacy/unrelated keys. Orphans from interrupted staging can be reclaimed now.
    const obsolete = existingKeys.filter((key) => {
      if (!key.startsWith(agentReviewStoragePrefix)) return false;
      const storedGeneration = key.slice(agentReviewStoragePrefix.length).split(":", 1)[0];
      return (
        storedGeneration !== undefined &&
        /^[a-f0-9]{32}$/.test(storedGeneration) &&
        storedGeneration !== generation
      );
    });
    return { cleanup: cleanup(obsolete) ? "complete" : "incomplete" };
  }

  return {
    readCatalog: () => readHead()?.catalog ?? emptyAgentCatalog(),
    readLegacyConversion: () => readHead()?.legacy ?? { kind: "pending" as const },
    readAll,
    readReview,
    saveCatalog,
    saveReview,
    reconcile() {
      const backup = readAll();
      saveCatalog(backup.catalog);
      return backup.catalog;
    },
    exportBackup() {
      const backup = readAll();
      serializeAgentBackup(backup);
      return backup;
    },
    applyBackup,
  };
}
