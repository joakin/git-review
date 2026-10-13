export type NotificationSeverity = "info" | "success" | "warning" | "error";
export type NotificationAction = { label: string; run: () => void; disabled?: boolean };
export type NotificationInput = {
  message: string;
  severity: NotificationSeverity;
  key?: string;
  action?: NotificationAction;
  timeoutMs?: number | null;
};
export type Notification = NotificationInput & { id: number; timeoutMs: number | null };

type Clock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
};
type Lifetime = {
  remaining: number;
  started: number;
  timer: (() => void) | null;
  pauses: Set<string>;
};
const defaultClock: Clock = {
  now: Date.now,
  schedule: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};
const confirmationTimeoutMs = 6_000;

/** Tab-local delivery and lifetimes. Resource owners decide when conditions resolve. */
export class NotificationStore {
  private entries: readonly Notification[] = [];
  private listeners = new Set<() => void>();
  private lifetimes = new Map<number, Lifetime>();
  private sequence = 0;
  private hidden = false;

  constructor(private readonly clock: Clock = defaultClock) {}

  read = (): readonly Notification[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  push = (input: NotificationInput): number => {
    const timeoutMs =
      input.timeoutMs === undefined
        ? input.severity === "success" || input.severity === "info"
          ? confirmationTimeoutMs
          : null
        : input.timeoutMs;
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
      throw new Error("A notification timeout must be a positive duration or null");
    const existing =
      input.key === undefined ? undefined : this.entries.find((n) => n.key === input.key);
    if (existing !== undefined) {
      if (
        existing.message === input.message &&
        existing.severity === input.severity &&
        existing.timeoutMs === timeoutMs
      ) {
        this.update(existing.id, input);
        return existing.id;
      }
      this.dismiss(existing.id);
    }
    const entry: Notification = { ...input, id: ++this.sequence, timeoutMs };
    this.entries = [...this.entries, entry];
    if (timeoutMs !== null) {
      const lifetime: Lifetime = {
        remaining: timeoutMs,
        started: this.clock.now(),
        timer: null,
        pauses: new Set(this.hidden ? ["hidden"] : []),
      };
      this.lifetimes.set(entry.id, lifetime);
      this.resume(entry.id, lifetime);
    }
    this.emit();
    return entry.id;
  };

  /** Refresh actions without restarting expiry or announcing the same message again. */
  update = (id: number, input: NotificationInput): void => {
    const entry = this.entries.find((n) => n.id === id);
    if (entry === undefined) return;
    this.entries = this.entries.map((n) =>
      n.id === id ? { ...input, id, timeoutMs: entry.timeoutMs } : n,
    );
    this.emit();
  };

  dismiss = (id: number): void => {
    const lifetime = this.lifetimes.get(id);
    lifetime?.timer?.();
    this.lifetimes.delete(id);
    const next = this.entries.filter((n) => n.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.emit();
  };

  dismissKey = (key: string): void => {
    const entry = this.entries.find((n) => n.key === key);
    if (entry !== undefined) this.dismiss(entry.id);
  };

  pause = (id: number, reason: string, paused: boolean): void => {
    const lifetime = this.lifetimes.get(id);
    if (lifetime === undefined || lifetime.pauses.has(reason) === paused) return;
    if (paused) {
      if (lifetime.timer !== null) {
        lifetime.timer();
        lifetime.timer = null;
        lifetime.remaining = Math.max(
          0,
          lifetime.remaining - (this.clock.now() - lifetime.started),
        );
      }
      lifetime.pauses.add(reason);
    } else {
      lifetime.pauses.delete(reason);
      this.resume(id, lifetime);
    }
  };

  setHidden = (hidden: boolean): void => {
    this.hidden = hidden;
    for (const id of this.lifetimes.keys()) this.pause(id, "hidden", hidden);
  };

  private resume(id: number, lifetime: Lifetime): void {
    if (lifetime.pauses.size > 0 || lifetime.timer !== null) return;
    lifetime.started = this.clock.now();
    lifetime.timer = this.clock.schedule(() => this.dismiss(id), lifetime.remaining);
  }

  dispose = (): void => {
    for (const entry of this.entries) this.dismiss(entry.id);
    this.listeners.clear();
  };
}
