import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import { buildDocIndex, noteKey } from './docIndex';

describe('buildDocIndex', () => {
  const index = buildDocIndex(SMALL_HTML);

  it('lists the anchored blocks in document order with scope, table and note id', () => {
    expect(index.blocks.map((b) => b.unid)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 't', 'n', 'm']);
    expect(index.blockByUnid.get('t')).toMatchObject({ scope: 'body', inTable: true });
    expect(index.blockByUnid.get('n')).toMatchObject({ scope: 'fn', noteId: '3', inTable: false });
    expect(index.blockByUnid.get('m')).toMatchObject({ scope: 'en', noteId: '2' });
  });

  it('keeps the Original body paragraphs: not wholly inserted or moved-to, empty ones unless inserted', () => {
    expect(index.bodyParagraphs).toEqual(['a', 'c', 'd', 'e', 't']);
  });

  it('maps footnote and endnote references to the referencing paragraph', () => {
    expect(index.noteRefs).toEqual(
      new Map([
        [noteKey('fn', '3'), 'a'],
        [noteKey('en', '2'), 't'],
      ]),
    );
  });

  it('collects revision ids and unique title phrases', () => {
    expect([...index.revisionsInHtml].sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    expect(index.revisionTitles.get('r4')).toEqual(['Bold removed', 'Font changed', 'Font size changed']);
    expect(index.revisionTitles.has('r1')).toBe(false);
  });
});
