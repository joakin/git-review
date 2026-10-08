import { expect, test } from "bun:test";
import { NotificationStore } from "./notification-store.ts";

function timeline() {
  let now = 0;
  const pending = new Set<{ at: number; callback: () => void }>();
  const store = new NotificationStore({
    now: () => now,
    schedule: (callback, delay) => {
      const task = { at: now + delay, callback };
      pending.add(task);
      return () => {
        pending.delete(task);
      };
    },
  });
  return {
    store,
    advance: (duration: number) => {
      const target = now + duration;
      for (;;) {
        const next = [...pending].sort((a, b) => a.at - b.at)[0];
        if (next === undefined || next.at > target) break;
        now = next.at;
        pending.delete(next);
        next.callback();
      }
      now = target;
    },
    timers: () => pending.size,
  };
}

test("persistent warnings, timed confirmations and independent dismissal", () => {
  const { store, advance, timers } = timeline();
  const warning = store.push({ message: "New edits", severity: "warning" });
  store.push({ message: "Copied", severity: "success" });
  advance(6_000);
  expect(store.read().map((n) => n.id)).toEqual([warning]);
  advance(60_000);
  expect(store.read()).toHaveLength(1);
  store.dismiss(warning);
  expect(store.read()).toEqual([]);
  expect(timers()).toBe(0);
});

test("overlapping hover, focus and hidden-tab pauses preserve remaining time", () => {
  const { store, advance } = timeline();
  const id = store.push({ message: "Copied", severity: "success", timeoutMs: 1_000 });
  advance(400);
  store.pause(id, "hover", true);
  store.pause(id, "focus", true);
  store.setHidden(true);
  advance(10_000);
  store.pause(id, "hover", false);
  store.setHidden(false);
  advance(10_000);
  expect(store.read()).toHaveLength(1);
  store.pause(id, "focus", false);
  advance(599);
  expect(store.read()).toHaveLength(1);
  advance(1);
  expect(store.read()).toHaveLength(0);
});

test("new hidden-tab notices start paused and explicit no-timeout is honored", () => {
  const { store, advance } = timeline();
  store.setHidden(true);
  store.push({ message: "Timed", severity: "info", timeoutMs: 100 });
  store.push({ message: "Persistent", severity: "success", timeoutMs: null });
  advance(100_000);
  expect(store.read()).toHaveLength(2);
  store.setHidden(false);
  advance(100);
  expect(store.read().map((n) => n.message)).toEqual(["Persistent"]);
});

test("deduplication updates recovery actions without extending an unchanged notice", () => {
  const { store, advance } = timeline();
  let result = "";
  const id = store.push({ key: "copy", message: "Copied", severity: "success", timeoutMs: 100 });
  advance(50);
  expect(
    store.push({
      key: "copy",
      message: "Copied",
      severity: "success",
      timeoutMs: 100,
      action: {
        label: "Undo",
        run: () => {
          result = "undo";
        },
      },
    }),
  ).toBe(id);
  expect(store.read()).toHaveLength(1);
  store.read()[0]?.action?.run();
  expect(result).toBe("undo");
  advance(50);
  expect(store.read()).toHaveLength(0);
});

test("changed keyed messages replace their lifetime; resolution and disposal cancel timers", () => {
  const { store, advance, timers } = timeline();
  store.push({ key: "operation", message: "Saved", severity: "success", timeoutMs: 100 });
  store.push({ key: "operation", message: "Save failed", severity: "error" });
  expect(timers()).toBe(0);
  advance(1_000);
  expect(store.read().map((n) => n.message)).toEqual(["Save failed"]);
  store.dismissKey("operation");
  store.push({ message: "Temporary", severity: "info" });
  store.push({ message: "Persistent", severity: "error" });
  store.dispose();
  expect(store.read()).toHaveLength(0);
  expect(timers()).toBe(0);
  expect(() => store.push({ message: "Invalid", severity: "info", timeoutMs: -1 })).toThrow();
});
