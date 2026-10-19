import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChangeItem, ChangeKind } from '../model/changes';
import type { Decision } from '../model/decisions';
import { DecisionButton } from './DecisionButton';

/** The tooltip of the buttons that revert one change's inline edit (the card's, the Edited panel's ↺). */
export const REVERT_LABEL = 'Revert my edit of this change';

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

/** A short one-line quote of an item's text, for naming it in a message. */
export function excerpt(item: ChangeItem): string {
  const text = (item.removedText || item.addedText || item.text || '').replace(/¶/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
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

/** "−3 +2": the words removed, in the deletions' red, and added, in the insertions' blue. */
function WordDelta({ removed, added }: ChangeItem['wordDelta']) {
  if (removed === 0 && added === 0) return null;
  return (
    <span className="change-card__delta">
      {removed > 0 && <span className="change-card__delta-removed">−{removed}</span>}
      {removed > 0 && added > 0 && ' '}
      {added > 0 && <span className="change-card__delta-added">+{added}</span>}
    </span>
  );
}

interface Props {
  item: ChangeItem;
  /** The number shown, e.g. "12" or "F3". */
  label: string;
  /** Undefined: undecided. Formatting items have none (they follow the formatting choice). */
  decision: Decision | undefined;
  current: boolean;
  /** Undefined: the card can't be selected (the card shown in the Edited's panel is for the current item). */
  onSelect?: (itemId: string) => void;
  /** `null` resets to undecided. */
  onDecide: (itemId: string, decision: Decision | null) => void;
  /** Decides every undecided item up to and including this one (FR-27a). */
  onDecideUntil: (itemId: string, decision: Decision) => void;
  /** The reviewer's comment (FR-27b); undefined: none. */
  comment: string | undefined;
  /** `null` removes the comment. */
  onComment: (itemId: string, text: string | null) => void;
  /** Shows a close button in the corner (the card in the Edited's panel, FR-28a). */
  onClose?: () => void;
  /** Shows a Revert button: for a change the reviewer's inline edits created or changed (it asks first). */
  onRevert?: (itemId: string) => void;
  testId?: string;
}

/**
 * One change in the changes list (FR-26, FR-27), with its comment under it (FR-27b), or the current
 * change in the Edited's panel (FR-28a). Formatting items have no Accept/Reject (FR-30).
 */
export const ChangeCard = memo(function ChangeCard(props: Props) {
  const { item, label, decision, current, onSelect, onDecide, onDecideUntil, comment, onComment, onClose, onRevert } = props;
  const formatting = item.kind === 'formatting';
  const commentRef = useRef<HTMLTextAreaElement>(null);
  // Bumped by "… with comment": focuses the comment once it is there.
  const [focusComment, setFocusComment] = useState(0);
  useEffect(() => {
    if (focusComment > 0) commentRef.current?.focus();
  }, [focusComment]);
  const openComment = () => {
    if (comment === undefined) onComment(item.id, '');
    setFocusComment((n) => n + 1);
  };
  const state = formatting ? 'formatting' : (decision ?? 'undecided');
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onSelect(item.id);
  };
  return (
    <div
      className={`change-card change-card--${state}${current ? ' change-card--current' : ''}`}
      data-testid={props.testId ?? 'change-card'}
      data-item-id={item.id}
      aria-current={current ? 'true' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect && (() => onSelect(item.id))}
      onKeyDown={onKeyDown}
    >
      <div className="change-card__header">
        <span className="change-card__number">{label}</span>
        <span className={`change-card__kind change-card__kind--${item.kind}`}>{KIND_LABELS[item.kind]}</span>
        <span className="change-card__location">{locationLabel(item)}</span>
        <WordDelta {...item.wordDelta} />
        {!formatting && <span className="change-card__state">{decision === 'accepted' ? '✓ Accepted' : decision === 'rejected' ? '✗ Rejected' : 'Undecided'}</span>}
        {onClose && (
          <button type="button" className="change-card__close" aria-label="Hide this card" title="Hide this card (Esc)" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div className="change-card__text">
        {item.moveEdit ? (
          // A move that carries edits: the wording at the source and at the destination.
          <>
            <del className="change-card__removed">{truncate(item.moveEdit.from)}</del>{' '}
            <ins className="change-card__added">{truncate(item.moveEdit.to)}</ins>
          </>
        ) : formatting || item.kind === 'moved' ? (
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
          {(['accepted', 'rejected'] as const).map((value) => (
            <DecisionButton
              key={value}
              decision={value}
              pressed={decision === value}
              onThis={() => onDecide(item.id, value)}
              onWithComment={() => {
                onDecide(item.id, value);
                openComment();
              }}
              onUndecidedWithComment={() => {
                if (decision) onDecide(item.id, null);
                openComment();
              }}
              onUntilHere={() => onDecideUntil(item.id, value)}
            />
          ))}
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
          {onRevert && (
            <button
              type="button"
              className="button button--small button--plain change-card__revert"
              title={REVERT_LABEL}
              aria-label={REVERT_LABEL}
              onClick={(event) => {
                event.stopPropagation();
                onRevert(item.id);
              }}
            >
              <span aria-hidden="true">↺</span> Revert
            </button>
          )}
        </div>
      )}
      {!formatting && comment !== undefined && (
        // Clicks and keys here are the comment's, not the card's.
        <div className="change-card__comment" onClick={(event) => event.stopPropagation()}>
          <textarea
            ref={commentRef}
            className="change-card__comment-text"
            aria-label={`Comment on change ${label}`}
            placeholder="Comment for the exported document"
            rows={2}
            value={comment}
            onChange={(event) => onComment(item.id, event.target.value)}
          />
          <button type="button" className="button button--small button--plain" onClick={() => onComment(item.id, null)}>
            Remove comment
          </button>
        </div>
      )}
    </div>
  );
});
