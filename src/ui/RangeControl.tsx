import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ChangeItem } from '../model/changes';
import type { RangeState } from '../model/range';
import { excerpt } from './ChangeCard';

interface Props {
  range: RangeState;
  /** Number of Original body paragraphs. */
  paragraphCount: number;
  /** The detected end point, if any. */
  suggestedEndPoint: number | null;
  /** A new range; the dialog closes. */
  onChange: (range: RangeState) => void;
  /** Changes outside the range that start before the end point. */
  spanning: readonly ChangeItem[];
  /** Starts picking a paragraph in the Original's panel; the dialog closes. */
  onPick: () => void;
  onClose: () => void;
}

/** The comparison range has a control: the Original has at least two body paragraphs. */
export function hasRange(paragraphCount: number): boolean {
  return paragraphCount >= 2;
}

/** Where the comparison ends, in words: the dialog's first line and the Range button's tooltip. */
export function rangeMessage(range: RangeState, paragraphCount: number): string {
  if (range.endPoint === null) return 'Comparing the full documents.';
  const remaining = paragraphCount - range.endPoint;
  const rest =
    `The remaining ${remaining} ${remaining === 1 ? 'paragraph is' : 'paragraphs are'} treated as unedited: their changes are not listed, ` +
    'and the download keeps them as in the Original.';
  return range.mode === 'auto'
    ? `The edited document appears to end at paragraph ${range.endPoint} of the Original. ${rest}`
    : `Comparing the Original up to paragraph ${range.endPoint}. ${rest}`;
}

/**
 * The comparison range (FR-14 – FR-19), a modal dialog opened with the toolbar's Range button: the
 * detected or chosen end point, and the controls to set it by number or by picking a paragraph in
 * the left panel, or to compare the full documents. Paragraph numbers count the Original's body
 * paragraphs from 1; "up to paragraph N" keeps N in range, so N is also the end point's index.
 */
export function RangeDialog(props: Props) {
  const { range, paragraphCount, suggestedEndPoint, spanning, onPick, onClose } = props;
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const max = paragraphCount - 1;

  const choose = (next: RangeState) => {
    props.onChange(next);
    onClose();
  };
  const startEditing = () => {
    setValue(String(range.endPoint ?? suggestedEndPoint ?? max));
    setEditing(true);
  };
  const number = Number(value);
  const valid = Number.isInteger(number) && number >= 1 && number <= max;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (valid) choose({ mode: 'manual', endPoint: number });
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal range-control" data-testid="range-control" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Comparison range</h2>
        <p className="range-control__message">{rangeMessage(range, paragraphCount)}</p>
        {range.endPoint !== null && spanning.length > 0 && (
          <p className="range-control__message range-control__spanning" data-testid="range-spanning">
            {spanning.length === 1 ? 'A deletion starts' : `${spanning.length} deletions start`} before the end point and{' '}
            {spanning.length === 1 ? 'continues' : 'continue'} after it ({spanning.map((item) => `“${excerpt(item)}”`).join(', ')}).{' '}
            {spanning.length === 1 ? 'It is' : 'They are'} treated as outside the comparison as a whole, so the download keeps{' '}
            {spanning.length === 1 ? 'its' : 'their'} text.
          </p>
        )}
        {editing ? (
          <form className="range-control__form" onSubmit={apply}>
            <label>
              Compare the Original up to paragraph{' '}
              <input
                type="number"
                min={1}
                max={max}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={!valid}
                autoFocus
              />
            </label>
            <span className="range-control__of">of {paragraphCount}</span>
            <button type="submit" className="button button--primary" disabled={!valid}>
              Apply
            </button>
            <button type="button" className="button" onClick={onPick}>
              Pick in left panel
            </button>
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {!valid && <span className="range-control__error">Enter a number from 1 to {max}.</span>}
          </form>
        ) : (
          <div className="range-control__actions">
            <button ref={firstButton} type="button" className="button" onClick={startEditing}>
              {range.endPoint === null ? 'Set an end point…' : 'Change the end point…'}
            </button>
            {range.endPoint !== null && (
              <button type="button" className="button" onClick={() => choose({ mode: 'off', endPoint: null })}>
                Compare the full documents
              </button>
            )}
            {suggestedEndPoint !== null && range.endPoint !== suggestedEndPoint && (
              <button type="button" className="button" onClick={() => choose({ mode: 'auto', endPoint: suggestedEndPoint })}>
                Use the detected end point (paragraph {suggestedEndPoint})
              </button>
            )}
          </div>
        )}
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** The bar shown while picking the end point in the Original's panel (FR-16). */
export function RangePickingBar({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="range-picking" data-testid="range-picking" role="region" aria-label="Picking the end point">
      <p className="range-picking__message">Click the last paragraph to compare in the Original (left) panel. Esc cancels.</p>
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
