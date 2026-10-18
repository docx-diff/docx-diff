import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import { adjacencyKey, buildDocIndex, noteKey, replaceIndexBlock } from './docIndex';

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

  it('knows which blocks the Edited document has: not wholly deleted or moved-from, empty ones unless their mark is deleted', () => {
    const edited = index.blocks.filter((b) => b.inEdited).map((b) => b.unid);
    expect(edited).toEqual(['a', 'b', 'c', 'e', 'f', 'g', 't', 'n', 'm']);
  });

  it('maps footnote and endnote references to the referencing paragraph', () => {
    expect(index.noteRefs).toEqual(
      new Map([
        [noteKey('fn', '3'), 'a'],
        [noteKey('en', '2'), 't'],
      ]),
    );
  });

  it('maps a note referenced from several paragraphs to the first of them', () => {
    const twice = SMALL_HTML.replace(
      'Cell <a href="#en-2"',
      'Cell <a href="#fn-3" class="footnote-ref" data-footnote-id="3"><sup>1</sup></a><a href="#en-2"',
    );
    expect(buildDocIndex(twice).noteRefs.get(noteKey('fn', '3'))).toBe('a');
  });

  it('collects revision ids and unique title phrases', () => {
    expect([...index.revisionsInHtml].sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    expect(index.revisionTitles.get('r4')).toEqual(['Bold removed', 'Font changed', 'Font size changed']);
    expect(index.revisionTitles.has('r1')).toBe(false);
  });

  it('records revisions whose text touches within a paragraph', () => {
    // r1/r2: "<del>old</del><ins>new</ins>"; r5's deletion is followed only by its own ¶ marker.
    expect(index.adjacentRevisions).toEqual(new Set([adjacencyKey('r1', 'r2')]));
  });
});

describe('replaceIndexBlock', () => {
  it('takes the replaced block’s revisions and adjacencies from its new markup, and keeps the blocks', () => {
    const index = buildDocIndex(SMALL_HTML);
    const document = new DOMParser().parseFromString(SMALL_HTML, 'text/html');
    const before = document.querySelector('[data-anchor="a"]')!;
    const after = new DOMParser().parseFromString(
      '<p data-anchor="a">Kept <del data-author="rev:r1">old</del><ins data-author="rev:ea.2">newer</ins> text <ins data-author="rev:ea.3">!</ins></p>',
      'text/html',
    ).querySelector('p')!;
    const replaced = replaceIndexBlock(index, before, after);
    expect(replaced.revisionsInHtml.has('r2')).toBe(false);
    expect(['r1', 'ea.2', 'ea.3', 'r3'].every((id) => replaced.revisionsInHtml.has(id))).toBe(true);
    expect(replaced.adjacentRevisions.has(adjacencyKey('r1', 'r2'))).toBe(false);
    expect(replaced.adjacentRevisions.has(adjacencyKey('r1', 'ea.2'))).toBe(true);
    expect(replaced.adjacentRevisions.has(adjacencyKey('ea.2', 'ea.3'))).toBe(false);
    expect(replaced.blocks).toBe(index.blocks);
    expect(index.revisionsInHtml.has('r2')).toBe(true);
  });
});
