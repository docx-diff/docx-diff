import { describe, expect, it } from 'vitest';
import { SMALL_HTML } from '../../test/small-html';
import { applyTextEdit, originalText, visibleText, OBJECT_CHAR, type Segment } from '../model/paragraphEdit';
import { readBlockSegments, renderBlockSegments, uneditableReason, visibleOffset, visiblePoint } from './blockSegments';

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
    const filler = parse('<p data-anchor="f"><span>\u00a0</span></p><p data-anchor="g" class="rev-para-del"><span>Text</span><span xml:space="preserve"> </span><span class="rev-para-mark-del">¶</span></p>');
    expect(readBlockSegments(block(filler, 'f'))).toEqual([]);
    expect(readBlockSegments(block(filler, 'g'))).toEqual([{ kind: 'equal', text: 'Text' }]);
  });

  it('reads tabs and line breaks as objects, without the mark after a break', () => {
    const document = parse(
      '<p data-anchor="b"><span>One</span><span data-docx-tab="left"></span><span>two<br>\u200ethree</span><ins data-author="rev:r9"><br>\u200e</ins></p>',
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

describe('reading a block a browser edited', () => {
  it('ignores the line break a browser puts in a paragraph it emptied, not the converter’s', () => {
    const document = parse(
      '<p data-anchor="x"><span>Text</span><br></p><p data-anchor="y"><span>A<br>\u200eB</span><del data-author="rev:r9"><br></del></p>',
    );
    expect(readBlockSegments(block(document, 'x'))).toEqual([{ kind: 'equal', text: 'Text' }]);
    expect(readBlockSegments(block(document, 'y'))).toEqual([
      { kind: 'equal', text: 'A' },
      { kind: 'object', key: 'br' },
      { kind: 'equal', text: 'B' },
      { kind: 'object', key: 'br', owner: { change: 'del', itemId: 'r9', revisionId: 'r9' } },
    ]);
  });
});

describe('visibleOffset and visiblePoint', () => {
  const small = parse(SMALL_HTML);
  const a = block(small, 'a');
  const text = (element: Element, i = 0) => [...element.childNodes].filter((node) => node.nodeType === 3)[i]!;

  it('map cursor positions to offsets in the visible text and back, objects as one', () => {
    expect(visibleText(readBlockSegments(a))).toBe(`Kept new text${OBJECT_CHAR}`);
    for (let offset = 0; offset <= 14; offset++) {
      const point = visiblePoint(a, offset);
      expect(visibleOffset(a, point.node, point.offset)).toBe(offset);
    }
  });

  it('put the cursor after the character before it, never in a hidden deletion', () => {
    expect(visiblePoint(a, 0)).toEqual({ node: text(a), offset: 0 });
    expect(visiblePoint(a, 5)).toEqual({ node: text(a), offset: 5 });
    expect(visiblePoint(a, 6)).toEqual({ node: a.querySelector('ins')!.firstChild, offset: 1 });
    expect(visiblePoint(a, 14)).toEqual({ node: a, offset: 5 });
    expect(visiblePoint(a, 99)).toEqual({ node: a, offset: 5 });
    // A point inside the deletion counts the visible text before it.
    expect(visibleOffset(a, a.querySelector('del')!.firstChild!, 2)).toBe(5);
  });

  it('count from after a list label, and place the cursor in an empty paragraph', () => {
    const document = parse('<p data-anchor="l"><span data-list-marker="true">1.</span><span>Item</span></p><p data-anchor="e"><span>\u00a0</span></p>');
    const item = block(document, 'l');
    expect(visibleOffset(item, item, 0)).toBe(0);
    expect(visibleOffset(item, item, 1)).toBe(0);
    expect(visiblePoint(item, 0)).toEqual({ node: item.lastChild!.firstChild, offset: 0 });
    const empty = block(document, 'e');
    expect(visiblePoint(empty, 0)).toEqual({ node: empty.firstChild!.firstChild, offset: 0 });
    expect(visiblePoint(block(small, 'e'), 0)).toEqual({ node: block(small, 'e'), offset: 0 });
  });
});

describe('renderBlockSegments', () => {
  /** The block's segments after an edit of its visible text, and the block rendered with them. */
  const edit = (html: string, change: (visible: string) => string, caret?: (after: string) => number) => {
    const element = block(parse(html), 'x');
    const before = readBlockSegments(element);
    const after = change(visibleText(before));
    const { segments } = applyTextEdit(before, after, { unid: 'x', nextId: 1, caret: caret?.(after) });
    const rendered = renderBlockSegments(element, segments);
    return { segments, rendered, html: rendered.innerHTML };
  };

  it('gives the block back as it was when the segments are its own', () => {
    const shapes = [
      ...[...parse(SMALL_HTML).querySelectorAll('[data-anchor]')].map((element) => element.outerHTML),
      '<p data-anchor="l"><span data-list-marker="true">1.<span data-docx-tab="left"></span></span><span>Item</span></p>',
      '<p data-anchor="b"><span>One</span><span data-docx-tab="left"></span><span>two<br>\u200ethree</span><ins data-author="rev:r9"><br>\u200e</ins></p>',
      '<p data-anchor="f"><span>\u00a0</span></p>',
      '<p data-anchor="g" class="rev-para-del"><span>Text</span><span xml:space="preserve"> </span><span class="rev-para-mark-del">¶</span></p>',
      '<p data-anchor="h"><span>Hours:</span><span> from dawn, </span><a id="hours"></a><span>every day</span></p>',
    ];
    for (const html of shapes) {
      const element = parse(html).querySelector('[data-anchor]')!;
      expect(renderBlockSegments(element, readBlockSegments(element)).outerHTML, html).toBe(element.outerHTML);
    }
  });

  it('puts a typed word in a new insertion with the formatting of the character before it', () => {
    const { segments, rendered, html } = edit(
      '<p data-anchor="x"><span class="docx-a">The red </span><span class="docx-b">house</span></p>',
      (visible) => visible.replace('red ', 'red big '),
    );
    expect(readBlockSegments(rendered)).toEqual(segments);
    expect(html).toBe(
      '<span class="docx-a">The red </span><ins class="rev-ins" data-author="rev:ex.1" data-change-id="ex.1"><span class="docx-a">big </span></ins><span class="docx-b">house</span>',
    );
  });

  it('takes the formatting of the character after the text typed at the start', () => {
    const { html } = edit('<p data-anchor="x"><span class="docx-a">house</span></p>', (visible) => `Big ${visible}`, () => 4);
    expect(html).toBe('<ins class="rev-ins" data-author="rev:ex.1" data-change-id="ex.1"><span class="docx-a">Big </span></ins><span class="docx-a">house</span>');
  });

  it('keeps a typo fixed inside an insertion in that insertion, with its attributes', () => {
    const { segments, rendered } = edit(
      '<p data-anchor="x"><span class="docx-a">The </span><ins class="rev-ins" data-author="rev:r2" data-change-id="r1" data-date="2000-01-01T00:00:00Z"><span class="docx-a">hosue</span></ins></p>',
      (visible) => visible.replace('hosue', 'house'),
    );
    expect(rendered.innerHTML).toBe(
      '<span class="docx-a">The </span><ins class="rev-ins" data-author="rev:r2" data-change-id="r1" data-date="2000-01-01T00:00:00Z"><span class="docx-a">house</span></ins>',
    );
    expect(readBlockSegments(rendered)).toEqual(segments);
  });

  it('turns a changed word of unchanged text into a deletion and an insertion, dated like the block’s changes', () => {
    const { segments, rendered } = edit(
      '<p data-anchor="x"><span class="docx-a">The red house</span><ins class="rev-ins" data-author="rev:r1" data-change-id="r1" data-date="2000-01-01T00:00:00Z"><span class="docx-a">!</span></ins></p>',
      (visible) => visible.replace('red', 'blue'),
    );
    expect(rendered.innerHTML).toBe(
      '<span class="docx-a">The </span>' +
        '<del class="rev-del" data-author="rev:ex.1" data-date="2000-01-01T00:00:00Z" data-change-id="ex.1"><span class="docx-a">red</span></del>' +
        '<ins class="rev-ins" data-author="rev:ex.2" data-date="2000-01-01T00:00:00Z" data-change-id="ex.1"><span class="docx-a">blue</span></ins>' +
        '<span class="docx-a"> house</span><ins class="rev-ins" data-author="rev:r1" data-change-id="r1" data-date="2000-01-01T00:00:00Z"><span class="docx-a">!</span></ins>',
    );
    expect(readBlockSegments(rendered)).toEqual(segments);
  });

  it('gives deleted text typed back its place as unchanged text', () => {
    const { segments, rendered } = edit(
      '<p data-anchor="x"><span class="docx-a">The </span><ins class="rev-ins" data-author="rev:r2" data-change-id="r1"><span class="docx-a">jungle</span></ins><del class="rev-del" data-author="rev:r1" data-change-id="r1"><span class="docx-d">forest</span></del><span class="docx-a">.</span></p>',
      (visible) => visible.replace('jungle', 'forest'),
    );
    expect(segments).toEqual([{ kind: 'equal', text: 'The forest.' }]);
    expect(rendered.innerHTML).toBe('<span class="docx-a">The </span><span class="docx-d">forest</span><span class="docx-a">.</span>');
    expect(readBlockSegments(rendered)).toEqual(segments);
  });

  it('keeps list labels, bookmarks, objects and the mark after a break in place', () => {
    const label = edit(
      '<p data-anchor="x"><span data-list-marker="true">1.</span><span class="docx-a">Item</span></p>',
      (visible) => `New ${visible}`,
      () => 4,
    );
    expect(label.html).toBe('<span data-list-marker="true">1.</span><ins class="rev-ins" data-author="rev:ex.1" data-change-id="ex.1"><span class="docx-a">New </span></ins><span class="docx-a">Item</span>');
    const objects = edit(
      '<p data-anchor="x"><span class="docx-a">One<br>\u200etwo</span><a id="mark"></a><span class="docx-a"> three</span><a href="#fn-1" class="footnote-ref" data-footnote-id="1"><sup>1</sup></a></p>',
      (visible) => visible.replace('two', 'two and'),
      (after) => after.indexOf('and') + 3,
    );
    expect(objects.html).toBe(
      '<span class="docx-a">One<br>\u200etwo</span><ins class="rev-ins" data-author="rev:ex.1" data-change-id="ex.1"><span class="docx-a"> and</span></ins><a id="mark"></a><span class="docx-a"> three</span><a href="#fn-1" class="footnote-ref" data-footnote-id="1"><sup>1</sup></a>',
    );
    expect(readBlockSegments(objects.rendered)).toEqual(objects.segments);
  });

  it('drops an empty paragraph’s filler when it gets text, and gives one to a paragraph whose text goes', () => {
    const typed = edit('<p data-anchor="x"><span class="docx-a">\u00a0</span></p>', () => 'Text');
    expect(typed.html).toBe('<ins class="rev-ins" data-author="rev:ex.1" data-change-id="ex.1"><span class="docx-a">Text</span></ins>');
    const element = block(parse('<p data-anchor="x"><ins data-author="rev:r1" data-change-id="r1"><span>Text</span></ins></p>'), 'x');
    const segments: Segment[] = [];
    const emptied = renderBlockSegments(element, segments);
    expect(emptied.textContent).toBe('\u00a0');
    expect(readBlockSegments(emptied)).toEqual([]);
  });

  it('refuses segments whose Original text differs from the block’s', () => {
    const element = block(parse('<p data-anchor="x"><span>Text</span></p>'), 'x');
    expect(() => renderBlockSegments(element, [{ kind: 'equal', text: 'Other' }])).toThrow(/Original text differs/);
  });
});

describe('uneditableReason', () => {
  const small = parse(SMALL_HTML);
  const none = { outOfRange: new Set<string>(), uneditable: {} };

  it('lets paragraphs in the body, table cells and notes be edited', () => {
    for (const unid of ['a', 't', 'n', 'm']) expect(uneditableReason(block(small, unid), none), unid).toBeUndefined();
  });

  it('refuses paragraphs with a paragraph-mark change or move content, and those following a changed mark', () => {
    expect(uneditableReason(block(small, 'b'), none)).toBe('paragraph-break');
    expect(uneditableReason(block(small, 'c'), none)).toBe('joined');
    expect(uneditableReason(block(small, 'd'), none)).toBe('paragraph-break');
    expect(uneditableReason(block(small, 'e'), none)).toBe('joined');
    expect(uneditableReason(block(small, 'g'), none)).toBe('move');
  });

  it('refuses paragraphs outside the range, those the export can’t patch, and what isn’t a paragraph', () => {
    expect(uneditableReason(block(small, 'a'), { ...none, outOfRange: new Set(['a']) })).toBe('out-of-range');
    expect(uneditableReason(block(small, 'a'), { ...none, uneditable: { a: 'a run contains w:fldChar' } })).toBe('object');
    expect(uneditableReason(small.querySelector('table')!, none)).toBe('not-a-paragraph');
  });
});
