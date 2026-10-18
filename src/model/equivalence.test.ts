import { describe, expect, it } from 'vitest';
import type { ChangeItem, ChangeKind } from './changes';
import {
  DEFAULT_COMPARE_SETTINGS,
  collectItemTexts,
  commonAffixes,
  ignoredItems,
  normalizeForComparison,
  relabelTextUnchanged,
  settingsMakingEqual,
  type ItemText,
} from './equivalence';

const NONE = { ignoreQuotes: false, ignoreDashes: false, ignoreWhitespace: false };

function item(id: string, kind: ChangeKind, anchors: string[] = ['p'], removedText = '', addedText = ''): ChangeItem {
  return {
    id,
    kind,
    revisionIds: [id],
    removedText,
    addedText,
    location: { scope: 'body' },
    wordDelta: { removed: 1, added: 1 },
    order: 0,
    anchors,
  };
}

describe('normalizeForComparison', () => {
  it('folds quote styles, keeping single and double apart', () => {
    const settings = { ...NONE, ignoreQuotes: true };
    expect(normalizeForComparison('„a” “b” «c» "d"', settings)).toBe('"a" "b" "c" "d"');
    expect(normalizeForComparison('‘a’ ‚b‛ \'c\'', settings)).toBe("'a' 'b' 'c'");
    expect(normalizeForComparison('„a”', NONE)).toBe('„a”');
  });

  it('folds the ellipsis character into three dots with the quote setting', () => {
    const settings = { ...NONE, ignoreQuotes: true };
    expect(normalizeForComparison("...'", settings)).toBe(normalizeForComparison('…’', settings));
    expect(normalizeForComparison('…', NONE)).toBe('…');
  });

  it('folds dashes', () => {
    expect(normalizeForComparison('a - b – c — d − e', { ...NONE, ignoreDashes: true })).toBe('a - b - c - d - e');
  });

  it('collapses whitespace, including paragraph breaks, and trims', () => {
    expect(normalizeForComparison(' a \t b\n\nc ', { ...NONE, ignoreWhitespace: true })).toBe('a b c');
  });

  it('always normalizes to NFC', () => {
    expect(normalizeForComparison('ā', NONE)).toBe('ā');
  });
});

describe('settingsMakingEqual', () => {
  it('finds the fewest settings that make two texts equal', () => {
    expect(settingsMakingEqual('az', 'az')).toEqual([]);
    expect(settingsMakingEqual('"az', '“az')).toEqual(['ignoreQuotes']);
    expect(settingsMakingEqual('„a – b"', '"a - b”')).toEqual(['ignoreQuotes', 'ignoreDashes']);
    expect(settingsMakingEqual('az', 'ez')).toBeNull();
  });
});

describe('commonAffixes', () => {
  it('finds the words a replacement shares at its end, with the settings each needs', () => {
    expect(commonAffixes('szövegek "az', 'szutták szövegei “az')).toEqual({
      prefix: [],
      suffix: [
        { removedLength: 3, addedLength: 3, needs: ['ignoreQuotes'] },
        { removedLength: 1, addedLength: 1, needs: ['ignoreQuotes'] },
      ],
    });
  });

  it('finds shared words at the start, and never lets the edges overlap', () => {
    expect(commonAffixes('„a régi', '"a új')).toEqual({ prefix: [{ removedLength: 2, addedLength: 2, needs: ['ignoreQuotes'] }, { removedLength: 1, addedLength: 1, needs: ['ignoreQuotes'] }], suffix: [] });
    expect(commonAffixes('a b', 'a b c').prefix).toHaveLength(3);
    expect(commonAffixes('a b', 'a b c').suffix).toEqual([]);
  });

  it('shares nothing when the edge words differ', () => {
    expect(commonAffixes('régi', 'új')).toEqual({ prefix: [], suffix: [] });
  });
});

