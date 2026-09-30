import type { ChangeLayer, DiffResult } from "../shared/api.ts";

export type DiffCacheIdentity = {
  projectId: string;
  layer: ChangeLayer;
  path: string;
  revision: string;
  changeToken: string;
  refreshKey: number;
  language: string | null;
};

const maxCacheEntries = 128;
const maxCacheBytes = 32 * 1024 * 1024;
const results = new Map<string, { value: DiffResult; bytes: number }>();
let totalBytes = 0;

export function diffCacheKey(identity: DiffCacheIdentity): string {
  return JSON.stringify([identity.projectId, identity.layer, identity.path, identity.revision, identity.changeToken, identity.refreshKey, identity.language]);
}

export function readCachedDiff(key: string): DiffResult | null {
  const item = results.get(key);
  if (item === undefined) return null;
  results.delete(key);
  results.set(key, item);
  return item.value;
}

export function rememberDiff(key: string, value: DiffResult): void {
  if (value.kind === "stale") return;
  const bytes = JSON.stringify(value).length * 2;
  if (bytes > maxCacheBytes) return;
  const previous = results.get(key);
  if (previous !== undefined) totalBytes -= previous.bytes;
  results.delete(key);
  results.set(key, { value, bytes });
  totalBytes += bytes;
  while (results.size > maxCacheEntries || totalBytes > maxCacheBytes) {
    const oldest = results.keys().next().value;
    if (oldest === undefined) break;
    const removed = results.get(oldest);
    if (removed !== undefined) totalBytes -= removed.bytes;
    results.delete(oldest);
  }
}
