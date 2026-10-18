import { describe, expect, it } from 'vitest';
import type { ChangeItem } from './changes';
import {
  applyTextEdit,
  blockItems,
  editId,
  editSpan,
  OBJECT_CHAR,
  originalText,
  revertBlock,
  visibleText,
  type BlockEdit,
  type Segment,
} from './paragraphEdit';

const UNID = 'b';
const eq = (text: string): Segment => ({ kind: 'equal', text });
const ins = (text: string, itemId: string, revisionId = itemId): Segment => ({ kind: 'ins', text, itemId, revisionId });
const del = (text: string, itemId: string, revisionId = itemId): Segment => ({ kind: 'del', text, itemId, revisionId });
const obj = (key: string, owner?: { change: 'del' | 'ins'; itemId: string }): Segment => ({
  kind: 'object',
  key,
  ...(owner ? { owner: { ...owner, revisionId: owner.itemId } } : {}),
});

/** `[-text:item-]` / `[+text:item+]` (`item/revision` when they differ), `<key>` for objects. */
function show(segments: readonly Segment[]): string {
  return segments.map((segment) => {
    if (segment.kind === 'equal') return segment.text;
    if (segment.kind === 'object') return `<${segment.key}>`;
    const owner = segment.itemId === segment.revisionId ? segment.itemId : `${segment.itemId}/${segment.revisionId}`;
    return segment.kind === 'del' ? `[-${segment.text}:${owner}-]` : `[+${segment.text}:${owner}+]`;
  }).join('');
}

function edit(segments: Segment[], after: string, nextId = 0, caret?: number) {
  return applyTextEdit(segments, after, { unid: UNID, nextId, caret });
}

describe('visibleText / originalText', () => {
  it('leaves out insertions or deletions, and shows objects as one character', () => {
    const segments = [eq('a '), del('b ', 'x'), ins('c ', 'y'), obj('fn:1'), obj('fn:2', { change: 'del', itemId: 'x' }), eq('.')];
    expect(visibleText(segments)).toBe(`a c ${OBJECT_CHAR}.`);
    expect(originalText(segments)).toBe(`a b ${OBJECT_CHAR}${OBJECT_CHAR}.`);
  });
});

describe('editSpan', () => {
  it('finds an insertion, a deletion and a replacement', () => {
    expect(editSpan('the red house', 'the big red house')).toEqual({ start: 4, end: 4, text: 'big ' });
    expect(editSpan('the red house', 'the house')).toEqual({ start: 4, end: 8, text: '' });
    expect(editSpan('the red house', 'the blue house')).toEqual({ start: 4, end: 7, text: 'blue' });
    expect(editSpan('same', 'same')).toEqual({ start: 4, end: 4, text: '' });
  });

  it('places an ambiguous edit at the caret', () => {
    expect(editSpan('aa', 'a', 0)).toEqual({ start: 0, end: 1, text: '' });
    expect(editSpan('aa', 'a', 1)).toEqual({ start: 1, end: 2, text: '' });
    expect(editSpan('banana', 'banaana', 4)).toEqual({ start: 3, end: 3, text: 'a' });
    expect(editSpan('banana', 'banaana')).toEqual({ start: 4, end: 4, text: 'a' });
  });

  it('treats a no-break space as a space, and never splits a surrogate pair', () => {
    expect(editSpan('a b', 'a\u00a0b')).toEqual({ start: 3, end: 3, text: '' });
    expect(editSpan('x😀', 'x😃')).toEqual({ start: 1, end: 3, text: '😃' });
  });
});

