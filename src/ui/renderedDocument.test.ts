import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import type { ChangeItem, ChangeKind } from '../model/changes';
import { buildDocIndex } from '../model/docIndex';
import {
  combineTypedListNumbers,
  decorateDocument,
  documentCss,
  isolateCommonAffixes,
  markCommon,
  markItems,
  mergeJoinedParagraphs,
  parseRenderedHtml,
  prepareRenderedDocument,
} from './renderedDocument';

function item(id: string, kind: ChangeKind, revisionIds: string[], anchors: string[]): ChangeItem {
  return {
    id,
    kind,
    revisionIds,
    removedText: '',
    addedText: '',
    location: { scope: 'body' },
    wordDelta: { removed: 0, added: 0 },
    order: 0,
    anchors,
  };
}

// SMALL_HTML has revisions r1–r7; r1 + r2 form one Replaced item; r8 is a formatting revision
// without an element of its own, on paragraph e.
const ITEMS = [
  item('r1', 'replaced', ['r1', 'r2'], ['a']),
  item('r3', 'inserted', ['r3'], ['b']),
  item('r4', 'formatting', ['r4'], ['c']),
  item('r5', 'deleted', ['r5'], ['d']),
  item('r6', 'moved', ['r6'], ['g']),
  item('r7', 'deleted', ['r7'], ['n']),
  item('r8', 'formatting', ['r8'], ['e', 'missing-section']),
];

describe('parseRenderedHtml', () => {
  it('removes scripts and javascript: links, and opens other links in a new tab', () => {
    const document = parseRenderedHtml(
      '<p data-anchor="x"><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="https://example.org/">web</a><a href="#fn-1">note</a></p>',
    );
    expect(document.querySelector('script')).toBeNull();
    const [bad, web, note] = document.querySelectorAll('a');
    expect(bad!.hasAttribute('href')).toBe(false);
    expect(web).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    expect(note!.hasAttribute('target')).toBe(false);
  });
});

describe('documentCss', () => {
  it('moves body and html selectors to the panel wrapper and drops per-author rules', () => {
    const document = parseRenderedHtml(`<html><head><style>
body { margin: 20px; }
body, body * { text-size-adjust: 100%; }
p.docx-BodyText { margin: 0; }
html{ color: red; }
ins[data-author="Docxodus"] { color: green; }
</style></head><body></body></html>`);
    const css = documentCss(document);
    expect(css).toContain('.doc { margin: 20px; }');
    expect(css).toContain('.doc, .doc * {');
    expect(css).toContain('p.docx-BodyText {');
    expect(css).toContain('.doc{ color: red; }');
    expect(css).not.toContain('data-author');
    expect(css).not.toMatch(/\bbody\b/);
  });
});

describe('decorateDocument', () => {
  const document = parseRenderedHtml(SMALL_HTML);
  decorateDocument(document, ITEMS, buildDocIndex(SMALL_HTML));

  it('links every revision element to its item', () => {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-author^="rev:"]')];
    expect(elements.every((element) => element.dataset.changeId !== undefined)).toBe(true);
    expect(document.querySelector('del[data-author="rev:r1"]')!.getAttribute('data-change-id')).toBe('r1');
    expect(document.querySelector('ins[data-author="rev:r2"]')!.getAttribute('data-change-id')).toBe('r1');
  });

  it('marks the paragraphs of a formatting item that has no element of its own', () => {
    const paragraph = document.querySelector('[data-anchor="e"]')!;
    expect(paragraph.firstElementChild!.outerHTML).toBe('<span class="rev-format-marker" data-change-id="r8"></span>');
    // A formatting item with its own elements gets no marker.
    expect(document.querySelectorAll('.rev-format-marker')).toHaveLength(1);
  });

  it('marks the blocks each version lacks', () => {
    const marked = (cls: string) => [...document.querySelectorAll<HTMLElement>(`.${cls}`)].map((e) => e.dataset.anchor ?? e.id);
    expect(marked('not-in-original')).toEqual(['b', 'f', 'g']);
    expect(marked('not-in-edited')).toEqual(['d']);
  });

  it('marks a note whose paragraphs a version lacks', () => {
    const html = `<section class="footnotes"><ol><li id="fn-9"><p data-anchor="z" data-source-anchor-id="p:fn:z" class="rev-para-del"><del class="rev-del" data-author="rev:r9">Gone</del></p></li></ol></section>`;
    const notes = parseRenderedHtml(html);
    decorateDocument(notes, [item('r9', 'deleted', ['r9'], ['z'])], buildDocIndex(html));
    expect(notes.querySelector('li')!.className).toBe('not-in-edited');
  });
});

