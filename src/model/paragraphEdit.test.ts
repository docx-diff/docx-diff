import { describe, expect, it } from 'vitest';
import type { ChangeItem } from './changes';
import {
  applyFormat,
  applyTextEdit,
  blockItemIds,
  blockItems,
  editId,
  editSpan,
  OBJECT_CHAR,
  originalText,
  revertBlock,
  revertChange,
  revertableItems,
  visibleText,
  type BlockEdit,
  type CharacterLook,
  type Segment,
  type SegmentFormat,
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

  it('widens a space that splits a word, or joins two, to the words', () => {
    expect(show(edit([eq('the redhouse')], 'the red house', 0, 8).segments)).toBe('the [-redhouse:eb.0-][+red house:eb.0/eb.1+]');
    expect(show(edit([eq('the red house')], 'the redhouse').segments)).toBe('the [-red house:eb.0-][+redhouse:eb.0/eb.1+]');
  });

  it('keeps a word typed with its space next to a word unwidened', () => {
    expect(show(edit([eq('the red house')], 'the red big house', 0, 12).segments)).toBe('the red [+big :eb.0+]house');
    expect(show(edit([eq('the red big house')], 'the red house').segments)).toBe('the red [-big :eb.0-]house');
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

  it('joins text typed next to an item an earlier edit created to that item, keeping its ids', () => {
    // A space, then after a pause (an update) the word: one change.
    const space = edit([eq('kellékek bölcs')], 'kellékek  bölcs', 0, 9);
    expect(show(space.segments)).toBe('kellékek[+ :eb.0+] bölcs');
    const word = edit(space.segments, 'kellékek igen bölcs', space.nextId, 13);
    expect(show(word.segments)).toBe('kellékek[+ igen:eb.0+] bölcs');
    expect(word.createdItemIds).toEqual([]);
    expect(word.nextId).toBe(1);
    // A word deleted, then its replacement typed: one Replaced change, under the deletion's id.
    const deleted = edit([eq('a nagy ház')], 'a  ház', 0, 2);
    expect(show(deleted.segments)).toBe('a [-nagy:eb.0-] ház');
    const replaced = edit(deleted.segments, 'a kis ház', deleted.nextId, 5);
    expect(show(replaced.segments)).toBe('a [-nagy:eb.0-][+kis:eb.0/eb.1+] ház');
    expect(replaced.createdItemIds).toEqual([]);
  });

  it('leaves the unchanged word out of a change once a space separates the typed word from it', () => {
    // A word typed against the next one widens to both; the space typed later leaves only the new word.
    const glued = edit([eq('az alamizsnás szilke')], 'az alamizsnás gyűjtőszilke', 0, 20);
    expect(show(glued.segments)).toBe('az alamizsnás [-szilke:eb.0-][+gyűjtőszilke:eb.0/eb.1+]');
    const spaced = edit(glued.segments, 'az alamizsnás gyűjtő szilke', glued.nextId, 21);
    expect(show(spaced.segments)).toBe('az alamizsnás [+gyűjtő :eb.0/eb.1+]szilke');
    expect(spaced.createdItemIds).toEqual([]);
    // The same before the word, and after it.
    const before = edit([eq('alamizsnás')], 'azalamizsnás', 0, 2);
    expect(show(edit(before.segments, 'az alamizsnás', before.nextId, 3).segments)).toBe('[+az :eb.0/eb.1+]alamizsnás');
    const after = edit([eq('a house')], 'a housenow', 0, 10);
    expect(show(edit(after.segments, 'a house now', after.nextId, 8).segments)).toBe('a house[+ now:eb.0/eb.1+]');
  });

  it('keeps the shared words of the comparison’s items', () => {
    const segments = [eq('a '), del('red', 'x'), ins('red blue', 'x', 'y'), eq(' b')];
    expect(show(edit(segments, 'a red bluer b', 0, 10).segments)).toBe('a [-red:x-][+red bluer:x/y+] b');
  });

  it('keeps text typed after a space ending one of the comparison’s insertions a new change', () => {
    expect(show(edit([eq('a '), ins('big ', 'x'), eq('house')], 'a big red house', 0, 10).segments)).toBe('a [+big :x+][+red :eb.0+]house');
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

describe('revertableItems and revertChange', () => {
  /** The block after applying the edits (text, caret) in turn. */
  function edited(original: Segment[], ...steps: [string, number?][]) {
    let current = original;
    let nextId = 0;
    for (const [text, caret] of steps) ({ segments: current, nextId } = edit(current, text, nextId, caret));
    return { unid: UNID, original, current };
  }

  it('reverts a new word change: its deleted text is unchanged again, its inserted text goes', () => {
    const block = edited([eq('the hosue is')], ['the house is']);
    expect([...revertableItems(block)]).toEqual(['eb.0']);
    expect(revertChange(block, 'eb.0')).toBe(block.original);
  });

  it('reverts a typo fixed inside an insertion: the insertion as compared, with its id', () => {
    const block = edited([eq('the '), ins('hosue', 'x'), eq(' is')], ['the house is']);
    expect([...revertableItems(block)]).toEqual(['x']);
    expect(revertChange(block, 'x')).toBe(block.original);
  });

  it('reverts one of two edits in a paragraph and keeps the other', () => {
    const block = edited([eq('the red house is old')], ['the big red house is old', 8], ['the big red house is new', 24]);
    expect(show(block.current)).toBe('the [+big :eb.0+]red house is [-old:eb.1-][+new:eb.1/eb.2+]');
    expect([...revertableItems(block)]).toEqual(['eb.0', 'eb.1']);
    expect(show(revertChange(block, 'eb.0'))).toBe('the red house is [-old:eb.1-][+new:eb.1/eb.2+]');
    expect(show(revertChange(block, 'eb.1'))).toBe('the [+big :eb.0+]red house is old');
  });

  it('reverts only the chosen one of a new change and the existing change it touched', () => {
    const original = [eq('a '), ins('big', 'x'), eq(' red house')];
    const block = edited(original, ['a bigger blue house', 13]);
    expect(show(block.current)).toBe('a [+bigger:x+] [-red:eb.0-][+blue:eb.0/eb.1+] house');
    expect([...revertableItems(block)]).toEqual(['x', 'eb.0']);
    expect(show(revertChange(block, 'x'))).toBe('a [+big:x+] [-red:eb.0-][+blue:eb.0/eb.1+] house');
    expect(show(revertChange(block, 'eb.0'))).toBe('a [+bigger:x+] red house');
  });

  it('leaves out items as compared and items the edits removed completely', () => {
    const original = [eq('the '), ins('big ', 'x'), eq('red '), ins('hosue', 'h')];
    const block = edited(original, ['the red hosue']);
    expect(revertableItems(block).size).toBe(0);
    const typo = edited(original, ['the big red house']);
    expect([...revertableItems(typo)]).toEqual(['h']);
  });

  it('puts back an existing item’s inserted text after its deletion when the edits removed all of it', () => {
    const original = [eq('the '), del('old', 'r'), ins('new', 'r', 'r2'), eq(' house')];
    const block = edited(original, ['the  house']);
    expect(show(block.current)).toBe('the [-old:r-] house');
    expect([...revertableItems(block)]).toEqual(['r']);
    expect(revertChange(block, 'r')).toBe(original);
  });

  it('keeps objects in place, its inserted objects included', () => {
    const original = [eq('a '), ins('note', 'x'), obj('fn:1', { change: 'ins', itemId: 'x' }), ins(' text', 'x'), eq(' b')];
    const block = edited(original, [`a note${OBJECT_CHAR} texts b`]);
    expect(revertChange(block, 'x')).toBe(original);
    const plain = edited([eq('see'), obj('fn:1'), eq(' here')], [`see${OBJECT_CHAR} there`]);
    expect(show(revertChange(plain, 'eb.0'))).toBe('see<fn:1> here');
  });

  it('doesn’t merge a reverted change with neighbours that read as the Original typed back', () => {
    const original = [eq('a '), del('big ', 'x'), ins('big ', 'y'), eq('old house')];
    const current = [eq('a '), del('big ', 'x'), ins('big ', 'y'), del('old', 'eb.0'), ins('new', 'eb.0', 'eb.1'), eq(' house')];
    expect(show(revertChange({ unid: UNID, original, current }, 'eb.0'))).toBe('a [-big :x-][+big :y+]old house');
    const kept = edited([eq('a '), del('big ', 'x'), eq('house')], ['a tall house', 7]);
    expect(show(kept.current)).toBe('a [-big :x-][+tall :eb.0+]house');
    expect(show(revertChange(kept, 'eb.0'))).toBe('a [-big :x-]house');
  });

  it('keeps the Original text, and reverting every revertable item gives the block as compared', () => {
    const original = [eq('the '), ins('big', 'a'), eq(' red '), ins('hosue', 'h'), eq(' is old')];
    const block = edited(original, ['the big blue hosue is old', 12], ['the big blue house is old', 16], ['the big blue house is new', 25]);
    let current = block.current;
    for (const itemId of revertableItems(block)) {
      const next = revertChange({ ...block, current }, itemId);
      expect(originalText(next)).toBe(originalText(original));
      current = next;
    }
    expect(current).toBe(original);
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

describe('applyFormat', () => {
  const plain: CharacterLook = { bold: false, italic: false };
  /** `show` with each format after its text: `{b+i-:item}` (bold set, italic removed). */
  function looks(segments: readonly Segment[]): string {
    const flags = (format: SegmentFormat) =>
      `${format.bold === undefined ? '' : format.bold ? 'b+' : 'b-'}${format.italic === undefined ? '' : format.italic ? 'i+' : 'i-'}${format.itemId ? `:${format.itemId}` : ''}`;
    return segments.map((segment) => {
      const text = show([segment]);
      return segment.kind !== 'object' && segment.format ? `${text}{${flags(segment.format)}}` : text;
    }).join('');
  }
  function format(segments: readonly Segment[], start: number, end: number, property: 'bold' | 'italic', value: boolean, nextId = 0, look: (i: number) => CharacterLook = () => plain) {
    return applyFormat(segments, { start, end }, property, value, Array.from({ length: end - start }, (_, i) => look(start + i)), { unid: UNID, nextId });
  }

  it('gives unchanged text a new formatting change, one per action, and keeps the segments apart', () => {
    const result = format([eq('the red house')], 4, 7, 'bold', true);
    expect(looks(result.segments)).toBe('the red{b+:eb.0} house');
    expect(result).toMatchObject({ nextId: 1, createdItemIds: ['eb.0'] });
    const block = { unid: UNID, original: [eq('the red house')], current: result.segments };
    expect(blockItems(block)).toEqual([
      { id: 'eb.0', kind: 'formatting', revisionIds: ['eb.0'], removedText: '', addedText: '', text: 'red', description: 'Bold added', wordDelta: { removed: 0, added: 0 } },
    ]);
    expect([...blockItemIds(block)]).toEqual(['eb.0']);
  });

  it('removes the setting where the value is the text’s own look, and a change left without text', () => {
    const bold = format([eq('the red house')], 4, 7, 'bold', true).segments;
    const back = format(bold, 4, 7, 'bold', false, 1);
    expect(back.segments).toEqual([eq('the red house')]);
    expect(back.createdItemIds).toEqual([]);
    const removed = format([eq('the red house')], 0, 3, 'bold', false, 0, (i) => ({ bold: i < 3, italic: false }));
    expect(looks(removed.segments)).toBe('the{b-:eb.0} red house');
    expect(blockItems({ unid: UNID, original: [eq('the red house')], current: removed.segments })[0]!.description).toBe('Bold removed');
  });

  it('joins text of a formatting change to that change: the comparison’s, or one an earlier action created', () => {
    const change = { itemId: 'f', revisionId: 'f1' };
    const result = format([eq('the red house')], 4, 13, 'italic', true, 0, (i) => (i < 7 ? { ...plain, change } : plain));
    expect(looks(result.segments)).toBe('the red{i+:f} house{i+:eb.0}');
    const block = { unid: UNID, original: [eq('the red house')], current: result.segments };
    // The comparison's formatting item stays as it was: only the new one is the block's.
    expect(blockItems(block).map((item) => item.id)).toEqual(['eb.0']);
    expect([...blockItemIds(block)]).toEqual(['eb.0']);
    const again = format(result.segments, 8, 13, 'bold', true, result.nextId);
    expect(looks(again.segments)).toBe('the red{i+:f} {i+:eb.0}house{b+i+:eb.0}');
    expect(again.createdItemIds).toEqual([]);
    expect(blockItems({ ...block, current: again.segments })[0]).toMatchObject({ text: ' house', description: 'Bold added, Italic added' });
  });

  it('changes only the look of inserted text, and leaves hidden deletions and objects alone', () => {
    const original = [eq('a '), del('old ', 'x'), ins('new', 'y'), obj('fn:1'), eq(' b')];
    const result = format(original, 0, 8, 'bold', true);
    expect(looks(result.segments)).toBe('a {b+:eb.0}[-old :x-][+new:y+]{b+}<fn:1> b{b+:eb.0}');
    const block = { unid: UNID, original, current: result.segments };
    expect(blockItems(block).map((item) => [item.id, item.kind])).toEqual([['eb.0', 'formatting'], ['x', 'deleted'], ['y', 'inserted']]);
  });

  it('gives typed text the reviewer’s look of the text it replaces or follows', () => {
    const bold = format([eq('the red house')], 4, 7, 'bold', true);
    const typed = edit(bold.segments, 'the reddish house', bold.nextId, 11);
    expect(looks(typed.segments)).toBe('the [-red:eb.1-][+reddish:eb.1/eb.2+]{b+} house');
    const replaced = edit(bold.segments, 'the big house', bold.nextId, 7);
    expect(looks(replaced.segments)).toBe('the [-red:eb.1-][+big:eb.1/eb.2+]{b+} house');
    const inside = format([eq('a '), ins('big', 'x'), eq(' b')], 2, 5, 'italic', true);
    expect(looks(edit(inside.segments, 'a bigger b', 0, 8).segments)).toBe('a [+bigger:x+]{i+} b');
  });

  it('is undone by revertChange, for every kind of change, and by a revert of the block', () => {
    const change = { itemId: 'f', revisionId: 'f1' };
    const original = [eq('the '), ins('big', 'x'), eq(' red house')];
    const looksOf = (i: number) => (i >= 12 ? { ...plain, change } : plain);
    const current = format(original, 0, 17, 'bold', true, 0, looksOf).segments;
    expect(looks(current)).toBe('the {b+:eb.0}[+big:x+]{b+} red {b+:eb.0}house{b+:f}');
    const block = { unid: UNID, original, current };
    expect([...revertableItems(block)]).toEqual(['eb.0', 'x', 'f']);
    expect(looks(revertChange(block, 'eb.0'))).toBe('the [+big:x+]{b+} red house{b+:f}');
    expect(looks(revertChange(block, 'x'))).toBe('the {b+:eb.0}[+big:x+] red {b+:eb.0}house{b+:f}');
    expect(looks(revertChange(block, 'f'))).toBe('the {b+:eb.0}[+big:x+]{b+} red {b+:eb.0}house');
    let reverted = current;
    for (const itemId of revertableItems(block)) reverted = revertChange({ ...block, current: reverted }, itemId);
    expect(reverted).toBe(original);
  });
});
