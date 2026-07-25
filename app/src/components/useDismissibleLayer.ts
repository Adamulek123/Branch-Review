import { useEffect, type RefObject } from "react";

interface DismissibleLayerOptions {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  onDismiss(): void;
}

export function useDismissibleLayer({
  open,
  rootRef,
  triggerRef,
  onDismiss,
}: DismissibleLayerOptions): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
      triggerRef?.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss, open, rootRef, triggerRef]);
}
