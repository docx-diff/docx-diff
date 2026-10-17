import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import type { Decision, FormattingChoice } from '../model/decisions';
import type { ListEntry } from '../model/reviewList';
import { ChangeCard } from './ChangeCard';
import { ConfirmDialog } from './ConfirmDialog';

export interface ListTotals {
  text: { total: number; accepted: number; rejected: number; undecided: number };
  formatting: number;
  ignored: number;
}

interface Props {
  entries: readonly ListEntry[];
  decisions: Readonly<Record<string, Decision>>;
  /** The reviewer's comments by item id (FR-27b). */
  comments: Readonly<Record<string, string>>;
  currentItemId: string | null;
  onSelect: (itemId: string) => void;
  onDecide: (itemId: string, decision: Decision | null) => void;
  /** Decides every undecided text item from the start of the list up to and including `itemId`. */
  onDecideUntil: (itemId: string, decision: Decision) => void;
  /** `null` removes the comment. */
  onComment: (itemId: string, text: string | null) => void;
  /** Decides every undecided text item in the list. */
  onDecideAllUndecided: (decision: Decision) => void;
  formattingChoice: FormattingChoice;
  onFormattingChoice: (choice: FormattingChoice) => void;
  formattingExpanded: boolean;
  onFormattingExpanded: (expanded: boolean) => void;
  totals: ListTotals;
}

/**
 * The changes list (FR-26 – FR-36): bulk actions at the top, the virtualized list of text items in
 * document order with the formatting group, and the totals at the bottom. Selecting an item
 * elsewhere (panel, keyboard) scrolls the list to it.
 */
export function ChangesList(props: Props) {
  const { entries, decisions, currentItemId, onSelect, onDecide, totals } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<Decision | null>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => {
      const entry = entries[index]!;
      return entry.type === 'item' ? entry.item.id : 'formatting-group';
    },
  });

  useEffect(() => {
    if (currentItemId === null) return;
    const index = entries.findIndex((entry) => entry.type === 'item' && entry.item.id === currentItemId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [currentItemId, entries, virtualizer]);

  const undecided = totals.text.undecided;
  return (
    <aside className="changes" aria-label="Changes">
      <div className="changes__bulk">
        <button type="button" className="button button--accept" disabled={undecided === 0} onClick={() => setConfirm('accepted')}>
          Accept all
        </button>
        <button type="button" className="button button--reject" disabled={undecided === 0} onClick={() => setConfirm('rejected')}>
          Reject all
        </button>
      </div>
      <div ref={scrollerRef} className="changes__scroller" data-testid="changes-list">
        {entries.length === 0 && <p className="changes__empty">No changes to review.</p>}
        <div className="changes__inner" role="list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const entry = entries[row.index]!;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                role="listitem"
                className="changes__row"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {entry.type === 'item' ? (
                  <ChangeCard
                    item={entry.item}
                    label={entry.label}
                    decision={decisions[entry.item.id]}
                    current={entry.item.id === currentItemId}
                    onSelect={onSelect}
                    onDecide={onDecide}
                    onDecideUntil={props.onDecideUntil}
                    comment={props.comments[entry.item.id]}
                    onComment={props.onComment}
                  />
                ) : (
                  <FormattingGroupHeader
                    count={entry.count}
                    choice={props.formattingChoice}
                    onChoice={props.onFormattingChoice}
                    expanded={props.formattingExpanded}
                    onExpanded={props.onFormattingExpanded}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <footer className="changes__totals" data-testid="changes-totals">
        <div>
          {totals.text.total} text changes: {totals.text.accepted} accepted, {totals.text.rejected} rejected, {undecided} undecided
        </div>
        <div>
          {totals.formatting} formatting changes: {props.formattingChoice === 'edited' ? "the Edited's formatting" : "the Original's formatting"}
          {totals.ignored > 0 && <> · {totals.ignored} ignored</>}
        </div>
      </footer>
      {confirm && (
        <ConfirmDialog
          title={confirm === 'accepted' ? 'Accept all changes?' : 'Reject all changes?'}
          confirmLabel={confirm === 'accepted' ? 'Accept all' : 'Reject all'}
          onConfirm={() => {
            props.onDecideAllUndecided(confirm);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        >
          This {confirm === 'accepted' ? 'accepts' : 'rejects'} the {undecided} undecided text{' '}
          {undecided === 1 ? 'change' : 'changes'}. Changes you already decided keep their decision; formatting follows the
          formatting choice.
        </ConfirmDialog>
      )}
    </aside>
  );
}

function FormattingGroupHeader(props: {
  count: number;
  choice: FormattingChoice;
  onChoice: (choice: FormattingChoice) => void;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
}) {
  return (
    <div className="formatting-group" data-testid="formatting-group">
      <button
        type="button"
        className="formatting-group__toggle"
        aria-expanded={props.expanded}
        onClick={() => props.onExpanded(!props.expanded)}
      >
        <span aria-hidden="true">{props.expanded ? '▾' : '▸'}</span> Formatting changes ({props.count})
      </button>
      <fieldset className="formatting-group__choice">
        <legend className="visually-hidden">Formatting of the whole document</legend>
        {(
          [
            ['original', "Keep the Original's formatting"],
            ['edited', "Use the Edited's formatting"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="formatting-choice" value={value} checked={props.choice === value} onChange={() => props.onChoice(value)} />{' '}
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
