import { strFromU8, strToU8 } from 'fflate';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { Segment } from '../model/paragraphEdit';
import { OBJECT_CHAR } from '../model/paragraphEdit';
import { EditPatchError, applyEdits, unpatchableContent } from './applyEdits';
import { paragraphUnids } from './blockKey';
import { ElementIndex, W_NS, parseConstituentKey, parseXml, unzipDocx, zipDocx, type DocxFiles } from './ooxml';
import { rejectRevisions } from './rejectRewrite';
import type { RevisionListEntry } from './types';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DOCUMENT = 'word/document.xml';

function files(paragraph: string): DocxFiles {
  return { [DOCUMENT]: strToU8(`<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${paragraph}<w:sectPr/></w:body></w:document>`) };
}

/** The unid of the first paragraph. */
async function unidOf(parts: DocxFiles): Promise<string> {
  return [...(await paragraphUnids(parseXml(parts[DOCUMENT]!))).keys()][0]!;
}

function revision(id: string, type: 'insert' | 'delete' | 'format', keys: string[]): RevisionListEntry {
  return {
    id,
    type,
    family: type === 'insert' ? 'content_insert' : type === 'delete' ? 'content_delete' : 'properties_change',
    constituentKeys: keys,
    text: '',
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: [],
    resolutionStatus: 'supported',
  };
}

const content = (name: 'ins' | 'del', id: number) => `kind=Content:${W_NS}:${name}:${id}`;
const eq = (text: string): Segment => ({ kind: 'equal', text });
const ins = (text: string, revisionId: string, itemId = revisionId): Segment => ({ kind: 'ins', text, itemId, revisionId });
const del = (text: string, revisionId: string, itemId = revisionId): Segment => ({ kind: 'del', text, itemId, revisionId });
const object = (key: string): Segment => ({ kind: 'object', key });

/** The body's paragraphs as serialized XML, without the namespace declarations and the section. */
function bodyXml(parts: DocxFiles): string {
  const xml = strFromU8(parts[DOCUMENT]!);
  return xml.slice(xml.indexOf('<w:body>') + '<w:body>'.length, xml.lastIndexOf('<w:sectPr'));
}

/** The paragraph's text with every revision accepted, or rejected. */
function text(parts: DocxFiles, view: 'accepted' | 'rejected'): string {
  const document = parseXml(parts[DOCUMENT]!);
  let result = '';
  const walk = (element: Element, skipped: boolean): void => {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== child.ELEMENT_NODE) continue;
      const node = child as Element;
      const skip = skipped || node.localName === (view === 'accepted' ? 'del' : 'ins');
      if (node.localName === 't' || node.localName === 'delText') {
        if (!skip) result += node.textContent;
      } else if (OBJECTS.has(node.localName!)) {
        if (!skip) result += OBJECT_CHAR;
      } else {
        walk(node, skip);
      }
    }
  };
  walk(document.documentElement!, false);
  return result;
}
const OBJECTS = new Set(['tab', 'br', 'footnoteReference']);

/** Every key names exactly one element of the part. */
function expectKeysResolve(parts: DocxFiles, revisions: readonly RevisionListEntry[]): void {
  const index = new ElementIndex(parseXml(parts[DOCUMENT]!));
  for (const entry of revisions) {
    for (const key of entry.constituentKeys) expect(index.find(parseConstituentKey(key)), `${entry.id} ${key}`).toBeDefined();
  }
}

async function patch(paragraph: string, revisions: RevisionListEntry[], segments: (unid: string) => Segment[]) {
  const parts = files(paragraph);
  const unid = await unidOf(parts);
  const updated = await applyEdits(parts, revisions, [{ unid, scope: 'body', segments: segments(unid) }]);
  expectKeysResolve(parts, updated);
  return { parts, revisions: updated };
}

const AUTHOR = 'w:author="Docxodus" w:date="2000-01-01T00:00:00Z"';

