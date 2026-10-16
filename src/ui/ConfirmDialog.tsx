import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/** A modal yes/no question; Escape or a click outside cancels. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: Props) {
  const titleId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <p className="modal__intro">{children}</p>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmButton} type="button" className="button button--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
