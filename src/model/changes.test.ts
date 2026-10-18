import { describe, expect, it } from 'vitest';
import type { RevisionListEntry } from '../engine/types';
import { buildChangeItems, countWords, isBareParagraphMark, replaceBlockItems, type ChangeItem } from './changes';
import { adjacencyKey, buildDocIndex, type DocIndex, type IndexBlock } from './docIndex';

const FAMILY = {
  ins: ['insert', 'content_insert'],
  del: ['delete', 'content_delete'],
  pmIns: ['insert', 'paragraph_mark'],
  pmDel: ['delete', 'paragraph_mark'],
  fmt: ['format', 'properties_change'],
  move: ['move', 'move'],
} as const;

function rev(id: string, kind: keyof typeof FAMILY, text: string, anchors: string[], scope = 'body'): RevisionListEntry {
  const [type, family] = FAMILY[kind];
  return {
    id,
    type,
    family,
    constituentKeys: [],
    text,
    partUri: scope === 'fn' ? '/word/footnotes.xml' : '/word/document.xml',
    scope,
    affectedAnchors: anchors.map((unid) => ({ id: `p:${scope}:${unid}`, kind: 'p', scope, unid })),
    resolutionStatus: 'supported',
  };
}

const kinds = (items: ReturnType<typeof buildChangeItems>) => items.map((i) => [i.kind, ...i.revisionIds].join(' '));

describe('countWords', () => {
  it('counts words, ignoring paragraph marks and punctuation-only tokens', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('¶')).toBe(0);
    expect(countWords('two words¶third – word.')).toBe(4);
  });
});

describe('isBareParagraphMark', () => {
  it('is true only for paragraph-mark revisions whose text is only ¶', () => {
    expect(isBareParagraphMark(rev('a', 'pmDel', '¶¶', ['p1']))).toBe(true);
    expect(isBareParagraphMark(rev('a', 'pmDel', 'text¶', ['p1']))).toBe(false);
    expect(isBareParagraphMark(rev('a', 'del', '¶', ['p1']))).toBe(false);
  });
});

