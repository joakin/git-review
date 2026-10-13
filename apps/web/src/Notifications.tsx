import { createContext, type ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  NotificationStore,
  type Notification,
  type NotificationInput,
} from "./notification-store.ts";

function createCenter() {
  const store = new NotificationStore();
  const dialogs: HTMLDialogElement[] = [];
  const listeners = new Set<() => void>();
  return {
    store,
    readModal: () => dialogs.at(-1) ?? null,
    subscribeModal: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    registerModal: (dialog: HTMLDialogElement) => {
      dialogs.push(dialog);
      for (const listener of listeners) listener();
      return () => {
        const index = dialogs.indexOf(dialog);
        if (index >= 0) dialogs.splice(index, 1);
        for (const listener of listeners) listener();
      };
    },
  };
}
const NotificationContext = createContext<ReturnType<typeof createCenter> | null>(null);

function useCenter() {
  const center = useContext(NotificationContext);
  if (center === null) throw new Error("Notifications need an application provider");
  return center;
}

export function useNotifications(): NotificationStore {
  return useCenter().store;
}

export function useNotificationModal() {
  return useCenter().registerModal;
}

/** An unchanged dismissed condition stays dismissed until it resolves or changes. */
export function useNotification(key: string, input: NotificationInput | null): void {
  const store = useNotifications();
  const latest = useRef(input);
  latest.current = input;
  const id = useRef<number | null>(null);
  useLayoutEffect(() => {
    const current = latest.current;
    if (current === null) return;
    id.current = store.push({ ...current, key });
    return () => {
      if (id.current !== null) store.dismiss(id.current);
      id.current = null;
    };
  }, [store, key, input?.message, input?.severity]);
  useLayoutEffect(() => {
    if (id.current !== null && input !== null) store.update(id.current, { ...input, key });
  });
}

export function NotificationProvider({ children }: { children: ComponentChildren }) {
  const [center] = useState(createCenter);
  useEffect(() => () => center.store.dispose(), [center]);
  return (
    <NotificationContext.Provider value={center}>
      {children}
      <NotificationLayer />
    </NotificationContext.Provider>
  );
}

