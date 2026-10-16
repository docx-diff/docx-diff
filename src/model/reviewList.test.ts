import { describe, expect, it } from 'vitest';
import type { ChangeItem, ChangeKind } from './changes';
import { buildReviewList, navigationOrder, nextUndecided, step, type ListEntry } from './reviewList';

function item(id: string, kind: ChangeKind, order: number): ChangeItem {
  return {
    id,
    kind,
    revisionIds: [id],
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order,
    anchors: [],
  };
}

const text = [item('a', 'inserted', 0), item('b', 'deleted', 2), item('c', 'replaced', 5)];
const formatting = [item('f', 'formatting', 1), item('g', 'formatting', 3)];

const describeEntry = (entry: ListEntry) => (entry.type === 'item' ? `${entry.label}:${entry.item.id}` : `group(${entry.count})`);

describe('buildReviewList', () => {
  it('puts the collapsed formatting group at the position of its first item', () => {
    expect(buildReviewList(text, formatting, false).map(describeEntry)).toEqual(['1:a', 'group(2)', '2:b', '3:c']);
  });

  it('lists the formatting items after the header when expanded', () => {
    expect(buildReviewList(text, formatting, true).map(describeEntry)).toEqual(['1:a', 'group(2)', 'F1:f', 'F2:g', '2:b', '3:c']);
  });

  it('puts the group last when every text item comes first, and leaves it out when empty', () => {
    expect(buildReviewList(text.slice(0, 1), formatting, false).map(describeEntry)).toEqual(['1:a', 'group(2)']);
    expect(buildReviewList(text, [], true).map(describeEntry)).toEqual(['1:a', '2:b', '3:c']);
  });
});

describe('navigation', () => {
  const collapsed = navigationOrder(buildReviewList(text, formatting, false));
  const expanded = navigationOrder(buildReviewList(text, formatting, true));

  it('skips formatting items unless the group is expanded', () => {
    expect(collapsed.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(expanded.map((x) => x.id)).toEqual(['a', 'f', 'g', 'b', 'c']);
  });

  it('steps forwards and backwards, starting at the ends and stopping there', () => {
    expect(step(collapsed, null, 1)).toBe('a');
    expect(step(collapsed, null, -1)).toBe('c');
    expect(step(collapsed, 'a', 1)).toBe('b');
    expect(step(collapsed, 'c', 1)).toBe('c');
    expect(step(collapsed, 'a', -1)).toBe('a');
    // A current item no longer in the order (e.g. the group was collapsed) restarts at an end.
    expect(step(collapsed, 'f', 1)).toBe('a');
    expect(step([], null, 1)).toBeNull();
  });

  it('finds the next undecided text item, wrapping around and skipping formatting', () => {
    expect(nextUndecided(expanded, 'a', {})).toBe('b');
    expect(nextUndecided(expanded, 'b', { a: 'accepted', b: 'accepted' })).toBe('c');
    expect(nextUndecided(expanded, 'c', { c: 'rejected' })).toBe('a');
    expect(nextUndecided(expanded, null, { a: 'accepted' })).toBe('b');
    expect(nextUndecided(expanded, 'a', { a: 'accepted', b: 'accepted', c: 'accepted' })).toBeNull();
  });
});
