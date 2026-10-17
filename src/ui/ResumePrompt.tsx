import { useEffect, useId, useRef } from 'react';

interface Props {
  originalName: string;
  editedName: string;
  /** ISO date of the last save. */
  savedAt: string;
  /** False while resuming (the files are being checked). */
  disabled?: boolean;
  onResume: () => void;
  /** Keeps the saved review until another comparison replaces it. Also on Escape. */
  onStartNew: () => void;
  onDiscard: () => void;
}

/** Offers to resume the review saved by an earlier visit (FR-47, FR-48). */
export function ResumePrompt({ originalName, editedName, savedAt, disabled = false, onResume, onStartNew, onDiscard }: Props) {
  const titleId = useId();
  const resumeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    resumeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onStartNew();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStartNew]);

  const date = new Date(savedAt);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>
          Resume review of {originalName} → {editedName}?
        </h2>
        <p className="modal__intro">
          {Number.isNaN(date.getTime()) ? 'A review was saved in this browser.' : `Last saved ${date.toLocaleString()}.`} Resuming
          compares the two documents again and restores your decisions and the comparison range.
        </p>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onDiscard} disabled={disabled}>
            Discard
          </button>
          <button type="button" className="button" onClick={onStartNew} disabled={disabled}>
            Start new
          </button>
          <button ref={resumeButton} type="button" className="button button--primary" onClick={onResume} disabled={disabled}>
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
