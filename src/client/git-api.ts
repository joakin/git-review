import {
  parseCommitDetail,
  parseCommitDiff,
  parseGitHistory,
  parseGitRefs,
  type CommitDetail,
  type CommitDiff,
  type GitHistoryPage,
  type GitLogRequest,
  type GitRefs,
} from "../shared/git.ts";
import { responseBody } from "./api.ts";

export async function fetchGitRefs(id: string, signal: AbortSignal): Promise<GitRefs> {
  return parseGitRefs(
    await responseBody(await fetch(`/api/projects/${id}/git/refs`, { signal, cache: "no-store" })),
  );
}

export async function fetchGitHistory(
  id: string,
  request: GitLogRequest,
  signal: AbortSignal,
): Promise<GitHistoryPage> {
  const query = new URLSearchParams(
    request.kind === "ref"
      ? { ref: request.ref }
      : { tip: request.tip, offset: String(request.offset) },
  );
  const result = parseGitHistory(
    await responseBody(
      await fetch(`/api/projects/${id}/git/log?${query}`, { signal, cache: "no-store" }),
    ),
  );
  if (
    request.kind === "page" &&
    (result.tip !== request.tip ||
      (result.nextOffset !== null && result.nextOffset !== request.offset + 50))
  )
    throw new Error("History response does not match its snapshot");
  return result;
}

export async function fetchCommit(
  id: string,
  oid: string,
  signal: AbortSignal,
): Promise<CommitDetail> {
  const result = parseCommitDetail(
    await responseBody(await fetch(`/api/projects/${id}/git/commits/${oid}`, { signal })),
  );
  if (result.oid !== oid) throw new Error("Commit response does not match its destination");
  return result;
}

let activeDiffs = 0;
const waitingDiffs: (() => void)[] = [];

async function withDiffSlot<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", cancel);
      activeDiffs += 1;
      resolve();
    };
    const cancel = () => {
      const index = waitingDiffs.indexOf(start);
      if (index >= 0) waitingDiffs.splice(index, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    if (activeDiffs < 3) start();
    else {
      waitingDiffs.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
  try {
    signal.throwIfAborted();
    return await read();
  } finally {
    activeDiffs -= 1;
    waitingDiffs.shift()?.();
  }
}

export async function fetchCommitDiff(
  id: string,
  oid: string,
  path: string,
  language: string | null,
  signal: AbortSignal,
): Promise<CommitDiff> {
  return withDiffSlot(signal, async () => {
    const query = new URLSearchParams({ path });
    if (language !== null) query.set("language", language);
    return parseCommitDiff(
      await responseBody(
        await fetch(`/api/projects/${id}/git/commits/${oid}/diff?${query}`, { signal }),
      ),
    );
  });
}