describe('mergeJoinedParagraphs', () => {
  // a and b lose their paragraph mark in the Edited document, so a + b + the list item are one
  // paragraph there; d is wholly deleted (hidden on the right) and skipped; s is split in the Edited.
  const html = `<div>
    <p data-anchor="a" class="rev-para-del">A <span class="rev-para-mark-del">¶</span></p>
    <p data-anchor="b" class="rev-para-del">B </p>
    <p data-anchor="d" class="rev-para-del not-in-edited"><del>D</del></p>
    <p data-anchor="li"><ins><span data-list-marker="true">1.</span></ins><ins><span data-list-marker="true"><span></span></span></ins>Item</p>
    <p data-anchor="s" class="rev-para-ins">Split </p>
    <p data-anchor="t">here</p>
    <table><tr><td><p data-anchor="cell" class="rev-para-del">Cell</p></td></tr></table>
  </div>`;
  const panel = (side: 'left' | 'right') => {
    const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
    mergeJoinedParagraphs(root, side);
    return root;
  };
  const block = (root: Element, unid: string) => root.querySelector(`[data-anchor="${unid}"]`)!;

  it('moves a paragraph whose mark the Edited lacks after the list label of the next shown paragraph, in order', () => {
    const right = panel('right');
    expect(block(right, 'li').textContent).toBe('1.A ¶B Item');
    expect(block(right, 'a').className).toContain('merged-into-next');
    expect(block(right, 'b').className).toContain('merged-into-next');
    expect(block(right, 'd').textContent).toBe('D');
    // Nothing to merge into after the last paragraph of a cell.
    expect(block(right, 'cell').textContent).toBe('Cell');
    expect(block(right, 's').textContent).toBe('Split ');
  });

  it('joins a paragraph split in the Edited document in the left panel', () => {
    const left = panel('left');
    expect(block(left, 't').textContent).toBe('Split here');
    expect(block(left, 'li').textContent).toBe('1.Item');
  });
});

describe('combineTypedListNumbers', () => {
  const label = (id: string, text: string) =>
    `<ins data-change-id="${id}"><span data-list-marker="true">${text}</span></ins><ins data-change-id="${id}"><span data-list-marker="true"><span></span></span></ins>`;
  const typed = (id: string, text: string, kind: ChangeKind = 'deleted') => ({ ...item(id, kind, [id], []), removedText: text });

  it('combines a typed number in a paragraph joined into the numbered one, also across an empty joined paragraph', () => {
    const html = `
      <p data-anchor="a" class="rev-para-del" data-change-id="m1"><del data-change-id="t1">1. </del>First</p>
      <p data-anchor="la" data-change-id="n1">${label('n1', '1.')}</p>
      <p data-anchor="b" class="rev-para-del" data-change-id="t2"> </p>
      <p data-anchor="c" class="rev-para-del" data-change-id="m2"><del data-change-id="t2">2. </del>Second</p>
      <p data-anchor="lb" data-change-id="n2">${label('n2', '2.')}</p>`;
    const document = parseRenderedHtml(html);
    const items = [typed('t1', '1. '), item('m1', 'paragraph', ['m1'], ['a']), item('n1', 'formatting', ['n1'], ['la']), typed('t2', '¶2. '), item('m2', 'paragraph', ['m2'], ['c']), item('n2', 'formatting', ['n2'], ['lb'])];
    const result = combineTypedListNumbers(document, items);
    expect(result.map((i) => `${i.kind} ${i.revisionIds.join('+')}`)).toEqual(['formatting t1+n1', 'paragraph m1', 'formatting t2+n2', 'paragraph m2']);
    expect(result[0]).toMatchObject({ text: '1.', description: 'Typed list number replaced by automatic numbering', order: 0 });
    expect(result.map((i) => i.order)).toEqual([0, 1, 2, 3]);
    expect(document.querySelectorAll('[data-change-id="n1"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-anchor="la"] [data-change-id="t1"]')).toHaveLength(2);
  });

  it('combines a typed number right after the label in the numbered paragraph itself', () => {
    const document = parseRenderedHtml(`<p data-anchor="l" data-change-id="n">${label('n', '12.')}<del data-change-id="t">12. </del>Text</p>`);
    const result = combineTypedListNumbers(document, [item('n', 'formatting', ['n'], ['l']), typed('t', '12. ')]);
    expect(result.map((i) => `${i.kind} ${i.revisionIds.join('+')}`)).toEqual(['formatting t+n']);
  });

  it('leaves a different typed number, a deletion that carries more text, and text not at the start alone', () => {
    const html = `
      <p data-anchor="a" data-change-id="n1">${label('n1', '1.')}<del data-change-id="t1">2. </del>A</p>
      <p data-anchor="b" data-change-id="n2">${label('n2', '2.')}<del data-change-id="t2">2. More</del>B</p>
      <p data-anchor="c" data-change-id="n3">${label('n3', '3.')}Kept <del data-change-id="t3">3.</del></p>`;
    const items = [item('n1', 'formatting', ['n1'], ['a']), typed('t1', '2. '), item('n2', 'formatting', ['n2'], ['b']), typed('t2', '2. More'), item('n3', 'formatting', ['n3'], ['c']), typed('t3', '3.')];
    expect(combineTypedListNumbers(parseRenderedHtml(html), items).map((i) => i.id)).toEqual(['n1', 't1', 'n2', 't2', 'n3', 't3']);
  });
});