describe('buildChangeItems', () => {
  it('makes single insertions, deletions and moves into one item each', () => {
    const items = buildChangeItems([
      rev('1', 'ins', 'new words', ['p1']),
      rev('2', 'del', 'gone', ['p2']),
      rev('3', 'move', 'moved text', ['p3', 'p9']),
    ]);
    expect(kinds(items)).toEqual(['inserted 1', 'deleted 2', 'moved 3']);
    expect(items[0]).toMatchObject({ id: '1', addedText: 'new words', removedText: '', wordDelta: { removed: 0, added: 2 } });
    expect(items[2]).toMatchObject({ text: 'moved text', anchors: ['p3', 'p9'], wordDelta: { removed: 0, added: 0 } });
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('pairs a deletion and an insertion that are neighbours and share an anchor, in either order', () => {
    const items = buildChangeItems([
      rev('1', 'del', 'old', ['p1']),
      rev('2', 'ins', 'new', ['p1']),
      rev('3', 'ins', 'neu', ['p2']),
      rev('4', 'del', 'alt', ['p2']),
    ]);
    expect(kinds(items)).toEqual(['replaced 1 2', 'replaced 3 4']);
    expect(items[1]).toMatchObject({ id: '3', removedText: 'alt', addedText: 'neu', wordDelta: { removed: 1, added: 1 } });
  });

  it('does not pair neighbours in different paragraphs, or two of the same kind', () => {
    const items = buildChangeItems([
      rev('1', 'del', 'a', ['p1']),
      rev('2', 'ins', 'b', ['p2']),
      rev('3', 'del', 'c', ['p3']),
      rev('4', 'del', 'd', ['p3']),
    ]);
    expect(kinds(items)).toEqual(['deleted 1', 'inserted 2', 'deleted 3', 'deleted 4']);
  });

  it('pairs greedily left to right; a revision joins at most one pair', () => {
    const items = buildChangeItems([
      rev('1', 'del', 'a', ['p1']),
      rev('2', 'ins', 'b', ['p1']),
      rev('3', 'del', 'c', ['p1']),
    ]);
    expect(kinds(items)).toEqual(['replaced 1 2', 'deleted 3']);
  });

  it('skips interleaved formatting revisions when pairing and keeps them as their own items', () => {
    const items = buildChangeItems([
      rev('1', 'ins', 'new', ['p1']),
      rev('2', 'fmt', 'formatted', ['p1']),
      rev('3', 'del', 'old', ['p1']),
      rev('4', 'fmt', 'more', ['p2']),
    ]);
    expect(kinds(items)).toEqual(['replaced 1 3', 'formatting 2', 'formatting 4']);
    expect(items[1]).toMatchObject({ text: 'formatted', removedText: '', addedText: '', order: 1 });
  });

  it('folds a bare paragraph mark into the previous revision sharing an anchor', () => {
    const items = buildChangeItems([rev('1', 'del', 'end of paragraph', ['p1']), rev('2', 'pmDel', '¶', ['p1', 'p2'])]);
    expect(kinds(items)).toEqual(['deleted 1 2']);
    expect(items[0]).toMatchObject({ removedText: 'end of paragraph¶', anchors: ['p1', 'p2'] });
  });

  it('folds into the next revision when the previous one does not share an anchor, across formatting', () => {
    const items = buildChangeItems([
      rev('1', 'del', 'elsewhere', ['p0']),
      rev('2', 'pmDel', '¶', ['p1']),
      rev('3', 'fmt', 'x', ['p1']),
      rev('4', 'ins', 'joined', ['p1']),
    ]);
    expect(kinds(items)).toEqual(['deleted 1', 'inserted 2 4', 'formatting 3']);
    expect(items[1]).toMatchObject({ id: '2', removedText: '¶', addedText: 'joined' });
  });

  it('folds paragraph marks before pairing, so the pair is not split by the mark', () => {
    const items = buildChangeItems([
      rev('1', 'del', 'old', ['p1']),
      rev('2', 'pmDel', '¶', ['p1']),
      rev('3', 'ins', 'new', ['p1']),
    ]);
    expect(kinds(items)).toEqual(['replaced 1 2 3']);
    expect(items[0]).toMatchObject({ removedText: 'old¶', addedText: 'new' });
  });

  it('makes a lone bare paragraph mark a paragraph item, and never folds one mark into another', () => {
    const items = buildChangeItems([rev('1', 'pmIns', '¶', ['p1']), rev('2', 'pmDel', '¶', ['p1'])]);
    expect(kinds(items)).toEqual(['paragraph 1', 'paragraph 2']);
    expect(items[0]).toMatchObject({ addedText: '¶', wordDelta: { removed: 0, added: 0 } });
  });

  it('treats a paragraph mark carrying text as an ordinary deletion', () => {
    const items = buildChangeItems([rev('1', 'pmDel', 'a whole tail¶of paragraphs¶', ['p1', 'p2'])]);
    expect(kinds(items)).toEqual(['deleted 1']);
    expect(items[0]!.wordDelta).toEqual({ removed: 5, added: 0 });
  });

  it('does not pair a content revision with a paragraph mark carrying text', () => {
    const items = buildChangeItems([rev('1', 'ins', 'x', ['p1']), rev('2', 'pmDel', 'tail¶', ['p1'])]);
    expect(kinds(items)).toEqual(['inserted 1', 'deleted 2']);
  });

  it('locates items without an index from the revision scope', () => {
    const items = buildChangeItems([rev('1', 'ins', 'a', ['p1']), rev('2', 'del', 'b', ['f1'], 'fn')]);
    expect(items.map((i) => i.location)).toEqual([{ scope: 'body' }, { scope: 'footnote', noteId: undefined }]);
  });

  it('with the index, pairs only a deletion and an insertion whose text touches', () => {
    // "[del 2. ]Tilos […] [ins „szentelt”][del „szentelt"] vizet […] [ins orvos][del orvosnak] vagy"
    const html = `<p data-anchor="p" data-source-anchor-id="p:body:p"><del data-author="rev:a">2. </del>Tilos <ins data-author="rev:b">„szentelt”</ins><del data-author="rev:c">„szentelt"</del> vizet <ins data-author="rev:d">orvos</ins> <del data-author="rev:e">orvosnak</del> vagy</p>`;
    const index = buildDocIndex(html);
    expect(index.adjacentRevisions).toEqual(new Set([adjacencyKey('b', 'c'), adjacencyKey('d', 'e')]));
    const revisions = [rev('a', 'del', '2. ', ['p']), rev('b', 'ins', '„szentelt”', ['p']), rev('c', 'del', '„szentelt"', ['p']), rev('d', 'ins', 'orvos', ['p']), rev('e', 'del', 'orvosnak', ['p'])];
    expect(kinds(buildChangeItems(revisions, index))).toEqual(['deleted a', 'replaced b c', 'replaced d e']);
    // Without the index, sharing the paragraph is enough, which pairs the wrong neighbours.
    expect(kinds(buildChangeItems(revisions))).toEqual(['replaced a b', 'replaced c d', 'deleted e']);
  });

  it('with the index, puts a note only one version has in the item of the revision that deletes or inserts its reference', () => {
    const ref = (id: string) => `<a href="#fn-${id}" class="footnote-ref" data-footnote-id="${id}"><sup>${id}</sup></a>`;
    const note = (id: string, content: string) => `<li id="fn-${id}"><p data-anchor="f${id}" data-source-anchor-id="p:fn:f${id}">${content}</p></li>`;
    const html =
      `<p data-anchor="p1" data-source-anchor-id="p:body:p1">Kept${ref('1')}<del data-author="rev:a">Gone</del><del data-author="rev:a">${ref('2')}</del></p>` +
      `<p data-anchor="p2" data-source-anchor-id="p:body:p2">Kept<ins data-author="rev:b">New</ins><ins data-author="rev:b">${ref('3')}</ins> more<del data-author="rev:c">${ref('4')}</del></p>` +
      `<p data-anchor="p3" data-source-anchor-id="p:body:p3">Kept${ref('5')}</p>` +
      '<section class="footnotes"><ol>' +
      note('1', 'Note <ins data-author="rev:d">edited</ins>') +
      note('2', '<del data-author="rev:e">Removed note</del>') +
      note('3', '<ins data-author="rev:f">Added note</ins>') +
      note('4', '<del data-author="rev:g">Deleted reference, note text kept</del> rest') +
      note('5', '<del data-author="rev:h">Text gone, reference kept</del>') +
      '</ol></section>';
    const index = buildDocIndex(html);
    expect(index.noteReferences.get('fn:2')).toEqual([{ block: 'p1', change: 'del', revisionId: 'a' }]);
    expect(index.noteReferences.get('fn:5')).toEqual([{ block: 'p3', change: null, revisionId: null }]);
    const revisions = [
      rev('a', 'del', 'Gone', ['p1']),
      rev('b', 'ins', 'New', ['p2']),
      rev('c', 'del', '', ['p2']),
      rev('d', 'ins', 'edited', ['f1'], 'fn'),
      rev('e', 'del', 'Removed note', ['f2'], 'fn'),
      rev('f', 'ins', 'Added note', ['f3'], 'fn'),
      rev('g', 'del', 'Deleted reference, note text kept', ['f4'], 'fn'),
      rev('h', 'del', 'Text gone, reference kept', ['f5'], 'fn'),
    ];
    const items = buildChangeItems(revisions, index);
    expect(kinds(items)).toEqual(['deleted a e', 'inserted b f', 'deleted c', 'inserted d', 'deleted g', 'deleted h']);
    expect(items[0]!.location).toEqual({ scope: 'body' });
    expect(items[0]!.anchors).toEqual(['p1', 'f2']);
  });

  it('uses the index for note ids, tables and formatting descriptions', () => {
    const blocks: IndexBlock[] = [
      { unid: 'p1', scope: 'body', inOriginal: true, inEdited: true, inTable: true },
      { unid: 'f1', scope: 'fn', inOriginal: true, inEdited: true, inTable: false, noteId: '7' },
    ];
    const index: DocIndex = {
      blocks,
      blockByUnid: new Map(blocks.map((b) => [b.unid, b])),
      bodyParagraphs: ['p1'],
      noteRefs: new Map(),
      noteReferences: new Map(),
      revisionTitles: new Map([['3', ['Bold removed', 'Font changed']]]),
      revisionsInHtml: new Set(['1', '2', '3']),
      adjacentRevisions: new Set(),
    };
    const items = buildChangeItems(
      [rev('1', 'ins', 'a', ['p1']), rev('2', 'del', 'b', ['f1'], 'fn'), rev('3', 'fmt', 'c', ['p1']), rev('4', 'fmt', 'd', ['p1'])],
      index,
    );
    expect(items.map((i) => i.location)).toEqual([
      { scope: 'table' },
      { scope: 'footnote', noteId: '7' },
      { scope: 'table' },
      { scope: 'table' },
    ]);
    expect(items[2]!.description).toBe('Bold removed, Font changed');
    expect(items[3]!.description).toBeUndefined();
  });
});

describe('replaceBlockItems', () => {
  const index = buildDocIndex(
    '<p data-anchor="p" data-source-anchor-id="p:body:p">p</p><p data-anchor="q" data-source-anchor-id="p:body:q">q</p><table><tr><td><p data-anchor="t" data-source-anchor-id="p:body:t">t</p></td></tr></table><p data-anchor="r" data-source-anchor-id="p:body:r">r</p>',
  );
  const items = buildChangeItems([rev('a', 'ins', 'one ', ['p']), rev('b', 'del', 'two', ['q']), rev('c', 'ins', 'three', ['q']), rev('d', 'ins', 'four', ['r'])]);
  const parts = (item: ChangeItem) => ({ id: item.id, kind: item.kind, revisionIds: item.revisionIds, removedText: item.removedText, addedText: item.addedText, wordDelta: item.wordDelta });

  it('keeps the untouched items’ objects, updates a changed one under its id, and puts new ones in the block’s place', () => {
    const [a, b, d] = items;
    expect(b!.revisionIds).toEqual(['b', 'c']);
    const added = { id: 'eq.1', kind: 'inserted' as const, revisionIds: ['eq.1'], removedText: '', addedText: 'new', wordDelta: { removed: 0, added: 1 } };
    const shrunk = { ...parts(b!), kind: 'deleted' as const, revisionIds: ['b'], addedText: '', wordDelta: { removed: 1, added: 0 } };
    const result = replaceBlockItems(items, 'q', ['b'], [shrunk, added], index);
    expect(result.map((item) => `${item.order} ${item.id} ${item.kind}`)).toEqual(['0 a inserted', '1 b deleted', '2 eq.1 inserted', '3 d inserted']);
    expect(result[0]).toBe(a);
    expect(result[1]).toMatchObject({ ...shrunk, location: b!.location, anchors: b!.anchors });
    expect(result[2]).toMatchObject({ ...added, location: { scope: 'body' }, anchors: ['q'] });
    expect(result[3]).toEqual({ ...d, order: 3 });
  });

  it('keeps an item as it was when its revisions and text stay, and drops the items an edit removed', () => {
    const relabelled: ChangeItem = { ...items[1]!, kind: 'formatting', text: 'two', description: 'Same text', removedText: 'two', addedText: 'three' };
    const list = [items[0]!, relabelled, items[2]!];
    expect(replaceBlockItems(list, 'q', ['b'], [{ ...parts(items[1]!) }], index)[1]).toBe(relabelled);
    const touched = replaceBlockItems(list, 'q', ['b'], [{ ...parts(items[1]!), addedText: 'thre' }], index)[1]!;
    expect(touched).toMatchObject({ id: 'b', kind: 'replaced', addedText: 'thre' });
    expect(touched).not.toHaveProperty('text');
    expect(touched).not.toHaveProperty('description');
    expect(replaceBlockItems(items, 'p', ['a'], [], index).map((item) => `${item.order} ${item.id}`)).toEqual(['0 b', '1 d']);
  });

  it('puts the first items of a block before the items of later blocks, located in the block', () => {
    const added = { id: 'et.1', kind: 'inserted' as const, revisionIds: ['et.1'], removedText: '', addedText: 'cell', wordDelta: { removed: 0, added: 1 } };
    const result = replaceBlockItems(items, 't', [], [added], index);
    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'et.1', 'd']);
    expect(result[2]!.location).toEqual({ scope: 'table' });
  });
});
