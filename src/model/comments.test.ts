import { describe, expect, it } from 'vitest';
import type { ChangeItem, ChangeKind } from './changes';
import { commentParagraphs, exportComments } from './comments';
import { INITIAL_DECISIONS } from './decisions';
import type { RangeClass } from './range';

function item(id: string, kind: ChangeKind, fields: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id,
    kind,
    revisionIds: [id, `${id}2`],
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order: 0,
    anchors: [],
    ...fields,
  };
}

describe('commentParagraphs', () => {
  it('says the decision, both sides of the change and the comment, one paragraph per line', () => {
    expect(commentParagraphs(item('a', 'replaced', { removedText: 'brown', addedText: 'red' }), 'accept', ' Better.\nShorter. ')).toEqual([
      'Accepted:',
      '',
      'Changed from',
      'brown',
      'to',
      'red',
      '',
      'Comment:',
      'Better.',
      'Shorter.',
    ]);
  });

  it('names an empty side, splits paragraphs and shows a bare paragraph break', () => {
    const inserted = commentParagraphs(item('a', 'inserted', { addedText: 'One.¶Two.¶' }), 'reject', 'No.');
    expect(inserted.slice(0, 7)).toEqual(['Rejected:', '', 'Changed from', '(nothing)', 'to', 'One.', 'Two.']);
    expect(commentParagraphs(item('p', 'paragraph', { addedText: '¶' }), 'accept', 'x').slice(3, 6)).toEqual(['(nothing)', 'to', '(paragraph break)']);
  });

  it('gives a move its wording at both ends', () => {
    const moved = item('m', 'moved', { text: 'alms food', moveEdit: { from: 'daily alms food', to: 'alms food' } });
    expect(commentParagraphs(moved, 'accept', 'x').slice(2, 6)).toEqual(['Changed from', 'daily alms food', 'to', 'alms food']);
    expect(commentParagraphs(item('n', 'moved', { text: 'alms food' }), 'accept', 'x').slice(3, 6)).toEqual(['alms food', 'to', 'alms food']);
  });
});

describe('exportComments', () => {
  it('exports the non-blank comments of in-range text items with their final decision', () => {
    const items = [item('a', 'deleted', { removedText: 'x' }), item('b', 'inserted', { addedText: 'y' }), item('c', 'deleted'), item('d', 'deleted')];
    const range = new Map<string, RangeClass>([['d', 'outOfRange']]);
    const state = { ...INITIAL_DECISIONS, comments: { a: 'First', b: '  ', d: 'Out of range' } };
    const final = new Map([['a', 'reject' as const]]);
    const comments = exportComments(items, state, range, final);
    expect(comments.map((comment) => comment.revisionIds)).toEqual([['a', 'a2']]);
    expect(comments[0]!.paragraphs[0]).toBe('Rejected:');
    expect(comments[0]!.paragraphs.at(-1)).toBe('First');
  });
});
