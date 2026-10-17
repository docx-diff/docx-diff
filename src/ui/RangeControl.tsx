import { useState, type FormEvent } from 'react';
import type { ChangeItem } from '../model/changes';
import type { RangeState } from '../model/range';
import { excerpt } from './ChangeCard';

interface Props {
  range: RangeState;
  /** Number of Original body paragraphs. */
  paragraphCount: number;
  /** The detected end point, if any. */
  suggestedEndPoint: number | null;
  onChange: (range: RangeState) => void;
  /** Changes outside the range that start before the end point. */
  spanning: readonly ChangeItem[];
  /** Waiting for a click on a paragraph in the Original's panel. */
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
}

/**
 * The comparison range (FR-14 – FR-19): the notice of the detected or chosen end point, and the
 * controls to set it by number or by picking a paragraph in the left panel, or to compare the full
 * documents. Paragraph numbers count the Original's body paragraphs from 1; "up to paragraph N"
 * keeps N in range, so N is also the end point's index.
 */
export function RangeControl(props: Props) {
  const { range, paragraphCount, suggestedEndPoint, onChange, spanning, picking, onPickingChange } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const max = paragraphCount - 1;
  if (paragraphCount < 2) return null;

  const startEditing = () => {
    setValue(String(range.endPoint ?? suggestedEndPoint ?? max));
    setEditing(true);
  };
  const number = Number(value);
  const valid = Number.isInteger(number) && number >= 1 && number <= max;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onChange({ mode: 'manual', endPoint: number });
    setEditing(false);
  };

  let message;
  if (picking) {
    message = <>Click the last paragraph to compare in the Original (left) panel. Esc cancels.</>;
  } else if (range.endPoint === null) {
    message = <>Comparing the full documents.</>;
  } else {
    const remaining = paragraphCount - range.endPoint;
    const rest = (
      <>
        The remaining {remaining} {remaining === 1 ? 'paragraph is' : 'paragraphs are'} treated as unedited: their changes are not listed,
        and the download keeps them as in the Original.
      </>
    );
    message =
      range.mode === 'auto' ? (
        <>
          The edited document appears to end at paragraph {range.endPoint} of the Original. {rest}
        </>
      ) : (
        <>
          Comparing the Original up to paragraph {range.endPoint}. {rest}
        </>
      );
  }

  return (
    <div className="range-control" data-testid="range-control" aria-label="Comparison range" role="region">
      <p className="range-control__message">{message}</p>
      {!picking && range.endPoint !== null && spanning.length > 0 && (
        <p className="range-control__message range-control__spanning" data-testid="range-spanning">
          {spanning.length === 1 ? 'A deletion starts' : `${spanning.length} deletions start`} before the end point and{' '}
          {spanning.length === 1 ? 'continues' : 'continue'} after it ({spanning.map((item) => `“${excerpt(item)}”`).join(', ')}).{' '}
          {spanning.length === 1 ? 'It is' : 'They are'} treated as outside the comparison as a whole, so the download keeps{' '}
          {spanning.length === 1 ? 'its' : 'their'} text.
        </p>
      )}
      <div className="range-control__actions">
        {picking ? (
          <button type="button" className="button" onClick={() => onPickingChange(false)}>
            Cancel
          </button>
        ) : editing ? (
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
            <button
              type="button"
              className="button"
              onClick={() => {
                setEditing(false);
                onPickingChange(true);
              }}
            >
              Pick in left panel
            </button>
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {!valid && <span className="range-control__error">Enter a number from 1 to {max}.</span>}
          </form>
        ) : (
          <>
            <button type="button" className="button" onClick={startEditing}>
              {range.endPoint === null ? 'Set an end point…' : 'Change the end point…'}
            </button>
            {range.endPoint !== null && (
              <button type="button" className="button" onClick={() => onChange({ mode: 'off', endPoint: null })}>
                Compare the full documents
              </button>
            )}
            {suggestedEndPoint !== null && range.endPoint !== suggestedEndPoint && (
              <button type="button" className="button" onClick={() => onChange({ mode: 'auto', endPoint: suggestedEndPoint })}>
                Use the detected end point (paragraph {suggestedEndPoint})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