describe('applyEdits on plain runs', () => {
  const paragraph = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Kept text here</w:t></w:r></w:p>';

  it('inserts typed text as a new w:ins with the formatting of the character before it', async () => {
    const { parts, revisions } = await patch(paragraph, [revision('n1', 'insert', [])], () => [eq('Kept '), ins('new ', 'n1'), eq('text here')]);
    expect(bodyXml(parts)).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Kept </w:t></w:r>' +
        '<w:ins w:id="1" w:author="Docxodus"><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">new </w:t></w:r></w:ins>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">text here</w:t></w:r></w:p>',
    );
    expect(revisions).toEqual([revision('n1', 'insert', [content('ins', 1)])]);
  });

  it('takes the formatting of the character after typed text at the start', async () => {
    const { parts } = await patch(paragraph, [revision('n1', 'insert', [])], () => [ins('New ', 'n1'), eq('Kept text here')]);
    expect(bodyXml(parts)).toContain('<w:ins w:id="1" w:author="Docxodus"><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">New </w:t></w:r></w:ins><w:r>');
  });

  it('wraps deleted text in a new w:del', async () => {
    const { parts, revisions } = await patch(paragraph, [revision('n1', 'delete', [])], () => [eq('Kept '), del('text ', 'n1'), eq('here')]);
    expect(bodyXml(parts)).toContain('<w:del w:id="1" w:author="Docxodus"><w:r><w:rPr><w:b/></w:rPr><w:delText xml:space="preserve">text </w:delText></w:r></w:del>');
    expect([text(parts, 'accepted'), text(parts, 'rejected')]).toEqual(['Kept here', 'Kept text here']);
    expect(revisions[0]!.constituentKeys).toEqual([content('del', 1)]);
  });

  it('replaces a word with a deletion and an insertion in the segments’ order', async () => {
    const { parts, revisions } = await patch(paragraph, [revision('n1', 'delete', []), revision('n2', 'insert', [])], () => [
      eq('Kept '),
      del('text', 'n1'),
      ins('words', 'n2', 'n1'),
      eq(' here'),
    ]);
    expect(bodyXml(parts)).toMatch(/<w:del w:id="1"[^>]*>.*text.*<\/w:del><w:ins w:id="(\d+)"[^>]*>.*words.*<\/w:ins>/);
    expect([text(parts, 'accepted'), text(parts, 'rejected')]).toEqual(['Kept words here', 'Kept text here']);
    const insId = /<w:ins w:id="(\d+)"/.exec(bodyXml(parts))![1];
    expect(revisions.map((entry) => entry.constituentKeys)).toEqual([[content('del', 1)], [content('ins', Number(insId))]]);
  });

  it('allocates ids above every id of the part', async () => {
    const { parts } = await patch('<w:p><w:bookmarkStart w:id="40" w:name="b"/><w:r><w:t>Kept</w:t></w:r><w:bookmarkEnd w:id="40"/></w:p>', [revision('n1', 'insert', [])], () => [
      eq('Kept'),
      ins('!', 'n1'),
    ]);
    expect(bodyXml(parts)).toContain('<w:ins w:id="41"');
  });

  it('types into an empty paragraph', async () => {
    const { parts } = await patch('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>', [revision('n1', 'insert', [])], () => [ins('New', 'n1')]);
    expect(bodyXml(parts)).toBe('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:ins w:id="1" w:author="Docxodus"><w:r><w:t xml:space="preserve">New</w:t></w:r></w:ins></w:p>');
  });

  it('leaves the paragraph as it was when the segments are its own', async () => {
    const { parts } = await patch(paragraph, [], () => [eq('Kept text here')]);
    expect(bodyXml(parts)).toBe(paragraph);
  });

  it('fails when the segments’ Original text is not the paragraph’s', async () => {
    const parts = files(paragraph);
    const unid = await unidOf(parts);
    await expect(applyEdits(parts, [], [{ unid, scope: 'body', segments: [eq('Other text here')] }])).rejects.toThrow(EditPatchError);
    await expect(applyEdits(parts, [], [{ unid: 'missing', scope: 'body', segments: [] }])).rejects.toThrow(/no paragraph/);
  });
});

