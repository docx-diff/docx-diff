import { useEffect, type RefObject } from 'react';

/** Closes an open popover on Escape or a pointer press outside `containerRef` (its button included in it). */
export function usePopoverDismiss(open: boolean, onClose: () => void, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, containerRef]);
}