describe('isolateCommonAffixes and markCommon', () => {
  const html = `<p data-anchor="p">a <ins data-change-id="r" class="rev-ins"><span>szutták szövegei “az</span></ins><del data-change-id="r" class="rev-del"><span>szövegek </span></del><del data-change-id="r" class="rev-del"><span>"az</span></del> arahantok</p>`;
  const NONE = { ignoreQuotes: false, ignoreDashes: false, ignoreWhitespace: false };

  it('splits the shared end of a replacement into its own elements, marked as unchanged with the quote setting', () => {
    const document = parseRenderedHtml(html);
    isolateCommonAffixes(document, [item('r', 'replaced', ['r'], ['p'])]);
    const ins = [...document.querySelectorAll('ins')].map((e) => [e.textContent, e.getAttribute('data-common-needs')]);
    const del = [...document.querySelectorAll('del')].map((e) => [e.textContent, e.getAttribute('data-common-needs')]);
    expect(ins).toEqual([['szutták szövegei', null], [' ', 'ignoreQuotes'], ['“az', 'ignoreQuotes']]);
    expect(del).toEqual([['szövegek', null], [' ', 'ignoreQuotes'], ['"az', 'ignoreQuotes']]);
    // The split keeps the structure, attributes and text.
    expect(document.querySelector('p')!.textContent).toBe('a szutták szövegei “azszövegek "az arahantok');
    expect([...document.querySelectorAll('ins > span, del > span')]).toHaveLength(6);
    expect([...document.querySelectorAll('[data-change-id="r"]')]).toHaveLength(6);

    markCommon(document, { ...NONE, ignoreQuotes: true });
    expect(document.querySelectorAll('.change-common')).toHaveLength(4);
    markCommon(document, NONE);
    expect(document.querySelectorAll('.change-common')).toHaveLength(0);
  });
});

describe('markItems', () => {
  it('sets a class on the elements of the given items and removes it from the others', () => {
    const document = parseRenderedHtml('<p><del data-change-id="x">a</del><ins data-change-id="y" class="change-ignored">b</ins></p>');
    markItems(document, new Set(['x']), 'change-ignored');
    expect(document.querySelector('del')!.className).toBe('change-ignored');
    expect(document.querySelector('ins')!.className).toBe('');
  });
});

describe('prepareRenderedDocument', () => {
  it('analyzes and decorates one parse, and returns the scoped CSS, the body and the item texts', () => {
    const { analysis, document, itemTexts } = prepareRenderedDocument(SMALL_HTML, (parsed) => ({
      index: buildDocIndex('', () => parsed),
      items: [...ITEMS],
    }));
    expect(analysis.index.blocks).toHaveLength(10);
    expect(itemTexts.get('r1')).toEqual({ before: 'Kept old text1', after: 'Kept new text1', paragraphMark: false });
    expect(document.body.querySelector('[data-change-id="r8"]')).not.toBeNull();
    expect(document.css).toBe('');
  });
});
