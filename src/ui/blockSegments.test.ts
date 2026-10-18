import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import { originalText, visibleText, OBJECT_CHAR } from '../model/paragraphEdit';
import { readBlockSegments } from './blockSegments';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const block = (document: Document, unid: string) => document.querySelector(`[data-anchor="${unid}"]`)!;

describe('readBlockSegments', () => {
  const small = parse(SMALL_HTML);

  it('reads unchanged text, each revision’s text and note references', () => {
    expect(readBlockSegments(block(small, 'a'))).toEqual([
      { kind: 'equal', text: 'Kept ' },
      { kind: 'del', text: 'old', itemId: 'r1', revisionId: 'r1' },
      { kind: 'ins', text: 'new', itemId: 'r2', revisionId: 'r2' },
      { kind: 'equal', text: ' text' },
      { kind: 'object', key: 'fn:3' },
    ]);
    expect(readBlockSegments(block(small, 't'))).toEqual([{ kind: 'equal', text: 'Cell ' }, { kind: 'object', key: 'en:2' }]);
  });

  it('takes item ids from data-change-id', () => {
    const document = parse(SMALL_HTML);
    for (const element of document.querySelectorAll<HTMLElement>('[data-author="rev:r1"], [data-author="rev:r2"]')) element.dataset.changeId = 'r1';
    expect(readBlockSegments(block(document, 'a')).slice(1, 3)).toEqual([
      { kind: 'del', text: 'old', itemId: 'r1', revisionId: 'r1' },
      { kind: 'ins', text: 'new', itemId: 'r1', revisionId: 'r2' },
    ]);
  });

  it('skips back links, ¶ glyphs and list labels', () => {
    expect(readBlockSegments(block(small, 'n'))).toEqual([
      { kind: 'equal', text: 'Note ' },
      { kind: 'del', text: 'text', itemId: 'r7', revisionId: 'r7' },
    ]);
    expect(readBlockSegments(block(small, 'd'))).toEqual([{ kind: 'del', text: 'Deleted paragraph', itemId: 'r5', revisionId: 'r5' }]);
    const listItem = parse('<p data-anchor="l"><span data-list-marker="true">1.<span data-docx-tab="left"></span></span><span>Item</span></p>');
    expect(readBlockSegments(block(listItem, 'l'))).toEqual([{ kind: 'equal', text: 'Item' }]);
  });

  it('reads an empty paragraph as no segments, and drops the space before a deleted mark’s ¶', () => {
    expect(readBlockSegments(block(small, 'e'))).toEqual([]);
    const filler = parse('<p data-anchor="f"><span> </span></p><p data-anchor="g" class="rev-para-del"><span>Text</span><span xml:space="preserve"> </span><span class="rev-para-mark-del">¶</span></p>');
    expect(readBlockSegments(block(filler, 'f'))).toEqual([]);
    expect(readBlockSegments(block(filler, 'g'))).toEqual([{ kind: 'equal', text: 'Text' }]);
  });

  it('reads tabs and line breaks as objects, without the mark after a break', () => {
    const document = parse(
      '<p data-anchor="b"><span>One</span><span data-docx-tab="left"></span><span>two<br>‎three</span><ins data-author="rev:r9"><br>‎</ins></p>',
    );
    const segments = readBlockSegments(block(document, 'b'));
    expect(segments).toEqual([
      { kind: 'equal', text: 'One' },
      { kind: 'object', key: 'tab' },
      { kind: 'equal', text: 'two' },
      { kind: 'object', key: 'br' },
      { kind: 'equal', text: 'three' },
      { kind: 'object', key: 'br', owner: { change: 'ins', itemId: 'r9', revisionId: 'r9' } },
    ]);
    expect(visibleText(segments)).toBe(`One${OBJECT_CHAR}two${OBJECT_CHAR}three${OBJECT_CHAR}`);
    expect(originalText(segments)).toBe(`One${OBJECT_CHAR}two${OBJECT_CHAR}three`);
  });

  it('reads the split-off shared edges of a replacement as part of their revision', () => {
    const document = parse(
      '<p data-anchor="c"><del data-author="rev:r1" data-change-id="r1">„szöve</del><del data-author="rev:r1" data-change-id="r1" data-common-needs="">gek</del><ins data-author="rev:r2" data-change-id="r1">szutták</ins></p>',
    );
    expect(readBlockSegments(block(document, 'c'))).toEqual([
      { kind: 'del', text: '„szövegek', itemId: 'r1', revisionId: 'r1' },
      { kind: 'ins', text: 'szutták', itemId: 'r1', revisionId: 'r2' },
    ]);
  });
});
