import { memo } from 'react';
import type { ChangeItem, ChangeKind } from '../model/changes';
import type { Decision } from '../model/decisions';

export const KIND_LABELS: Record<ChangeKind, string> = {
  inserted: 'Inserted',
  deleted: 'Deleted',
  replaced: 'Replaced',
  formatting: 'Formatting',
  moved: 'Moved',
  paragraph: 'Paragraph break',
};

const MAX_TEXT = 160;

/** Shortens long text for the card (the unedited tail can be 100,000 characters). */
export function truncate(text: string, max = MAX_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export function locationLabel(item: ChangeItem): string {
  switch (item.location.scope) {
    case 'footnote':
      return `Footnote ${item.location.noteId ?? ''}`.trim();
    case 'endnote':
      return `Endnote ${item.location.noteId ?? ''}`.trim();
    case 'table':
      return 'Table';
    case 'body':
      return 'Body';
  }
}

function wordDeltaLabel({ removed, added }: ChangeItem['wordDelta']): string {
  return [removed > 0 ? `−${removed}` : '', added > 0 ? `+${added}` : ''].filter(Boolean).join(' ');
}

interface Props {
  item: ChangeItem;
  /** The number shown, e.g. "12" or "F3". */
  label: string;
  /** Undefined: undecided. Formatting items have none (they follow the formatting choice). */
  decision: Decision | undefined;
  current: boolean;
  onSelect: (itemId: string) => void;
  /** `null` resets to undecided. */
  onDecide: (itemId: string, decision: Decision | null) => void;
}

/** One change in the changes list (FR-26, FR-27). Formatting items have no Accept/Reject (FR-30). */
export const ChangeCard = memo(function ChangeCard({ item, label, decision, current, onSelect, onDecide }: Props) {
  const formatting = item.kind === 'formatting';
  const state = formatting ? 'formatting' : (decision ?? 'undecided');
  const delta = wordDeltaLabel(item.wordDelta);
  return (
    <div
      className={`change-card change-card--${state}${current ? ' change-card--current' : ''}`}
      data-testid="change-card"
      data-item-id={item.id}
      aria-current={current ? 'true' : undefined}
      onClick={() => onSelect(item.id)}
    >
      <div className="change-card__header">
        <span className="change-card__number">{label}</span>
        <span className={`change-card__kind change-card__kind--${item.kind}`}>{KIND_LABELS[item.kind]}</span>
        <span className="change-card__location">{locationLabel(item)}</span>
        {delta && <span className="change-card__delta">{delta}</span>}
        {!formatting && <span className="change-card__state">{decision === 'accepted' ? '✓ Accepted' : decision === 'rejected' ? '✗ Rejected' : 'Undecided'}</span>}
      </div>
      <div className="change-card__text">
        {formatting || item.kind === 'moved' ? (
          <span className={item.kind === 'moved' ? 'change-card__moved' : undefined}>{truncate(item.text ?? '')}</span>
        ) : (
          <>
            {item.removedText && <del className="change-card__removed">{truncate(item.removedText)}</del>}
            {item.removedText && item.addedText && ' '}
            {item.addedText && <ins className="change-card__added">{truncate(item.addedText)}</ins>}
          </>
        )}
      </div>
      {formatting && <div className="change-card__description">{item.description ?? 'Formatting changed'}</div>}
      {!formatting && (
        <div className="change-card__actions">
          <button
            type="button"
            className="button button--small button--accept"
            aria-pressed={decision === 'accepted'}
            onClick={(event) => {
              event.stopPropagation();
              onDecide(item.id, 'accepted');
            }}
          >
            Accept
          </button>
          <button
            type="button"
            className="button button--small button--reject"
            aria-pressed={decision === 'rejected'}
            onClick={(event) => {
              event.stopPropagation();
              onDecide(item.id, 'rejected');
            }}
          >
            Reject
          </button>
          {decision && (
            <button
              type="button"
              className="button button--small button--plain"
              onClick={(event) => {
                event.stopPropagation();
                onDecide(item.id, null);
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
});