describe('applyTextEdit', () => {
  it('makes typed text in unchanged text a new insertion', () => {
    const result = edit([eq('the red house')], 'the big red house');
    expect(show(result.segments)).toBe('the [+big :eb.0+]red house');
    expect(result.createdItemIds).toEqual(['eb.0']);
    expect(result.nextId).toBe(1);
  });

  it('inserts at the start and at the end of the paragraph', () => {
    expect(show(edit([eq('house')], 'A house').segments)).toBe('[+A :eb.0+]house');
    expect(show(edit([eq('house')], 'house now').segments)).toBe('house[+ now:eb.0+]');
  });

  it('makes deleted unchanged text a new deletion', () => {
    const result = edit([eq('the red house')], 'the house');
    expect(show(result.segments)).toBe('the [-red :eb.0-]house');
    expect(result.createdItemIds).toEqual(['eb.0']);
  });

  it('widens a typo fixed inside an unchanged word to the whole word (a Replaced item)', () => {
    const result = edit([eq('the hosue is')], 'the house is');
    expect(show(result.segments)).toBe('the [-hosue:eb.0-][+house:eb.0/eb.1+] is');
    expect(result.createdItemIds).toEqual(['eb.0']);
    expect(result.nextId).toBe(2);
    expect(show(edit([eq('the cat')], 'the cats').segments)).toBe('the [-cat:eb.0-][+cats:eb.0/eb.1+]');
  });

  it('replaces whole words', () => {
    expect(show(edit([eq('the red house')], 'the blue house').segments)).toBe('the [-red:eb.0-][+blue:eb.0/eb.1+] house');
  });

  it('keeps a space typed between two words a lone insertion', () => {
    expect(show(edit([eq('the redhouse')], 'the red house').segments)).toBe('the red[+ :eb.0+]house');
  });

  it('keeps a typo fixed inside an insertion in that insertion', () => {
    const result = edit([eq('the '), ins('hosue', 'x'), eq(' is')], 'the house is');
    expect(show(result.segments)).toBe('the [+house:x+] is');
    expect(result.createdItemIds).toEqual([]);
    expect(result.nextId).toBe(0);
  });

  it('joins text continuing a word of an insertion to it, and the rest is new', () => {
    expect(show(edit([eq('a '), ins('hous', 'x'), eq(' b')], 'a house b').segments)).toBe('a [+house:x+] b');
    expect(show(edit([eq('a '), ins('hous', 'x'), eq(' b')], 'a house and b').segments)).toBe('a [+house:x+][+ and:eb.0+] b');
    expect(show(edit([eq('a '), ins('ouse', 'x'), eq(' b')], 'a house b', 0, 3).segments)).toBe('a [+house:x+] b');
  });

  it('never changes the other items of the paragraph (the [big] red [house] example)', () => {
    const segments = [eq('the '), ins('big', 'a'), eq(' red '), ins('house', 'h')];
    const result = edit(segments, 'the big blue house');
    expect(show(result.segments)).toBe('the [+big:a+] [-red:eb.0-][+blue:eb.0/eb.1+] [+house:h+]');
    expect(result.createdItemIds).toEqual(['eb.0']);
  });

  it('never joins a new insertion to a deletion it touches', () => {
    const result = edit([eq('the '), del('big ', 'x'), eq('house')], 'the large house');
    expect(show(result.segments)).toBe('the [-big :x-][+large :eb.0+]house');
    expect(result.createdItemIds).toEqual(['eb.0']);
  });

  it('removes an item whose Original text is typed back', () => {
    const replaced = [eq('the '), del('red', 'x', 'x1'), ins('blue', 'x', 'x2'), eq(' house')];
    const result = edit(replaced, 'the red house');
    expect(show(result.segments)).toBe('the red house');
    expect(result.createdItemIds).toEqual([]);

    const deleted = [eq('the '), del('big ', 'x'), eq('house')];
    expect(show(edit(deleted, 'the big house').segments)).toBe('the big house');

    const partly = [eq('a '), del('hello', 'x', 'x1'), ins('help', 'x', 'x2'), eq(' b')];
    expect(show(edit(partly, 'a hello b').segments)).toBe('a hello b');
  });

  it('removes a new item when the Original is typed back, without reusing its ids', () => {
    const first = edit([eq('the hosue is')], 'the house is');
    const second = edit(first.segments, 'the hosue is', first.nextId);
    expect(show(second.segments)).toBe('the hosue is');
    expect(second.nextId).toBe(2);
    const third = edit(second.segments, 'the house is', second.nextId);
    expect(show(third.segments)).toBe('the [-hosue:eb.2-][+house:eb.2/eb.3+] is');
  });

  it('removes an item whose insertion is deleted completely', () => {
    expect(show(edit([eq('the '), ins('big ', 'x'), eq('house')], 'the house').segments)).toBe('the house');
  });

  it('shrinks an insertion and deletes unchanged text in one edit', () => {
    const result = edit([eq('a '), ins('big ', 'x'), eq('red house')], 'a house', undefined, 2);
    expect(show(result.segments)).toBe('a [-red :eb.0-]house');
  });

  it('keeps objects in place, and refuses to delete one', () => {
    const segments = [eq('see'), obj('fn:1'), eq(' here')];
    expect(show(edit(segments, `see${OBJECT_CHAR} there`).segments)).toBe('see<fn:1> [-here:eb.0-][+there:eb.0/eb.1+]');
    expect(show(edit(segments, `seen${OBJECT_CHAR} here`).segments)).toBe('[-see:eb.0-][+seen:eb.0/eb.1+]<fn:1> here');
    expect(() => edit(segments, 'see here')).toThrow(/object/);
    expect(() => edit(segments, `see${OBJECT_CHAR}${OBJECT_CHAR} here`)).toThrow(/object/);
  });

  it('keeps typed text inside an insertion that holds an object in that insertion', () => {
    const segments = [eq('a '), ins('note', 'x'), obj('fn:1', { change: 'ins', itemId: 'x' }), ins(' text', 'x'), eq(' b')];
    expect(show(edit(segments, `a note${OBJECT_CHAR} texts b`).segments)).toBe('a [+note:x+]<fn:1>[+ texts:x+] b');
  });

  it('types no-break spaces as spaces and normalizes typed text to NFC', () => {
    expect(show(edit([eq('a b')], 'a new\u00a0b').segments)).toBe('a [+new :eb.0+]b');
    expect(show(edit([eq('a b')], 'a\u00a0b').segments)).toBe('a b');
    expect(show(edit([eq('a b')], 'a b\u00a0').segments)).toBe('a b[+ :eb.0+]');
    expect(show(edit([eq('a b')], 'a e\u0301 b').segments)).toBe('a [+\u00e9 :eb.0+]b');
  });

  it('leaves the segments as they were when nothing changed', () => {
    const segments = [eq('a '), ins('b', 'x')];
    expect(edit(segments, 'a b')).toEqual({ segments, nextId: 0, createdItemIds: [] });
  });
});

