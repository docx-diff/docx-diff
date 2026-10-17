import { describe, expect, it } from 'vitest';
import type { ChangeItem, ChangeKind } from './changes';
import {
  INITIAL_DECISIONS,
  decisionTotals,
  decisionsReducer,
  finalRevisionDecisions,
  formattingItems,
  reviewableItems,
  type DecisionState,
} from './decisions';
import type { RangeClass } from './range';

function item(id: string, kind: ChangeKind, revisionIds = [id]): ChangeItem {
  return {
    id,
    kind,
    revisionIds,
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order: 0,
    anchors: [],
  };
}

// a, b, c: text items (b out of range); f, g: formatting (g out of range); i: ignored.
const items = [item('a', 'replaced', ['a', 'a2']), item('f', 'formatting'), item('b', 'deleted'), item('i', 'inserted'), item('c', 'moved'), item('g', 'formatting')];
const range = new Map<string, RangeClass>([
  ['a', 'inRange'],
  ['f', 'inRange'],
  ['b', 'outOfRange'],
  ['i', 'inRange'],
  ['c', 'inRange'],
  ['g', 'outOfRange'],
]);
const ignored = new Set(['i']);
const reviewable = reviewableItems(items, range, ignored).map((x) => x.id);

describe('decisionsReducer', () => {
  it('sets, changes and resets a decision', () => {
    let state = decisionsReducer(INITIAL_DECISIONS, { type: 'set', itemId: 'a', decision: 'accepted' });
    expect(state.decisions).toEqual({ a: 'accepted' });
    state = decisionsReducer(state, { type: 'set', itemId: 'a', decision: 'rejected' });
    expect(state.decisions).toEqual({ a: 'rejected' });
    state = decisionsReducer(state, { type: 'reset', itemId: 'a' });
    expect(state.decisions).toEqual({});
  });

  it('returns the same state when nothing changes', () => {
    const state = decisionsReducer(INITIAL_DECISIONS, { type: 'set', itemId: 'a', decision: 'accepted' });
    expect(decisionsReducer(state, { type: 'set', itemId: 'a', decision: 'accepted' })).toBe(state);
    expect(decisionsReducer(state, { type: 'reset', itemId: 'x' })).toBe(state);
    expect(decisionsReducer(state, { type: 'setFormattingChoice', choice: 'edited' })).toBe(state);
  });

  it('accepts or rejects only the undecided reviewable items', () => {
    let state = decisionsReducer(INITIAL_DECISIONS, { type: 'set', itemId: 'c', decision: 'rejected' });
    state = decisionsReducer(state, { type: 'acceptAllUndecided', itemIds: reviewable });
    // b (out of range), i (ignored) and the formatting items are left alone; c keeps its decision.
    expect(state.decisions).toEqual({ a: 'accepted', c: 'rejected' });

    state = decisionsReducer({ ...state, decisions: { a: 'accepted' } }, { type: 'rejectAllUndecided', itemIds: reviewable });
    expect(state.decisions).toEqual({ a: 'accepted', c: 'rejected' });
  });

  it('sets the formatting choice and clears everything', () => {
    let state = decisionsReducer(INITIAL_DECISIONS, { type: 'setFormattingChoice', choice: 'original' });
    expect(state.formattingChoice).toBe('original');
    state = decisionsReducer({ ...state, decisions: { a: 'accepted' } }, { type: 'clear' });
    expect(state).toEqual({ decisions: {}, formattingChoice: 'edited' });
  });

  it('restores a saved state', () => {
    const saved = { decisions: { a: 'rejected' as const }, formattingChoice: 'original' as const };
    expect(decisionsReducer(INITIAL_DECISIONS, { type: 'restore', state: saved })).toEqual(saved);
  });
});

describe('reviewableItems and formattingItems', () => {
  it('leave out formatting, out-of-range and ignored items', () => {
    expect(reviewable).toEqual(['a', 'c']);
    expect(formattingItems(items, range).map((x) => x.id)).toEqual(['f']);
  });
});

describe('finalRevisionDecisions', () => {
  const decide = (state: DecisionState, undecided: 'accept' | 'reject' = 'accept') =>
    Object.fromEntries(finalRevisionDecisions(items, state, range, undecided, ignored));

  it('gives every revision a decision, undecided ones the undecided choice', () => {
    expect(decide(INITIAL_DECISIONS)).toEqual({ a: 'accept', a2: 'accept', f: 'accept', b: 'reject', i: 'accept', c: 'accept', g: 'reject' });
    expect(decide(INITIAL_DECISIONS, 'reject')).toEqual({ a: 'reject', a2: 'reject', f: 'accept', b: 'reject', i: 'accept', c: 'reject', g: 'reject' });
  });

  it('rejects out-of-range items whatever their decision', () => {
    expect(decide({ decisions: { b: 'accepted' }, formattingChoice: 'edited' }).b).toBe('reject');
  });

  it('applies the formatting choice to formatting items in range', () => {
    const result = decide({ decisions: { f: 'accepted' }, formattingChoice: 'original' });
    expect(result.f).toBe('reject');
    expect(result.g).toBe('reject');
  });

  it('applies explicit decisions to all revisions of an item', () => {
    const result = decide({ decisions: { a: 'rejected', c: 'accepted' }, formattingChoice: 'edited' }, 'reject');
    expect([result.a, result.a2, result.c]).toEqual(['reject', 'reject', 'accept']);
  });

  it('keeps the decision of an item that a setting later ignores', () => {
    expect(decide({ decisions: { i: 'rejected' }, formattingChoice: 'edited' }).i).toBe('reject');
  });
});

describe('decisionTotals', () => {
  it('counts the reviewable items by decision', () => {
    const list = reviewableItems(items, range, ignored);
    expect(decisionTotals(list, { a: 'rejected', b: 'accepted', i: 'accepted' })).toEqual({ total: 2, accepted: 0, rejected: 1, undecided: 1 });
  });
});
