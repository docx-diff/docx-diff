import { useEffect, useRef } from 'react';
import type { CompareSettings } from '../model/equivalence';
import type { ViewSettings } from './useViewSettings';

const OPTIONS: { key: keyof CompareSettings; label: string; hint: string }[] = [
  {
    key: 'ignoreQuotes',
    label: 'Ignore quote style',
    hint: 'Straight, curly, low („) and upper (”) quotes count as the same, single and double kept apart; so do three dots and the ellipsis (…).',
  },
  {
    key: 'ignoreDashes',
    label: 'Ignore dash changes',
    hint: 'Hyphen, en dash (–), em dash (—) and minus count as the same.',
  },
  {
    key: 'ignoreWhitespace',
    label: 'Ignore whitespace changes',
    hint: 'Extra or missing spaces, tabs and line breaks, paragraph breaks and empty paragraphs.',
  },
];

interface Props {
  settings: CompareSettings;
  onChange: (settings: CompareSettings) => void;
  view: ViewSettings;
  onViewChange: (change: Partial<ViewSettings>) => void;
  onClose: () => void;
}

/**
 * Modal dialog with the compare settings. Changes apply at once and don't re-run the comparison:
 * ignored changes are not highlighted or listed, and the export takes the Edited version of them.
 * Below them, how the review is shown (FR-28a).
 */
export function CompareSettingsDialog({ settings, onChange, view, onViewChange, onClose }: Props) {
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="compare-settings-title">
        <h2 id="compare-settings-title">Compare settings</h2>
        <p className="modal__intro">
          Ignored changes are shown as plain text, left out of the list of changes, and the download takes them as in the
          Edited document.
        </p>
        {OPTIONS.map(({ key, label, hint }, i) => (
          <label key={key} className="modal__option">
            <input
              ref={i === 0 ? firstInput : undefined}
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}
            />
            <span>
              {label}
              <small>{hint}</small>
            </span>
          </label>
        ))}
        <h3 className="modal__section">Display</h3>
        <label className="modal__option">
          <input type="checkbox" checked={view.inlineCard} onChange={(event) => onViewChange({ inlineCard: event.target.checked })} />
          <span>
            Show the change card in the Edited document
            <small>The selected change's card, with Accept and Reject, appears under the change in the right panel.</small>
          </span>
        </label>
        <label className="modal__option">
          <input type="checkbox" checked={view.leftAligned} onChange={(event) => onViewChange({ leftAligned: event.target.checked })} />
          <span>
            Align the text to the left, never justified
            <small>In all columns. Justified text reads poorly in narrow columns; centred and right-aligned text stays so.</small>
          </span>
        </label>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
