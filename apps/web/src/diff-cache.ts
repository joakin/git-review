import type { ChangeLayer, DiffResult } from "@git-review/shared/api";
import { ResourceCache } from "@git-review/shared/resource-cache";
import type { ChangeSnapshot } from "@git-review/shared/change-snapshot";

export type DiffCacheIdentity = ChangeSnapshot & {
  endpoint: string;
  projectPath: string;
  layer: ChangeLayer;
  path: string;
  refreshKey: number;
  language: string | null;
};

const maxCacheEntries = 128;
const maxCacheBytes = 32 * 1024 * 1024;
const results = new ResourceCache<DiffResult>(maxCacheEntries, maxCacheBytes);

export function diffCacheKey(identity: DiffCacheIdentity): string {
  return JSON.stringify([
    identity.endpoint,
    identity.projectPath,
    identity.layer,
    identity.path,
    identity.revision,
    identity.changeToken,
    identity.refreshKey,
    identity.language,
  ]);
}

export function readCachedDiff(key: string): DiffResult | null {
  return results.read(key);
}

export function rememberDiff(key: string, value: DiffResult): void {
  if (value.kind === "stale") return;
  results.remember(key, value);
}
