import { useEffect } from 'react';

/** A short message; a new `id` shows it again (and restarts its timer) even when the text is the same. */
export interface ToastMessage {
  text: string;
  id: number;
}

const SHOWN_MS = 4000;

/**
 * A short status message (FR-25g) that hides itself after a few seconds (one at a time). The live
 * region stays in the page, so that each new message is announced.
 */
export function Toast({ message, onHide }: { message: ToastMessage | null; onHide: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onHide, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message, onHide]);
  return (
    <div className="toast" role="status">
      {message?.text}
    </div>
  );
}
