import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useNotificationModal } from "./Notifications.tsx";

type Modal = {
  ref: RefObject<HTMLDialogElement>;
  onCancel: (event: Event) => void;
};

export function useModal(onClose: () => void): Modal {
  const registerModal = useNotificationModal();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialog?.showModal();
    const unregisterModal = dialog === null ? () => {} : registerModal(dialog);
    const onPointerDown = (event: PointerEvent) => {
      if (dialog === null || !dialog.open) return;
      if (
        event.target instanceof Element &&
        event.target.closest(".notification-viewport") !== null
      )
        return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      unregisterModal();
      dialog?.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);
  return {
    ref,
    onCancel: (event: Event) => {
      event.preventDefault();
      onClose();
    },
  };
}