describe('ignoredItems', () => {
  const texts = new Map<string, ItemText>([
    ['quote', { before: 'a „szentelt" víz', after: 'a „szentelt” víz', paragraphMark: false }],
    ['dash', { before: 'a - b', after: 'a – b', paragraphMark: false }],
    ['space', { before: 'a  b', after: 'a b', paragraphMark: false }],
    ['join', { before: 'ab', after: 'a b', paragraphMark: false }],
    ['empty', { before: '', after: '', paragraphMark: true }],
    ['word', { before: 'a b', after: 'a c', paragraphMark: false }],
    ['format', { before: 'x', after: 'x', paragraphMark: false }],
  ]);
  const items = [
    item('quote', 'replaced'),
    item('dash', 'replaced'),
    item('space', 'deleted'),
    item('join', 'inserted'),
    item('empty', 'paragraph'),
    item('word', 'replaced'),
    item('format', 'formatting'),
  ];

  it('ignores each kind of change only with its setting', () => {
    expect([...ignoredItems(items, texts, NONE)]).toEqual([]);
    expect([...ignoredItems(items, texts, { ...NONE, ignoreQuotes: true })]).toEqual(['quote']);
    expect([...ignoredItems(items, texts, { ...NONE, ignoreDashes: true })]).toEqual(['dash']);
    expect([...ignoredItems(items, texts, { ...NONE, ignoreWhitespace: true })]).toEqual(['space', 'empty']);
  });

  it('never ignores a change that splits or joins words, a real text change, or a formatting item', () => {
    const ignored = ignoredItems(items, texts, DEFAULT_COMPARE_SETTINGS);
    expect([...ignored]).toEqual(['quote', 'dash', 'space', 'empty']);
  });
});

describe('relabelTextUnchanged', () => {
  it('turns a replacement of identical text into a formatting item', () => {
    const texts = new Map<string, ItemText>([
      ['same', { before: 'a pavāraṇā b', after: 'a pavāraṇā b', paragraphMark: false }],
      ['mark', { before: 'a\nb', after: 'a\nb', paragraphMark: true }],
      ['real', { before: 'a', after: 'b', paragraphMark: false }],
    ]);
    const input = [item('same', 'replaced', ['p'], 'pavāraṇā', 'pavāraṇā'), item('mark', 'paragraph'), item('real', 'replaced')];
    const { items, relabelled } = relabelTextUnchanged(input, texts);
    expect([...relabelled]).toEqual(['same']);
    expect(items[0]).toMatchObject({ kind: 'formatting', text: 'pavāraṇā', removedText: '', addedText: '', wordDelta: { removed: 0, added: 0 } });
    expect(items[1]).toBe(input[1]);
    expect(items[2]).toBe(input[2]);
  });
});

describe('collectItemTexts', () => {
  it('reads each change against the Original state of the other changes in its paragraphs', () => {
    const html = `
      <p data-anchor="p"><span>Tilos </span><ins data-change-id="a">„szentelt”</ins><del data-change-id="a">„szentelt"</del> vizet <ins data-change-id="b">orvos</ins><del data-change-id="b">orvosnak</del>.<span class="rev-para-mark-del">¶</span></p>
      <p data-anchor="q" class="rev-para-del" data-change-id="c"><del data-change-id="c">Gone</del></p>`;
    const document = new DOMParser().parseFromString(html, 'text/html');
    const texts = collectItemTexts(document, [item('a', 'replaced'), item('b', 'replaced'), item('c', 'deleted', ['p', 'q']), item('f', 'formatting')]);
    expect(texts.get('a')).toEqual({ before: 'Tilos „szentelt" vizet orvosnak.', after: 'Tilos „szentelt” vizet orvosnak.', paragraphMark: false });
    expect(texts.get('b')).toEqual({ before: 'Tilos „szentelt" vizet orvosnak.', after: 'Tilos „szentelt" vizet orvos.', paragraphMark: false });
    expect(texts.get('c')).toEqual({
      before: 'Tilos „szentelt" vizet orvosnak.\nGone',
      after: 'Tilos „szentelt" vizet orvosnak.\n',
      paragraphMark: true,
    });
    expect(texts.has('f')).toBe(false);
    // From one block: the items' other blocks don't count.
    const fromBlock = collectItemTexts(document.querySelector('[data-anchor="p"]')!, [item('a', 'replaced'), item('c', 'deleted', ['p', 'q'])]);
    expect(fromBlock.get('a')).toEqual(texts.get('a'));
    expect(fromBlock.get('c')).toEqual({ before: 'Tilos „szentelt" vizet orvosnak.', after: 'Tilos „szentelt" vizet orvosnak.', paragraphMark: false });
  });
});