describe('applyEdits in paragraphs with engine revisions', () => {
  const engineReplace =
    `<w:p><w:r><w:t xml:space="preserve">at the edge of the </w:t></w:r>` +
    `<w:ins w:id="1" ${AUTHOR}><w:r><w:t>jungle</w:t></w:r></w:ins>` +
    `<w:del w:id="2" ${AUTHOR}><w:r><w:delText>forest</w:delText></w:r></w:del>` +
    `<w:r><w:t>, where</w:t></w:r></w:p>`;
  const engineRevisions = () => [revision('R1', 'insert', [content('ins', 1)]), revision('R2', 'delete', [content('del', 2)])];

  it('changes the text of an engine insertion in place, keeping its element and id', async () => {
    const paragraph = `<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:ins w:id="1" ${AUTHOR}><w:r><w:rPr><w:i/></w:rPr><w:t>hosue</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> stood</w:t></w:r></w:p>`;
    const { parts, revisions } = await patch(paragraph, [revision('R1', 'insert', [content('ins', 1)])], () => [eq('The '), ins('house', 'R1'), eq(' stood')]);
    expect(bodyXml(parts)).toBe(
      `<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:ins w:id="1" ${AUTHOR}><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">house</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> stood</w:t></w:r></w:p>`,
    );
    expect(revisions[0]!.constituentKeys).toEqual([content('ins', 1)]);
  });

  it('edits one run of an engine insertion that has several, leaving it one element', async () => {
    const paragraph = `<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:ins w:id="1" ${AUTHOR}><w:r><w:t xml:space="preserve">big </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>hosue</w:t></w:r></w:ins></w:p>`;
    const { parts, revisions } = await patch(paragraph, [revision('R1', 'insert', [content('ins', 1)])], () => [eq('The '), ins('big house', 'R1')]);
    expect(bodyXml(parts)).toBe(
      `<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:ins w:id="1" ${AUTHOR}><w:r><w:t xml:space="preserve">big </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">house</w:t></w:r></w:ins></w:p>`,
    );
    expect(revisions[0]!.constituentKeys).toEqual([content('ins', 1)]);
  });

  it('drops the revisions of a replacement whose Original was typed back', async () => {
    const { parts, revisions } = await patch(engineReplace, engineRevisions(), () => [eq('at the edge of the forest, where')]);
    expect(bodyXml(parts)).toBe('<w:p><w:r><w:t xml:space="preserve">at the edge of the forest, where</w:t></w:r></w:p>');
    expect(revisions).toEqual([]);
  });

  it('drops an engine insertion deleted entirely, keeping its deletion', async () => {
    const { parts, revisions } = await patch(engineReplace, engineRevisions(), () => [eq('at the edge of the '), del('forest', 'R2'), eq(', where')]);
    expect([text(parts, 'accepted'), text(parts, 'rejected')]).toEqual(['at the edge of the , where', 'at the edge of the forest, where']);
    expect(revisions.map((entry) => entry.id)).toEqual(['R2']);
  });

  it('splits an engine deletion partly typed back, with a new id for the extra element', async () => {
    const { parts, revisions } = await patch(engineReplace, engineRevisions(), () => [
      eq('at the edge of the '),
      ins('jungle', 'R1'),
      del('for', 'R2'),
      eq('e'),
      del('st', 'R2'),
      eq(', where'),
    ]);
    expect(bodyXml(parts)).toContain(
      `<w:del w:id="2" ${AUTHOR}><w:r><w:delText xml:space="preserve">for</w:delText></w:r></w:del><w:r><w:t xml:space="preserve">e</w:t></w:r>` +
        `<w:del w:id="${revisions[1]!.constituentKeys[1]!.split(':').pop()}" ${AUTHOR}><w:r><w:delText xml:space="preserve">st</w:delText></w:r></w:del>`,
    );
    expect(revisions[1]!.constituentKeys).toHaveLength(2);
    expect(text(parts, 'rejected')).toBe('at the edge of the forest, where');
    expect(text(parts, 'accepted')).toBe('at the edge of the junglee, where');
  });

  it('extends an engine insertion with typed text, in its own element', async () => {
    const { parts, revisions } = await patch(engineReplace, engineRevisions(), () => [
      eq('at the edge of the '),
      ins('jungles', 'R1'),
      del('forest', 'R2'),
      eq(', where'),
    ]);
    expect(bodyXml(parts)).toContain(`<w:ins w:id="1" ${AUTHOR}><w:r><w:t xml:space="preserve">jungles</w:t></w:r></w:ins>`);
    expect(revisions.map((entry) => entry.constituentKeys)).toEqual([[content('ins', 1)], [content('del', 2)]]);
  });

  it('puts a new item between engine items without joining them', async () => {
    const { parts, revisions } = await patch(engineReplace, [...engineRevisions(), revision('n1', 'delete', []), revision('n2', 'insert', [])], () => [
      eq('at the edge of the '),
      ins('jungle', 'R1'),
      del('forest', 'R2'),
      del(', where', 'n1'),
      ins('.', 'n2', 'n1'),
    ]);
    expect([text(parts, 'accepted'), text(parts, 'rejected')]).toEqual(['at the edge of the jungle.', 'at the edge of the forest, where']);
    expect(revisions.map((entry) => [entry.id, entry.constituentKeys.length])).toEqual([['R1', 1], ['R2', 1], ['n1', 1], ['n2', 1]]);
    const xml = bodyXml(parts);
    expect(xml.indexOf('forest')).toBeLessThan(xml.indexOf(', where'));
  });

  it('gives formatting markup of a split run new ids, all in its revision', async () => {
    const paragraph = `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="5" ${AUTHOR}><w:rPr/></w:rPrChange></w:rPr><w:t>bold words</w:t></w:r></w:p>`;
    const format = revision('F', 'format', [`kind=PropsChange:${W_NS}:rPrChange:5`]);
    const { parts, revisions } = await patch(paragraph, [format, revision('n1', 'delete', [])], () => [eq('bold '), del('words', 'n1')]);
    const [updatedFormat] = revisions;
    expect(updatedFormat!.constituentKeys).toHaveLength(2);
    expect(bodyXml(parts).match(/<w:rPrChange/g)).toHaveLength(2);
    // Rejecting the formatting change restores the old properties of both pieces.
    const rejected = unzipDocx(rejectRevisions(zipDocx(parts), revisions, new Set(['F'])));
    expect(strFromU8(rejected[DOCUMENT]!)).not.toContain('<w:b/>');
  });
});

