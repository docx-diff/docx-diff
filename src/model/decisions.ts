// The reviewer's decisions (FR-27, FR-30, FR-32) and the final decision of every engine revision
// for the export (docs/architecture.md, "Export"). Text items are decided one by one; formatting is
// decided once for the whole document (`formattingChoice`).
import type { FinalDecision, FormattingChoice } from '../engine/types';
import type { ChangeItem } from './changes';
import type { RangeClass } from './range';

export type { FinalDecision, FormattingChoice };

export type Decision = 'accepted' | 'rejected';

/** What the export does with a text change left undecided; `track` keeps it as a Word tracked change (FR-38b). */
export type UndecidedChoice = 'accept' | 'reject' | 'track';

export interface DecisionState {
  /** Decisions of text items by item id; an absent id is undecided. */
  decisions: Record<string, Decision>;
  formattingChoice: FormattingChoice;
  /** The reviewer's comments on text items by item id (FR-27b); kept when the decision is reset. */
  comments: Record<string, string>;
}

export const INITIAL_DECISIONS: DecisionState = { decisions: {}, formattingChoice: 'edited', comments: {} };

export type DecisionAction =
  | { type: 'set'; itemId: string; decision: Decision }
  | { type: 'reset'; itemId: string }
  /** Decides the undecided ones among `itemIds` (the reviewable items, see `reviewableItems`). */
  | { type: 'acceptAllUndecided'; itemIds: readonly string[] }
  | { type: 'rejectAllUndecided'; itemIds: readonly string[] }
  | { type: 'setFormattingChoice'; choice: FormattingChoice }
  /** `null` removes the comment. */
  | { type: 'setComment'; itemId: string; text: string | null }
  /** Back to no decisions, e.g. for a new comparison. */
  | { type: 'clear' }
  /** A saved review's decisions. */
  | { type: 'restore'; state: DecisionState };

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
    case 'setComment': {
      if (action.text === null) {
        if (!(action.itemId in state.comments)) return state;
        const { [action.itemId]: _removed, ...comments } = state.comments;
        return { ...state, comments };
      }
      if (state.comments[action.itemId] === action.text) return state;
      return { ...state, comments: { ...state.comments, [action.itemId]: action.text } };
    }
    case 'clear':
      return INITIAL_DECISIONS;
    case 'restore':
      return action.state;
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

/** The ids of `reviewable` from the first up to and including `itemId` (none if it is not among them). */
export function idsUntil(reviewable: readonly ChangeItem[], itemId: string): string[] {
  const at = reviewable.findIndex((item) => item.id === itemId);
  return reviewable.slice(0, at + 1).map((item) => item.id);
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
): Map<string, FinalDecision> {
  const result = new Map<string, FinalDecision>();
  for (const item of items) {
    const final = finalItemDecision(item, state, range, undecided, ignored);
    for (const revisionId of item.revisionIds) result.set(revisionId, final);
  }
  return result;
}

/** The final decision of one item, applied to all its revisions (see `finalRevisionDecisions`). */
export function finalItemDecision<U extends UndecidedChoice>(
  item: ChangeItem,
  state: DecisionState,
  range: ReadonlyMap<string, RangeClass>,
  undecided: U,
  ignored: ReadonlySet<string>,
): 'accept' | 'reject' | U {
  const decision = state.decisions[item.id];
  if (range.get(item.id) === 'outOfRange') return 'reject';
  if (item.kind === 'formatting') return state.formattingChoice === 'edited' ? 'accept' : 'reject';
  if (decision) return decision === 'accepted' ? 'accept' : 'reject';
  if (ignored.has(item.id)) return 'accept';
  return undecided;
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
