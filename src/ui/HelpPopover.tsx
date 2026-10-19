import { useCallback, useRef } from 'react';
import { EditingHelp } from './EditingHelp';
import { Legend } from './Legend';
import { usePopoverDismiss } from './usePopoverDismiss';
import { SHORTCUTS } from './useKeyboardShortcuts';

const KEY_NAMES: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑' };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view shown: the legend has the Resolved column's marks in three-column view. */
  threeColumns: boolean;
}

/** Help button with a popover listing the keyboard shortcuts and the legend (FR-34). */
export function HelpPopover({ open, onOpenChange, threeColumns }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  usePopoverDismiss(open, close, containerRef);

  return (
    <div className="help" ref={containerRef}>
      <button
        type="button"
        className="button button--icon"
        aria-label="Help"
        title="Help"
        aria-expanded={open}
        aria-controls="help-popover"
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div id="help-popover" className="help__popover" role="dialog" aria-label="Help">
          <h2>Keyboard shortcuts</h2>
          <dl className="help__shortcuts">
            {SHORTCUTS.map(({ keys, label }) => (
              <div key={label}>
                <dt>
                  {keys.map((key, i) => (
                    <span key={key}>
                      {i > 0 && ' or '}
                      <kbd>{KEY_NAMES[key] ?? key}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
          <h2>Editing</h2>
          <EditingHelp />
          <h2>Colours</h2>
          <Legend threeColumns={threeColumns} />
          <p className="help__note">
            Formatting changes are not marked in the panels; review them in the formatting group of the changes list (its Fmt button shows it). Accepted
            changes are dimmed with ✓, rejected ones with ✗.
            {threeColumns && ' The Resolved column shows the result: decided changes on yellow with ✓ or ✗, undecided ones dotted.'}
          </p>
        </div>
      )}
    </div>
  );
}
