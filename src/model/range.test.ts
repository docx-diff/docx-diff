import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import type { ChangeItem, ChangeKind } from './changes';
import { buildDocIndex } from './docIndex';
import { blockPositions, classify, detectTrailingRegion } from './range';

// Original body paragraphs of SMALL_HTML: a(0) c(1) d(2) e(3) t(4); b, f and g are not in the Original;
// footnote paragraph n is referenced from a, endnote paragraph m from t.
const index = buildDocIndex(SMALL_HTML);

function item(id: string, kind: ChangeKind, anchors: string[], scope: ChangeItem['location']['scope'] = 'body'): ChangeItem {
  return {
    id,
    kind,
    revisionIds: [id],
    removedText: '',
    addedText: '',
    location: { scope },
    wordDelta: { removed: 0, added: 0 },
    order: 0,
    anchors,
  };
}

describe('blockPositions', () => {
  it('places Original paragraphs at their index, others after the preceding one, notes at their reference', () => {
    expect(Object.fromEntries(blockPositions(index))).toEqual({ a: 0, b: 0.5, c: 1, d: 2, e: 3, f: 3.5, g: 3.5, t: 4, n: 0, m: 4 });
  });
});

describe('detectTrailingRegion', () => {
  it('returns the first paragraph of the body deletion that covers the last Original paragraph', () => {
    const items = [item('1', 'replaced', ['a']), item('2', 'deleted', ['d', 'e', 't']), item('3', 'paragraph', ['t'])];
    expect(detectTrailingRegion(items, index)).toBe(2);
  });

  it('accepts a table paragraph as the last paragraph and later items after the deletion', () => {
    const items = [item('1', 'deleted', ['e', 't'], 'table'), item('2', 'inserted', ['t']), item('3', 'formatting', ['t'])];
    expect(detectTrailingRegion(items, index)).toBe(3);
  });

  it('is null when no deletion covers the last paragraph, for insertions, and for a deletion of everything', () => {
    expect(detectTrailingRegion([item('1', 'deleted', ['d', 'e'])], index)).toBeNull();
    expect(detectTrailingRegion([item('1', 'inserted', ['t'])], index)).toBeNull();
    expect(detectTrailingRegion([item('1', 'deleted', ['n'], 'footnote')], index)).toBeNull();
    expect(detectTrailingRegion([item('1', 'deleted', ['a', 'c', 'd', 'e', 't'])], index)).toBeNull();
  });
});

describe('classify', () => {
  const items = [
    item('a', 'replaced', ['a']),
    item('b', 'inserted', ['b']),
    item('g', 'moved', ['c', 'g']),
    item('span', 'deleted', ['d', 'e']),
    item('note', 'deleted', ['n'], 'footnote'),
    item('endnote', 'deleted', ['m'], 'endnote'),
    item('section', 'formatting', ['unknown-section']),
  ];

  it('puts everything in range without an end point', () => {
    expect([...classify(items, index, null).values()]).toEqual(Array(items.length).fill('inRange'));
  });

  it('puts items at or after the end point out of range, including spanning items and notes referenced there', () => {
    expect(Object.fromEntries(classify(items, index, 3))).toEqual({
      a: 'inRange',
      b: 'inRange',
      g: 'outOfRange',
      span: 'outOfRange',
      note: 'inRange',
      endnote: 'outOfRange',
      section: 'inRange',
    });
  });

  it('puts an insertion right after the last in-range paragraph in range', () => {
    expect(classify([item('b', 'inserted', ['b'])], index, 1).get('b')).toBe('inRange');
    expect(classify([item('b', 'inserted', ['b'])], index, 0).get('b')).toBe('outOfRange');
  });
});
