import {
  diffBatchSize,
  maxDiffBatchFiles,
  maxDiffBatchRequestBytes,
  type DiffBatchResponse,
} from "@git-review/shared/diff-batch";
import { ApiRequestError } from "./api.ts";

export type DiffBatchSource<I, T> = {
  key: string;
  encode: (files: readonly I[]) => string;
  read: (body: string, files: readonly I[], signal: AbortSignal) => Promise<DiffBatchResponse<T>>;
  readSingle: (file: I, signal: AbortSignal) => Promise<T>;
};
type Listener<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  detach: () => void;
};
type Job<I, T> = {
  key: string;
  source: DiffBatchSource<I, T>;
  file: I;
  listeners: Set<Listener<T>>;
};
type ActiveBatch<I, T> = { jobs: Job<I, T>[]; controller: AbortController };

/** Pending demand only: completed and canceled jobs never become a retained result cache. */
export class DiffBatchQueue<I, T> {
  private readonly jobs = new Map<string, Job<I, T>>();
  private pending: Job<I, T>[] = [];
  private active: ActiveBatch<I, T> | null = null;
  private scheduled = false;
  private lastSource: string | null = null;

  constructor(
    private readonly identity: (file: I) => string,
    private readonly size = diffBatchSize,
  ) {
    if (!Number.isSafeInteger(size) || size < 1 || size > maxDiffBatchFiles)
      throw new Error("Invalid diff batch size");
  }

  read(source: DiffBatchSource<I, T>, file: I, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const key = JSON.stringify([source.key, this.identity(file)]);
    let existing = this.jobs.get(key);
    if (existing === undefined) {
      existing = { key, source, file, listeners: new Set() };
      this.jobs.set(key, existing);
      this.pending.push(existing);
    }
    const job = existing;
    return new Promise<T>((resolve, reject) => {
      const listener: Listener<T> = {
        resolve,
        reject,
        detach: () => signal.removeEventListener("abort", cancel),
      };
      const cancel = () => {
        listener.detach();
        job.listeners.delete(listener);
        reject(new DOMException("Aborted", "AbortError"));
        if (job.listeners.size === 0) this.remove(job);
        if (this.active !== null && this.active.jobs.every((job) => job.listeners.size === 0))
          this.active.controller.abort();
      };
      job.listeners.add(listener);
      signal.addEventListener("abort", cancel, { once: true });
      this.schedule();
    });
  }

  private remove(job: Job<I, T>): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    const index = this.pending.indexOf(job);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private settle(
    job: Job<I, T>,
    result: { kind: "ready"; value: T } | { kind: "error"; error: unknown },
  ): void {
    this.remove(job);
    for (const listener of job.listeners) {
      listener.detach();
      if (result.kind === "ready") listener.resolve(result.value);
      else listener.reject(result.error);
    }
    job.listeners.clear();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.active !== null) return;
      const first = this.pending[0];
      if (first === undefined) return;
      // Publish the first few cards promptly, then amortize setup across larger batches.
      const limit = first.source.key === this.lastSource ? this.size : Math.min(3, this.size);
      const jobs: Job<I, T>[] = [];
      for (const job of this.pending) {
        if (job.source.key !== first.source.key) continue;
        const body = first.source.encode([...jobs.map((job) => job.file), job.file]);
        if (new TextEncoder().encode(body).byteLength > maxDiffBatchRequestBytes) break;
        jobs.push(job);
        if (jobs.length === limit) break;
      }
      if (jobs.length === 0) {
        this.settle(first, {
          kind: "error",
          error: new Error("Diff request exceeds the batch byte limit"),
        });
        this.schedule();
        return;
      }
      for (const job of jobs) {
        const index = this.pending.indexOf(job);
        if (index >= 0) this.pending.splice(index, 1);
      }
      const batch = { jobs, controller: new AbortController() };
      this.active = batch;
      void this.run(batch);
    });
  }

  private async run(batch: ActiveBatch<I, T>): Promise<void> {
    const first = batch.jobs[0];
    if (first === undefined) return;
    const signal = batch.controller.signal;
    try {
      const response = await first.source.read(
        first.source.encode(batch.jobs.map((job) => job.file)),
        batch.jobs.map((job) => job.file),
        signal,
      );
      if (response.results.length !== batch.jobs.length)
        throw new Error("Mismatched diff batch response");
      this.lastSource = first.source.key;
      const deferred: Job<I, T>[] = [];
      for (const [index, job] of batch.jobs.entries()) {
        const result = response.results[index];
        if (result === undefined) throw new Error("Missing diff batch result");
        if (job.listeners.size === 0) continue;
        if (result.kind === "deferred") deferred.push(job);
        else if (result.kind === "ready") this.settle(job, result);
        else
          this.settle(job, {
            kind: "error",
            error: new ApiRequestError(result.error.message, result.error.code, result.status),
          });
      }
      let next = 0;
      const fallback = async () => {
        while (!signal.aborted) {
          const job = deferred[next++];
          if (job === undefined) return;
          if (job.listeners.size === 0) continue;
          try {
            const value = await job.source.readSingle(job.file, signal);
            if (!signal.aborted) this.settle(job, { kind: "ready", value });
          } catch (error: unknown) {
            this.settle(job, { kind: "error", error });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, deferred.length) }, () => fallback()));
    } catch (error: unknown) {
      for (const job of batch.jobs) this.settle(job, { kind: "error", error });
    } finally {
      this.active = null;
      this.schedule();
    }
  }
}
