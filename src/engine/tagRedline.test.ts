import { beforeAll, describe, expect, it } from 'vitest';
import { initNodeEngine } from '../../test/node-engine';
import { minimalDocx } from '../../test/minimal-docx';
import { compare, listRevisions, render } from './docxodus';
import { W_NS, parseConstituentKey, parseXml, readPart, serializeXml, unzipDocx, writePart, zipDocx, ElementIndex } from './ooxml';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
import { revisionAuthor, revisionIdFromAuthor, tagRedline, unlinkHyperlinksWithChanges } from './tagRedline';
import type { RevisionListEntry } from './types';

const moving = 'This paragraph is long enough to be detected as moved rather than deleted and inserted again.';

describe('revision author tags', () => {
  it('round-trips a revision id', () => {
    expect(revisionIdFromAuthor(revisionAuthor('rev2-abc'))).toBe('rev2-abc');
    expect(revisionIdFromAuthor('Docxodus')).toBeNull();
    expect(revisionIdFromAuthor(null)).toBeNull();
  });
});

describe('unlinkHyperlinksWithChanges', () => {
  const xml = (body: string) => `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body><w:p>${body}</w:p></w:body></w:document>`;
  const unlink = (body: string) => {
    const document = parseXml(xml(body));
    unlinkHyperlinksWithChanges(document);
    return new TextDecoder().decode(serializeXml(document));
  };
  const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
  const changes = `${run('the ')}<w:ins w:id="1">${run('home page')}</w:ins><w:del w:id="2"><w:r><w:delText>website</w:delText></w:r></w:del>`;

  it('points a hyperlink with tracked changes inside to no relationship, keeping its content as it is', () => {
    expect(unlink(`<w:hyperlink r:id="rId9">${changes}</w:hyperlink>`)).toBe(xml(`<w:hyperlink r:id="docxDiffUnlinked">${changes}</w:hyperlink>`));
    expect(unlink(`<w:hyperlink w:anchor="here">${changes}</w:hyperlink>`)).toBe(xml(`<w:hyperlink r:id="docxDiffUnlinked">${changes}</w:hyperlink>`));
  });

  it('leaves a hyperlink without tracked changes alone', () => {
    const body = `<w:hyperlink w:anchor="here">${run('a')}${run('b')}</w:hyperlink>`;
    expect(unlink(body)).toBe(xml(body));
  });

  it('renders both versions of an edited link text, with the anchors of the untouched redline', async () => {
    await initNodeEngine();
    const original = minimalDocx(['First paragraph of the text.', 'Second paragraph.']);
    const redline = await compare(original, minimalDocx(['First paragraph of the text.', 'Second paragraph, edited.']));
    const files = unzipDocx(redline);
    const document = readPart(files, '/word/document.xml')!;
    // Wrap the second paragraph's content in a hyperlink to a bookmark.
    const paragraph = document.getElementsByTagNameNS(W_NS, 'p').item(1)!;
    const link = document.createElementNS(W_NS, 'w:hyperlink');
    link.setAttributeNS(W_NS, 'w:anchor', 'nowhere');
    while (paragraph.lastChild && paragraph.lastChild.nodeName !== 'w:pPr') link.insertBefore(paragraph.lastChild, link.firstChild);
    paragraph.appendChild(link);
    writePart(files, '/word/document.xml', document);
    const linked = zipDocx(files);
    const revisions = await listRevisions(linked);
    const before = await render(linked);
    const after = await render(tagRedline(linked, revisions).bytes);
    const anchors = (html: string) => [...html.matchAll(/data-anchor="([^"]+)"/g)].map((m) => m[1]);
    expect(anchors(after)).toEqual(anchors(before));
    expect(before).not.toContain('edited');
    expect(after).toContain('edited');
  });
});

describe('tagRedline', () => {
  let redline: Uint8Array;
  let revisions: RevisionListEntry[];

  beforeAll(async () => {
    await initNodeEngine();
    redline = await compare(
      minimalDocx(['The quick brown fox.', moving, 'A paragraph that goes away.', 'Middle.', 'End.']),
      minimalDocx(['The quick red fox.', 'Middle.', moving, 'End.']),
    );
    revisions = await listRevisions(redline);
  });

  it('sets w:author to rev:<id> on every markup element that has an author', () => {
    const before = new Uint8Array(redline);
    const tagged = tagRedline(redline, revisions);
    expect(tagged.missingKeys).toEqual([]);
    expect(redline).toEqual(before);

    const index = new ElementIndex(readPart(unzipDocx(tagged.bytes), '/word/document.xml')!);
    let checked = 0;
    for (const revision of revisions) {
      for (const key of revision.constituentKeys) {
        const element = index.find(parseConstituentKey(key))!;
        if (element.hasAttributeNS(W_NS, 'author')) {
          expect(element.getAttributeNS(W_NS, 'author')).toBe(revisionAuthor(revision.id));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('makes every revision visible in the rendered HTML as data-author', async () => {
    expect(revisions.map((r) => r.family)).toEqual(expect.arrayContaining(['content_insert', 'content_delete', 'move']));
    const html = await render(tagRedline(redline, revisions).bytes);
    for (const revision of revisions.filter((r) => r.type !== 'format')) {
      expect(html, `${revision.family} ${revision.text}`).toContain(`data-author="${revisionAuthor(revision.id)}"`);
    }
    expect(html).not.toContain('data-author="Docxodus"');
  });

  it('reports keys whose markup is missing instead of failing', () => {
    const bogus: RevisionListEntry = { ...revisions[0]!, constituentKeys: [`kind=Content:${W_NS}:ins:999999`] };
    expect(tagRedline(redline, [bogus]).missingKeys).toEqual([`kind=Content:${W_NS}:ins:999999`]);
  });
});