describe('applyEdits keeps other paragraph content in place', () => {
  it('edits inside a hyperlink, inside the link', async () => {
    const paragraph =
      '<w:p><w:r><w:t xml:space="preserve">More is on </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the website</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>';
    const { parts } = await patch(paragraph, [revision('n1', 'delete', []), revision('n2', 'insert', [])], () => [
      eq('More is on the '),
      del('website', 'n1'),
      ins('home page', 'n2', 'n1'),
      eq('.'),
    ]);
    const xml = bodyXml(parts);
    expect(xml).toMatch(/<w:hyperlink r:id="rId5"><w:r>.*the .*<w:del [^>]*>.*website.*<\/w:del><w:ins [^>]*><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">home page<\/w:t><\/w:r><\/w:ins><\/w:hyperlink><w:r><w:t>\.<\/w:t>/);
  });

  it('keeps bookmarks and comment ranges where they were', async () => {
    const paragraph =
      '<w:p><w:r><w:t>Alpha</w:t></w:r><w:bookmarkStart w:id="0" w:name="b"/><w:commentRangeStart w:id="3"/><w:r><w:t xml:space="preserve"> beta</w:t></w:r><w:commentRangeEnd w:id="3"/><w:bookmarkEnd w:id="0"/><w:r><w:t xml:space="preserve"> gamma</w:t></w:r></w:p>';
    const { parts } = await patch(paragraph, [revision('n1', 'delete', []), revision('n2', 'insert', [])], () => [eq('Alpha '), del('beta', 'n1'), ins('delta', 'n2', 'n1'), eq(' gamma')]);
    expect(bodyXml(parts)).toMatch(
      /^<w:p><w:r><w:t>Alpha<\/w:t><\/w:r><w:bookmarkStart w:id="0" w:name="b"\/><w:commentRangeStart w:id="3"\/><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:del [^>]*>.*beta.*<\/w:del><w:ins [^>]*>.*delta.*<\/w:ins><w:commentRangeEnd w:id="3"\/><w:bookmarkEnd w:id="0"\/><w:r><w:t xml:space="preserve"> gamma/,
    );
  });

  it('keeps a footnote reference, and types after it with the text’s formatting', async () => {
    const paragraph =
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Text</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>';
    const { parts } = await patch(paragraph, [revision('n1', 'insert', [])], () => [eq('Text'), object('fn:1'), ins(' more', 'n1')]);
    expect(bodyXml(parts)).toBe(
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Text</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
        '<w:ins w:id="2" w:author="Docxodus"><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> more</w:t></w:r></w:ins></w:p>',
    );
  });

  it('keeps tabs and breaks as they are and types around them', async () => {
    const paragraph = '<w:p><w:r><w:t>One</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r></w:p>';
    const { parts } = await patch(paragraph, [revision('n1', 'insert', [])], () => [eq('One'), object('tab'), eq('two'), ins('!', 'n1'), object('br'), eq('three')]);
    expect(bodyXml(parts)).toBe(
      '<w:p><w:r><w:t xml:space="preserve">One</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">two</w:t></w:r>' +
        '<w:ins w:id="1" w:author="Docxodus"><w:r><w:t xml:space="preserve">!</w:t></w:r></w:ins><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">three</w:t></w:r></w:p>',
    );
  });

  it('keeps an inserted note reference in its insertion when text around it changes', async () => {
    const paragraph = `<w:p><w:r><w:t>Text</w:t></w:r><w:ins w:id="1" ${AUTHOR}><w:r><w:footnoteReference w:id="2"/></w:r></w:ins></w:p>`;
    const { parts, revisions } = await patch(paragraph, [revision('R1', 'insert', [content('ins', 1)]), revision('n1', 'insert', [])], () => [
      eq('Text'),
      ins('s', 'n1'),
      { kind: 'object', key: 'fn:2', owner: { change: 'ins', itemId: 'R1', revisionId: 'R1' } },
    ]);
    expect(bodyXml(parts)).toContain(`<w:ins w:id="1" ${AUTHOR}><w:r><w:footnoteReference w:id="2"/></w:r></w:ins>`);
    expect(revisions.map((entry) => entry.constituentKeys)).toEqual([[content('ins', 1)], [content('ins', 3)]]);
  });

  it('refuses paragraphs with fields and other markup it does not know', async () => {
    const field = '<w:p><w:r><w:t>Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const parts = files(field);
    const unid = await unidOf(parts);
    await expect(applyEdits(parts, [revision('n1', 'insert', [])], [{ unid, scope: 'body', segments: [eq('Page '), ins('x', 'n1')] }])).rejects.toThrow(/fldChar/);
    const sdt = files('<w:p><w:sdt><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>');
    await expect(applyEdits(sdt, [], [{ unid: await unidOf(sdt), scope: 'body', segments: [eq('x')] }])).rejects.toThrow(/w:sdt/);
  });

  it('names the content it refuses, beyond fields and content controls (unpatchableContent)', () => {
    const paragraph = (xml: string) => parseXml(files(xml)[DOCUMENT]!).getElementsByTagNameNS(W_NS, 'p').item(0)!;
    const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
    expect(unpatchableContent(paragraph('<w:p><w:pPr/><w:bookmarkStart w:id="0" w:name="a"/><w:hyperlink r:id="r1"><w:r><w:t>a</w:t></w:r></w:hyperlink><w:ins w:id="1"><w:r><w:tab/></w:r></w:ins></w:p>'))).toBeUndefined();
    for (const [xml, reason] of [
      ['<w:p><w:customXml><w:r><w:t>a</w:t></w:r></w:customXml></w:p>', /w:customXml/],
      ['<w:p><w:dir w:val="rtl"><w:r><w:t>a</w:t></w:r></w:dir></w:p>', /w:dir/],
      [`<w:p><m:oMath xmlns:m="${M_NS}"/></w:p>`, /oMath/],
      ['<w:p><w:del w:id="1"><w:ins w:id="2"><w:r><w:t>a</w:t></w:r></w:ins></w:del></w:p>', /nested w:ins/],
      ['<w:p><w:ins w:id="1"><w:hyperlink r:id="r1"><w:r><w:t>a</w:t></w:r></w:hyperlink></w:ins></w:p>', /w:hyperlink inside a change/],
      ['<w:p><w:r><w:pgNum/></w:r></w:p>', /pgNum/],
      ['<w:p><w:r><w:sym w:char="F04A"/></w:r></w:p>', /sym/],
    ] as const) {
      expect(unpatchableContent(paragraph(xml)), xml).toMatch(reason);
    }
  });

  it('fails on a revision the request does not list', async () => {
    const parts = files('<w:p><w:r><w:t>Kept</w:t></w:r></w:p>');
    const unid = await unidOf(parts);
    await expect(applyEdits(parts, [], [{ unid, scope: 'body', segments: [eq('Kept'), ins('!', 'n1')] }])).rejects.toThrow(/no entry/);
  });
});
