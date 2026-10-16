import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import type { RevisionListEntry } from '../engine/types';
import { buildChangeItems, type ChangeItem, type ChangeKind } from './changes';
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

// An Edited document that ends within paragraph p1: it keeps "Kept", adds a note there, and lacks
// the rest of p1 and all of p2 and p3 (deletion d1). Original body paragraphs: p0 p1 p2 p3.
const TAIL_HTML = `<html><body>
<p data-anchor="p0" data-source-anchor-id="p:body:p0">Intro <del class="rev-del" data-author="rev:d0">word</del></p>
<p data-anchor="p1" data-source-anchor-id="p:body:p1">Kept <ins class="rev-ins" data-author="rev:i1">(reviewed up to here)</ins><del class="rev-del" data-author="rev:d1">rest of the paragraph</del></p>
<p data-anchor="p2" data-source-anchor-id="p:body:p2"><del class="rev-del" data-author="rev:d1">Tail one</del></p>
<table><tr><td><p data-anchor="p3" data-source-anchor-id="p:body:p3"><del class="rev-del" data-author="rev:d1">Tail two</del></p></td></tr></table>
</body></html>`;
const tailIndex = buildDocIndex(TAIL_HTML);

function revision(id: string, family: 'content_insert' | 'content_delete', anchors: string[]): RevisionListEntry {
  return {
    id,
    type: family === 'content_insert' ? 'insert' : 'delete',
    family,
    constituentKeys: [],
    text: id,
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: anchors.map((unid) => ({ id: `p:body:${unid}`, kind: 'p', scope: 'body', unid })),
    resolutionStatus: 'supported',
  };
}

describe('detectTrailingRegion', () => {
  it('returns the first wholly deleted paragraph of the deletion that covers the wholly deleted last paragraph', () => {
    const items = [item('d0', 'deleted', ['p0']), item('i1', 'inserted', ['p1']), item('d1', 'deleted', ['p1', 'p2', 'p3']), item('x', 'paragraph', ['p3'])];
    expect(detectTrailingRegion(items, tailIndex)).toBe(2);
  });

  it('keeps the tail deletion out of a Replaced pair with an insertion that touches it', () => {
    const items = buildChangeItems([revision('i1', 'content_insert', ['p1']), revision('d1', 'content_delete', ['p1', 'p2', 'p3'])], tailIndex);
    expect(items.map((i) => i.kind)).toEqual(['inserted', 'deleted']);
    expect(detectTrailingRegion(items, tailIndex)).toBe(2);
    // The deletion spans the end point, so all of it is outside; the note in p1 stays inside.
    expect(Object.fromEntries(classify(items, tailIndex, 2))).toEqual({ i1: 'inRange', d1: 'outOfRange' });
  });

  it('is null when the last paragraph keeps any text, e.g. a word deleted from it', () => {
    // SMALL_HTML's last Original paragraph (t, in a table) is in the Edited document.
    expect(detectTrailingRegion([item('1', 'deleted', ['d', 'e', 't'], 'table')], index)).toBeNull();
  });

  it('is null without a covering deletion, for insertions, notes, and a deletion of everything', () => {
    expect(detectTrailingRegion([item('1', 'deleted', ['p2'])], tailIndex)).toBeNull();
    expect(detectTrailingRegion([item('1', 'inserted', ['p3'])], tailIndex)).toBeNull();
    expect(detectTrailingRegion([item('1', 'deleted', ['p3'], 'footnote')], tailIndex)).toBeNull();
    const everything = buildDocIndex('<p data-anchor="q" data-source-anchor-id="p:body:q"><del class="rev-del" data-author="rev:d">All</del></p>');
    expect(detectTrailingRegion([item('1', 'deleted', ['q'])], everything)).toBeNull();
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
