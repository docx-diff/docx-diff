// The reviewer's decisions (FR-27, FR-30, FR-32) and the final decision of every engine revision
// for the export (PRD §7.3 step 1). Text items are decided one by one; formatting is decided once
// for the whole document (`formattingChoice`).
import type { ChangeItem } from './changes';
import type { RangeClass } from './range';

export type Decision = 'accepted' | 'rejected';

/** Whose formatting the export uses: the Original's (formatting changes rejected) or the Edited's (accepted). */
export type FormattingChoice = 'original' | 'edited';

/** What the export does with a text change left undecided. */
export type UndecidedChoice = 'accept' | 'reject';

export interface DecisionState {
  /** Decisions of text items by item id; an absent id is undecided. */
  decisions: Record<string, Decision>;
  formattingChoice: FormattingChoice;
}

export const INITIAL_DECISIONS: DecisionState = { decisions: {}, formattingChoice: 'edited' };

export type DecisionAction =
  | { type: 'set'; itemId: string; decision: Decision }
  | { type: 'reset'; itemId: string }
  /** Decides the undecided ones among `itemIds` (the reviewable items, see `reviewableItems`). */
  | { type: 'acceptAllUndecided'; itemIds: readonly string[] }
  | { type: 'rejectAllUndecided'; itemIds: readonly string[] }
  | { type: 'setFormattingChoice'; choice: FormattingChoice }
  /** Back to no decisions, e.g. for a new comparison. */
  | { type: 'clear' };

export function decisionsReducer(state: DecisionState, action: DecisionAction): DecisionState {
  switch (action.type) {
    case 'set':
      if (state.decisions[action.itemId] === action.decision) return state;
      return { ...state, decisions: { ...state.decisions, [action.itemId]: action.decision } };
    case 'reset': {
      if (!(action.itemId in state.decisions)) return state;
      const { [action.itemId]: _removed, ...decisions } = state.decisions;
      return { ...state, decisions };
    }
    case 'acceptAllUndecided':
    case 'rejectAllUndecided': {
      const decision: Decision = action.type === 'acceptAllUndecided' ? 'accepted' : 'rejected';
      const undecided = action.itemIds.filter((id) => !(id in state.decisions));
      if (undecided.length === 0) return state;
      const decisions = { ...state.decisions };
      for (const id of undecided) decisions[id] = decision;
      return { ...state, decisions };
    }
    case 'setFormattingChoice':
      return state.formattingChoice === action.choice ? state : { ...state, formattingChoice: action.choice };
    case 'clear':
      return INITIAL_DECISIONS;
  }
}

/**
 * The text items the reviewer decides, in document order: not formatting, inside the comparison
 * range, and not ignored by the compare settings. These are listed, counted, navigated and affected
 * by the bulk actions. (Decisions of the others are kept, so they apply again when an item comes
 * back, e.g. after a setting is turned off.)
 */
export function reviewableItems(
  items: readonly ChangeItem[],
  range: ReadonlyMap<string, RangeClass>,
  ignored: ReadonlySet<string>,
): ChangeItem[] {
  return items.filter((item) => item.kind !== 'formatting' && range.get(item.id) !== 'outOfRange' && !ignored.has(item.id));
}

/** Formatting items inside the comparison range, in document order. */
export function formattingItems(items: readonly ChangeItem[], range: ReadonlyMap<string, RangeClass>): ChangeItem[] {
  return items.filter((item) => item.kind === 'formatting' && range.get(item.id) !== 'outOfRange');
}

/**
 * The final decision of every engine revision, by revision id, in this order:
 * out of range → reject (keeps the Original's text, FR-17); formatting → the formatting choice;
 * an explicit decision; ignored by the compare settings → accept; otherwise `undecided`.
 * An explicit decision wins over the ignore setting.
 */
export function finalRevisionDecisions(
  items: readonly ChangeItem[],
  state: DecisionState,
  range: ReadonlyMap<string, RangeClass>,
  undecided: UndecidedChoice,
  ignored: ReadonlySet<string>,
): Map<string, 'accept' | 'reject'> {
  const result = new Map<string, 'accept' | 'reject'>();
  for (const item of items) {
    const decision = state.decisions[item.id];
    let final: 'accept' | 'reject';
    if (range.get(item.id) === 'outOfRange') final = 'reject';
    else if (item.kind === 'formatting') final = state.formattingChoice === 'edited' ? 'accept' : 'reject';
    else if (decision) final = decision === 'accepted' ? 'accept' : 'reject';
    else if (ignored.has(item.id)) final = 'accept';
    else final = undecided;
    for (const revisionId of item.revisionIds) result.set(revisionId, final);
  }
  return result;
}

/** Counts of the reviewable items by decision. */
export function decisionTotals(
  reviewable: readonly ChangeItem[],
  decisions: Readonly<Record<string, Decision>>,
): { total: number; accepted: number; rejected: number; undecided: number } {
  let accepted = 0;
  let rejected = 0;
  for (const item of reviewable) {
    const decision = decisions[item.id];
    if (decision === 'accepted') accepted++;
    else if (decision === 'rejected') rejected++;
  }
  return { total: reviewable.length, accepted, rejected, undecided: reviewable.length - accepted - rejected };
}