describe('revertBlock and replay', () => {
  const original = [eq('the '), ins('big', 'a'), eq(' red '), ins('hosue', 'h'), eq(' is old')];
  const steps: [string, number][] = [
    ['the big blue hosue is old', 12],
    ['the big blue house is old', 16],
    ['the big blue house is new', 25],
    ['the big blue house was new', 22],
  ];
  function replay(): BlockEdit {
    let state: BlockEdit = { unid: UNID, scope: 'body', original, current: original, nextId: 0 };
    for (const [text, caret] of steps) {
      const result = applyTextEdit(state.current, text, { unid: UNID, nextId: state.nextId, caret });
      state = { ...state, current: result.segments, nextId: result.nextId };
    }
    return state;
  }

  it('gives identical segments and ids when the same edits are applied again', () => {
    const first = replay();
    expect(show(first.current)).toBe(
      'the [+big:a+] [-red:eb.0-][+blue:eb.0/eb.1+] [+house:h+] [-is:eb.4-][+was:eb.4/eb.5+] [-old:eb.2-][+new:eb.2/eb.3+]',
    );
    expect(replay()).toEqual(first);
  });

  it('restores the block as the comparison produced it', () => {
    expect(revertBlock(replay())).toBe(original);
  });
});

describe('blockItems', () => {
  function item(id: string, revisionIds: string[], kind: ChangeItem['kind'] = 'inserted'): ChangeItem {
    return {
      id, kind, revisionIds, removedText: '', addedText: '', location: { scope: 'body' },
      wordDelta: { removed: 0, added: 0 }, order: 0, anchors: [UNID],
    };
  }

  it('gives the items of the [big] red [house] example in order', () => {
    const original = [eq('the '), ins('big', 'a'), eq(' red '), ins('house', 'h')];
    const current = edit(original, 'the big blue house').segments;
    expect(blockItems({ unid: UNID, original, current })).toEqual([
      { id: 'a', kind: 'inserted', revisionIds: ['a'], removedText: '', addedText: 'big', wordDelta: { removed: 0, added: 1 } },
      { id: 'eb.0', kind: 'replaced', revisionIds: ['eb.0', 'eb.1'], removedText: 'red', addedText: 'blue', wordDelta: { removed: 1, added: 1 } },
      { id: 'h', kind: 'inserted', revisionIds: ['h'], removedText: '', addedText: 'house', wordDelta: { removed: 0, added: 1 } },
    ]);
  });

  it('keeps an existing item\'s id and revision order, and recomputes its kind', () => {
    const original = [eq('a '), ins('hosue', 'x', 'x2'), del('home', 'x', 'x1'), eq(' b')];
    const items = new Map([['x', item('x', ['x1', 'x2'], 'replaced')]]);
    const fixed = edit(original, 'a house b').segments;
    expect(blockItems({ unid: UNID, original, current: fixed }, { items, revisions: new Map() })).toEqual([
      { id: 'x', kind: 'replaced', revisionIds: ['x1', 'x2'], removedText: 'home', addedText: 'house', wordDelta: { removed: 1, added: 1 } },
    ]);
    const gone = edit(original, 'a  b').segments;
    expect(blockItems({ unid: UNID, original, current: gone }, { items, revisions: new Map() })).toEqual([
      { id: 'x', kind: 'deleted', revisionIds: ['x1'], removedText: 'home', addedText: '', wordDelta: { removed: 1, added: 0 } },
    ]);
  });

  it('keeps revisions outside the block, and the engine\'s text of revisions the edits left alone', () => {
    const original = [eq('a '), ins('word', 'n', 'n1'), obj('fn:1', { change: 'ins', itemId: 'n' }), eq(' b '), ins('big', 'y')];
    const items = new Map([['n', item('n', ['n1', 'n2'])], ['y', item('y', ['y'])]]);
    const revisions = new Map([
      ['n1', { type: 'insert' as const, text: 'word1' }],
      ['n2', { type: 'insert' as const, text: 'The note.¶' }],
      ['y', { type: 'insert' as const, text: 'big (engine)' }],
    ]);
    const current = edit(original, `a words${OBJECT_CHAR} b big`, 0, 7).segments;
    expect(show(current)).toBe('a [+words:n/n1+]<fn:1> b [+big:y+]');
    const result = blockItems({ unid: UNID, original, current }, { items, revisions });
    expect(result.map((i) => [i.id, i.revisionIds.join(' '), i.addedText])).toEqual([
      ['n', 'n1 n2', 'wordsThe note.¶'],
      ['y', 'y', 'big (engine)'],
    ]);
  });

  it('drops revisions of earlier edits that are gone', () => {
    const original = [eq('the hosue is')];
    const first = edit(original, 'the house is');
    const items = new Map([['eb.0', item('eb.0', ['eb.0', 'eb.1'], 'replaced')]]);
    const shorter = edit(first.segments, 'the  is', first.nextId).segments;
    expect(show(shorter)).toBe('the [-hosue:eb.0-] is');
    expect(blockItems({ unid: UNID, original, current: shorter }, { items, revisions: new Map() })).toEqual([
      { id: 'eb.0', kind: 'deleted', revisionIds: ['eb.0'], removedText: 'hosue', addedText: '', wordDelta: { removed: 1, added: 0 } },
    ]);
    expect(editId(UNID, 1)).toBe('eb.1');
  });
});