function NotificationLayer() {
  const center = useCenter();
  const [entries, setEntries] = useState(center.store.read);
  const [modal, setModal] = useState(center.readModal);
  useLayoutEffect(() => {
    const update = () => setEntries(center.store.read());
    const updateModal = () => setModal(center.readModal());
    const unsubscribe = center.store.subscribe(update);
    const unsubscribeModal = center.subscribeModal(updateModal);
    update();
    updateModal();
    return () => {
      unsubscribe();
      unsubscribeModal();
    };
  }, [center]);
  useEffect(() => {
    const update = () => center.store.setHidden(document.visibilityState !== "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [center]);
  return createPortal(
    <NotificationViewport entries={entries} store={center.store} modal={modal} />,
    modal ?? document.body,
  );
}

function NotificationViewport({
  entries,
  store,
  modal,
}: {
  entries: readonly Notification[];
  store: NotificationStore;
  modal: HTMLDialogElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    bottom: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    dock: 0,
  }));
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof element.showPopover !== "function" || entries.length === 0)
      return;
    element.showPopover();
    return () => {
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, [entries.length > 0]);
  useLayoutEffect(() => {
    const visual = window.visualViewport;
    const update = () => {
      const height = visual?.height ?? window.innerHeight;
      const visibleBottom = (visual?.offsetTop ?? 0) + height;
      const element = ref.current;
      const stack = element?.querySelector(".notification-stack")?.getBoundingClientRect();
      const stackHeight = Math.min(element?.getBoundingClientRect().height ?? 0, height * 0.45);
      const dockToken = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--notification-dock-offset"),
      );
      let dock = modal === null && Number.isFinite(dockToken) ? dockToken : 0;
      if (modal !== null && stack !== undefined) {
        // Preserve the modal's recovery/composer controls when they meet the toast's footprint.
        const controls = [
          ...modal.querySelectorAll<HTMLElement>(
            ".review-dialog-head, .review-dialog-actions, .voice-footer, .install-import-label, .install-data-content section > button, .install-preview > button",
          ),
        ]
          .map((control) => control.getBoundingClientRect())
          .filter((rect) => rect.height > 0 && rect.right > stack.left && rect.left < stack.right);
        const dialog = modal.getBoundingClientRect();
        for (const rect of controls.sort((a, b) => b.top - a.top)) {
          const bottom = visibleBottom - dock;
          if (
            rect.bottom > bottom - stackHeight &&
            rect.top < bottom &&
            rect.top < dialog.bottom &&
            rect.bottom > dialog.top
          )
            dock = Math.min(visibleBottom - rect.top + 8, Math.max(0, height - stackHeight - 8));
        }
      }
      const next = {
        bottom:
          visual === null ? 0 : Math.max(0, window.innerHeight - visual.height - visual.offsetTop),
        left: visual?.offsetLeft ?? 0,
        width: visual?.width ?? window.innerWidth,
        height,
        dock,
      };
      setViewport((current) =>
        current.bottom === next.bottom &&
        current.left === next.left &&
        current.width === next.width &&
        current.height === next.height &&
        current.dock === next.dock
          ? current
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (modal !== null) {
      observer.observe(modal);
      for (const control of modal.querySelectorAll(
        ".review-dialog-head, .review-dialog-actions, .voice-footer, .install-data-content",
      ))
        observer.observe(control);
      modal.addEventListener("scroll", update, true);
    }
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      modal?.removeEventListener("scroll", update, true);
    };
  }, [modal, entries]);
  return (
    <div
      class="notification-viewport"
      ref={ref}
      popover={typeof HTMLElement.prototype.showPopover === "function" ? "manual" : undefined}
      hidden={entries.length === 0}
      aria-label="Notifications"
      role="region"
      style={{
        bottom: `${viewport.bottom + viewport.dock}px`,
        left: `${viewport.left}px`,
        width: `${viewport.width}px`,
        maxHeight: `${viewport.height * 0.45}px`,
      }}
    >
      <div class="notification-stack">
        {entries.map((entry) => (
          <NotificationCard key={entry.id} entry={entry} store={store} />
        ))}
      </div>
    </div>
  );
}

function NotificationCard({ entry, store }: { entry: Notification; store: NotificationStore }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      store.pause(entry.id, "hover", false);
      store.pause(entry.id, "focus", false);
    },
    [store, entry.id],
  );
  function dismiss(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && ref.current?.contains(focused)) {
      const dialog = ref.current.closest("dialog");
      const target =
        dialog?.querySelector<HTMLElement>("button:not(:disabled), textarea, input") ??
        document.querySelector<HTMLElement>(".topbar button");
      target?.focus({ preventScroll: true });
    }
    store.dismiss(entry.id);
  }
  return (
    <div
      ref={ref}
      class={`notification notification-${entry.severity}`}
      data-notification-key={entry.key}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") store.pause(entry.id, "hover", true);
      }}
      onPointerLeave={() => store.pause(entry.id, "hover", false)}
      onFocusIn={() => store.pause(entry.id, "focus", true)}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          store.pause(entry.id, "focus", false);
      }}
    >
      <span class="notification-icon" aria-hidden="true">
        {entry.severity === "success" ? "✓" : entry.severity === "info" ? "i" : "!"}
      </span>
      <div class="notification-content">
        <p role={entry.severity === "error" ? "alert" : "status"} aria-atomic="true">
          {entry.message}
        </p>
        {entry.action !== undefined && (
          <button
            class="notification-action"
            type="button"
            disabled={entry.action.disabled}
            onClick={entry.action.run}
          >
            {entry.action.label}
          </button>
        )}
      </div>
      <button
        class="notification-dismiss"
        type="button"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
