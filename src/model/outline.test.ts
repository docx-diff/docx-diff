import { describe, expect, it } from 'vitest';
import type { DocumentHeading } from '../engine/types';
import { buildOutline } from './outline';

function outlineOf(body: string, original: DocumentHeading[], edited: DocumentHeading[]) {
  return buildOutline(new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html'), { original, edited });
}

const h = (level: number, text: string): DocumentHeading => ({ level, text });

describe('buildOutline', () => {
  it("places the Edited's headings on their paragraphs, whatever element the redline made of them", () => {
    expect(
      outlineOf(
        `<h1 data-anchor="a">Title</h1>
        <p data-anchor="b">Text</p>
        <p data-anchor="c" class="rev-para-format-change">Section <span>one</span></p>
        <p data-anchor="d">Part</p>`,
        [h(1, 'Title')],
        [h(1, 'Title'), h(3, 'Section one'), h(2, 'Part')],
      ),
    ).toEqual([
      { unid: 'a', level: 1, text: 'Title', inOriginal: true, inEdited: true },
      { unid: 'c', level: 3, text: 'Section one', inOriginal: true, inEdited: true },
      { unid: 'd', level: 2, text: 'Part', inOriginal: true, inEdited: true },
    ]);
  });

  it("matches each version's own wording, and marks headings only one version has", () => {
    const body = `
      <h2 data-anchor="a">Old <del class="rev-del">name</del><ins class="rev-ins">title</ins></h2>
      <h2 data-anchor="b" class="rev-para-del"><del class="rev-del">Gone</del><span class="rev-para-mark-del">¶</span></h2>
      <h2 data-anchor="c" class="rev-para-ins"><ins class="rev-ins">New</ins></h2>`;
    expect(outlineOf(body, [h(2, 'Old name'), h(2, 'Gone')], [h(2, 'Old title'), h(2, 'New')])).toEqual([
      { unid: 'a', level: 2, text: 'Old title', inOriginal: true, inEdited: true },
      { unid: 'c', level: 2, text: 'New', inOriginal: false, inEdited: true },
    ]);
    // The Original's headings only when the Edited has none.
    expect(outlineOf(body, [h(2, 'Old name'), h(2, 'Gone')], [])).toEqual([
      { unid: 'a', level: 2, text: 'Old name', inOriginal: true, inEdited: true },
      { unid: 'b', level: 2, text: 'Gone', inOriginal: true, inEdited: false },
    ]);
  });

  it('matches in document order, skipping headings it cannot place', () => {
    expect(
      outlineOf(
        `<p data-anchor="a">Notes</p><p data-anchor="b">Intro</p><p data-anchor="c">Notes</p>`,
        [],
        [h(1, 'Intro'), h(1, 'Not in the HTML'), h(1, 'Notes')],
      ).map((entry) => entry.unid),
    ).toEqual(['b', 'c']);
  });

  it('ignores list labels and note references, and places a heading joined from two paragraphs on the first', () => {
    expect(
      outlineOf(
        `<p data-anchor="a"><span data-list-marker="">1.</span> Intro<a class="footnote-ref" data-footnote-id="1"><sup>1</sup></a></p>
        <p data-anchor="b" class="rev-para-del">Two <span class="rev-para-mark-del">¶</span></p>
        <p data-anchor="c">halves</p>
        <section class="footnotes"><ol><li id="fn-1"><p data-anchor="n">Intro</p></li></ol></section>`,
        [],
        [h(1, 'Intro'), h(1, 'Two halves')],
      ).map((entry) => entry.unid),
    ).toEqual(['a', 'b']);
  });
});
