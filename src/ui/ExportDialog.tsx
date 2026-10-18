import { useEffect, useId, useRef, useState } from 'react';
import { EngineError } from '../engine/client';
import { DEFAULT_AUTHOR } from '../engine/types';
import type { ChangeItem } from '../model/changes';
import type { FormattingChoice, UndecidedChoice } from '../model/decisions';
import { KIND_LABELS, excerpt } from './ChangeCard';
import { Progress } from './Progress';

/** An export error as the reviewer reads it; `details` (the engine's message) is shown on request. */
export interface ExportFailure {
  message: string;
  details?: string;
}

export type ExportStatus = { status: 'idle' } | { status: 'running'; startedAt: number } | { status: 'error'; failure: ExportFailure };

/** Errors that name the revision the export could not handle (see `src/engine/rejectRewrite.ts`). */
const REVISION_ERRORS = new Set(['UnsupportedRevisionError', 'RevisionMarkupError']);

/**
 * The message for an export error. A revision the export cannot handle is named by its change:
 * the list number (`labels`, by item id) when it is listed, its kind and an excerpt of its text.
 */
export function exportFailure(error: unknown, items: readonly ChangeItem[], labels: ReadonlyMap<string, string>): ExportFailure {
  const details = error instanceof Error ? error.message : String(error);
  if (error instanceof EngineError && error.code && REVISION_ERRORS.has(error.code) && error.revisionId) {
    const revisionId = error.revisionId;
    const item = items.find((candidate) => candidate.revisionIds.includes(revisionId));
    let change = 'One of the changes';
    if (item) {
      const label = labels.get(item.id);
      const text = excerpt(item);
      change = `${label ? `Change ${label}` : 'A change outside the comparison range'} (${KIND_LABELS[item.kind]}${text ? `: “${text}”` : ''})`;
    }
    return {
      message: `${change} cannot be exported yet. Please report this problem, with the two documents if you can share them.`,
      details,
    };
  }
  return { message: 'The reviewed document could not be prepared.', details };
}

interface Props {
  /** Text changes in range and listed that have no decision. */
  undecided: number;
  /** Formatting changes in range; the choice applies to all of them. */
  formattingCount: number;
  formattingChoice: FormattingChoice;
  onFormattingChoice: (choice: FormattingChoice) => void;
  /** Changes in range that the compare settings ignore, and how many of them were decided before. */
  ignored: { count: number; decided: number };
  /** The comparison range, when one is set: the end point and the changes outside it. */
  outOfRange: { endPoint: number; count: number } | null;
  status: ExportStatus;
  /** What to do with undecided changes, as chosen last time. */
  initialUndecided: UndecidedChoice;
  /** The author to start with: the Edited's (`editedAuthor`), else the one used last time. */
  initialAuthor: string;
  /** Who made the Edited's changes, as the Edited says (FR-38c). */
  editedAuthor: string | null;
  onDownload: (choices: { undecided: UndecidedChoice; author: string }) => void;
  onCancel: () => void;
}

/**
 * The export dialog (FR-38): how to treat undecided changes (accept, reject, or keep as tracked
 * changes, FR-38b), the formatting choice, the author of comments and tracked changes (FR-38c),
 * what happens to ignored and out-of-range changes; progress and errors of the export. Stays open
 * on error.
 */
export function ExportDialog(props: Props) {
  const { undecided, formattingCount, ignored, outOfRange, status, editedAuthor, onCancel } = props;
  const titleId = useId();
  const authorId = useId();
  const [choice, setChoice] = useState<UndecidedChoice>(props.initialUndecided);
  const [author, setAuthor] = useState(props.initialAuthor);
  const running = status.status === 'running';
  const downloadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    downloadButton.current?.focus();
  }, []);
  useEffect(() => {
    if (running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, running]);

  return (
    <div className="modal-backdrop" onClick={(event) => !running && event.target === event.currentTarget && onCancel()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Download the reviewed document</h2>
        <fieldset className="export-dialog__group" disabled={running || undecided === 0}>
          <legend>
            {undecided === 0
              ? 'All text changes are decided.'
              : `${undecided} text ${undecided === 1 ? 'change is' : 'changes are'} undecided.`}
          </legend>
          {(
            [
              ['accept', 'Accept undecided changes', 'They take the Edited text.'],
              ['reject', 'Reject undecided changes', "They keep the Original's text."],
              ['track', 'Keep undecided changes as tracked changes', 'Word shows them as tracked changes, to accept or reject there.'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="modal__option">
              <input type="radio" name="undecided-choice" value={value} checked={choice === value} onChange={() => setChoice(value)} />
              <span>
                {label}
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {formattingCount > 0 && (
          <fieldset className="export-dialog__group" disabled={running}>
            <legend>
              Formatting ({formattingCount} {formattingCount === 1 ? 'change' : 'changes'}), for the whole document:
            </legend>
            {(
              [
                ['original', "Keep the Original's formatting"],
                ['edited', "Use the Edited's formatting"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="modal__option">
                <input
                  type="radio"
                  name="export-formatting-choice"
                  value={value}
                  checked={props.formattingChoice === value}
                  onChange={() => props.onFormattingChoice(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="export-dialog__author">
          <label htmlFor={authorId}>Author of the comments and tracked changes</label>
          <input
            id={authorId}
            type="text"
            value={author}
            placeholder={DEFAULT_AUTHOR}
            disabled={running}
            onChange={(event) => setAuthor(event.target.value)}
          />
          {editedAuthor !== null && author.trim() === editedAuthor && <small>As in the Edited document.</small>}
        </div>
        <ul className="export-dialog__notes">
          {ignored.count > 0 && (
            <li data-testid="export-ignored">
              {ignored.count} {ignored.count === 1 ? 'change is' : 'changes are'} ignored by the compare settings and{' '}
              {ignored.count === 1 ? 'takes' : 'take'} the Edited text
              {ignored.decided > 0 &&
                `, except ${ignored.decided} that you decided before the setting was turned on: ${ignored.decided === 1 ? 'it keeps its' : 'they keep their'} decision`}
              .
            </li>
          )}
          {outOfRange && (
            <li data-testid="export-out-of-range">
              The document after paragraph {outOfRange.endPoint} is outside the comparison range and keeps the Original's text
              {outOfRange.count > 0 && ` (${outOfRange.count} ${outOfRange.count === 1 ? 'change' : 'changes'} not applied)`}.
            </li>
          )}
        </ul>
        {status.status === 'running' && (
          <p className="export-dialog__status" aria-live="polite">
            <Progress startedAt={status.startedAt} stage="exporting" />
          </p>
        )}
        {status.status === 'error' && (
          <div className="export-dialog__error" role="alert">
            <p>{status.failure.message}</p>
            {status.failure.details && (
              <details>
                <summary>Details</summary>
                <pre>{status.failure.details}</pre>
              </details>
            )}
          </div>
        )}
        <div className="modal__actions">
          <button type="button" className="button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button
            ref={downloadButton}
            type="button"
            className="button button--primary"
            onClick={() => props.onDownload({ undecided: choice, author: author.trim() })}
            disabled={running}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
