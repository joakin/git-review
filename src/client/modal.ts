import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

type Modal = {
  ref: RefObject<HTMLDialogElement>;
  onCancel: (event: Event) => void;
};

export function useModal(onClose: () => void): Modal {
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
    const onPointerDown = (event: PointerEvent) => {
      if (dialog === null || !dialog.open) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      dialog?.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);
  return {
    ref,
    onCancel: (event: Event) => { event.preventDefault(); onClose(); },
  };
}
