import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Document } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { ElementIndex, W_NS, parseXml, serializeXml } from './ooxml';
import { RevisionMarkupError, UnsupportedRevisionError, rejectElement, rejectRevisions } from './rejectRewrite';
import type { RevisionListEntry } from './types';

const DOC_START = `<w:document xmlns:w="${W_NS}"><w:body>`;
const DOC_END = '</w:body></w:document>';

function parseBody(fragment: string): Document {
  return parseXml(DOC_START + fragment + DOC_END);
}

/** The body's content as serialized XML. */
function bodyXml(document: Document): string {
  const xml = strFromU8(serializeXml(document));
  return xml.slice(xml.indexOf('<w:body>') + '<w:body>'.length, xml.lastIndexOf('</w:body>'));
}

/** The fragment as the serializer writes it (so expected XML may be written freely). */
function canonical(fragment: string): string {
  return bodyXml(parseBody(fragment));
}

/** Rejects the elements named `localName:id` in `fragment` and returns the resulting body XML. */
function reject(fragment: string, ...elements: string[]): string {
  const document = parseBody(fragment);
  const index = new ElementIndex(document);
  const found = elements.map((name) => {
    const [localName, id] = name.split(':') as [string, string];
    const element = index.get(W_NS, localName, id);
    if (!element) throw new Error(`test setup: no ${name}`);
    return element;
  });
  for (const element of found) rejectElement(element, { id: 'r1', family: 'test' });
  return bodyXml(document);
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;

describe('rejectElement', () => {
  it('turns an insertion around runs into a deletion, with deleted text and field codes', () => {
    const input = `<w:p>${run('a')}<w:ins w:id="1" w:author="X"><w:r><w:instrText>PAGE</w:instrText></w:r>${run('b')}</w:ins></w:p>`;
    expect(reject(input, 'ins:1')).toBe(
      canonical(`<w:p>${run('a')}<w:del w:id="1" w:author="X"><w:r><w:delInstrText>PAGE</w:delInstrText></w:r>${delRun('b')}</w:del></w:p>`),
    );
  });

  it('unwraps a deletion around runs and restores its text and field codes', () => {
    const input = `<w:p>${run('a')}<w:del w:id="1"><w:r><w:delInstrText>PAGE</w:delInstrText></w:r>${delRun('b')}</w:del>${run('c')}</w:p>`;
    expect(reject(input, 'del:1')).toBe(canonical(`<w:p>${run('a')}<w:r><w:instrText>PAGE</w:instrText></w:r>${run('b')}${run('c')}</w:p>`));
  });

  it('restores the old run properties', () => {
    const input = `<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:rPrChange w:id="1"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>a</w:t></w:r></w:p>`;
    expect(reject(input, 'rPrChange:1')).toBe(canonical(`<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t></w:r></w:p>`));
  });

  it('restores a paragraph mark’s run properties after its revision markers', () => {
    const input = `<w:p><w:pPr><w:rPr><w:ins w:id="2"/><w:b/><w:rPrChange w:id="1"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr></w:pPr></w:p>`;
    expect(reject(input, 'rPrChange:1')).toBe(canonical(`<w:p><w:pPr><w:rPr><w:ins w:id="2"/><w:i/></w:rPr></w:pPr></w:p>`));
  });

  it('restores the old paragraph properties first, then the paragraph’s own w:rPr and w:sectPr', () => {
    const input =
      '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr><w:sectPr><w:pgSz w:w="1"/></w:sectPr>' +
      '<w:pPrChange w:id="1"><w:pPr><w:pStyle w:val="Old"/><w:spacing w:after="0"/></w:pPr></w:pPrChange></w:pPr></w:p>';
    expect(reject(input, 'pPrChange:1')).toBe(
      canonical('<w:p><w:pPr><w:pStyle w:val="Old"/><w:spacing w:after="0"/><w:rPr><w:b/></w:rPr><w:sectPr><w:pgSz w:w="1"/></w:sectPr></w:pPr></w:p>'),
    );
  });

  it('restores empty old paragraph properties', () => {
    const input = '<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="1"><w:pPr/></w:pPrChange></w:pPr></w:p>';
    expect(reject(input, 'pPrChange:1')).toBe(canonical('<w:p><w:pPr></w:pPr></w:p>'));
  });

  it('restores the old section properties after the header and footer references', () => {
    const input =
      '<w:sectPr><w:headerReference w:type="default"/><w:footerReference w:type="default"/><w:pgSz w:w="2"/>' +
      '<w:sectPrChange w:id="1"><w:sectPr><w:pgSz w:w="1"/><w:pgMar w:top="1"/></w:sectPr></w:sectPrChange></w:sectPr>';
    expect(reject(input, 'sectPrChange:1')).toBe(
      canonical('<w:sectPr><w:headerReference w:type="default"/><w:footerReference w:type="default"/><w:pgSz w:w="1"/><w:pgMar w:top="1"/></w:sectPr>'),
    );
  });

  it('turns an inserted paragraph mark into a deleted one, and drops a deleted one', () => {
    const input = '<w:p><w:pPr><w:rPr><w:ins w:id="1"/><w:b/></w:rPr></w:pPr></w:p><w:p><w:pPr><w:rPr><w:del w:id="2"/></w:rPr></w:pPr></w:p>';
    expect(reject(input, 'ins:1', 'del:2')).toBe(
      canonical('<w:p><w:pPr><w:rPr><w:del w:id="1"/><w:b/></w:rPr></w:pPr></w:p><w:p><w:pPr><w:rPr></w:rPr></w:pPr></w:p>'),
    );
  });

  it('keeps moved content at its source: unwraps w:moveFrom, deletes w:moveTo, drops the range markers', () => {
    const input =
      `<w:p><w:moveFromRangeStart w:id="3" w:name="move1"/><w:moveFrom w:id="1">${delRun('m')}</w:moveFrom><w:moveFromRangeEnd w:id="3"/></w:p>` +
      `<w:p><w:moveToRangeStart w:id="6" w:name="move1"/><w:moveTo w:id="4">${run('m')}</w:moveTo><w:moveToRangeEnd w:id="6"/></w:p>`;
    const result = reject(input, 'moveFromRangeStart:3', 'moveFromRangeEnd:3', 'moveFrom:1', 'moveTo:4', 'moveToRangeStart:6', 'moveToRangeEnd:6');
    expect(result).toBe(canonical(`<w:p>${run('m')}</w:p><w:p><w:del w:id="4">${delRun('m')}</w:del></w:p>`));
  });

  it('handles move markers on a paragraph mark', () => {
    const input = '<w:p><w:pPr><w:rPr><w:moveFrom w:id="1"/></w:rPr></w:pPr></w:p><w:p><w:pPr><w:rPr><w:moveTo w:id="2"/></w:rPr></w:pPr></w:p>';
    expect(reject(input, 'moveFrom:1', 'moveTo:2')).toBe(
      canonical('<w:p><w:pPr><w:rPr></w:rPr></w:pPr></w:p><w:p><w:pPr><w:rPr><w:del w:id="2"/></w:rPr></w:pPr></w:p>'),
    );
  });

  it('turns an inserted table row into a deleted one, and drops a row’s deletion marker', () => {
    const cell = '<w:tc><w:p/></w:tc>';
    const input = `<w:tbl><w:tr><w:trPr><w:ins w:id="1"/></w:trPr>${cell}</w:tr><w:tr><w:trPr><w:cantSplit/><w:del w:id="2"/></w:trPr>${cell}</w:tr></w:tbl>`;
    expect(reject(input, 'ins:1', 'del:2')).toBe(
      canonical(`<w:tbl><w:tr><w:trPr><w:del w:id="1"/></w:trPr>${cell}</w:tr><w:tr><w:trPr><w:cantSplit/></w:trPr>${cell}</w:tr></w:tbl>`),
    );
  });

  it('turns an inserted cell into a deleted one, and drops a cell’s deletion marker', () => {
    const input = '<w:tc><w:tcPr><w:tcW w:w="1"/><w:cellIns w:id="1"/></w:tcPr></w:tc><w:tc><w:tcPr><w:cellDel w:id="2"/></w:tcPr></w:tc>';
    expect(reject(input, 'cellIns:1', 'cellDel:2')).toBe(
      canonical('<w:tc><w:tcPr><w:tcW w:w="1"/><w:cellDel w:id="1"/></w:tcPr></w:tc><w:tc><w:tcPr></w:tcPr></w:tc>'),
    );
  });

  it('restores old table, row, cell, exception and grid properties, keeping revision markers last', () => {
    const input =
      '<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblPrChange w:id="1"><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr></w:tblPrChange></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3"/><w:tblGridChange w:id="2"><w:tblGrid><w:gridCol w:w="2"/></w:tblGrid></w:tblGridChange></w:tblGrid>' +
      '<w:tr><w:tblPrEx><w:jc w:val="left"/><w:tblPrExChange w:id="3"><w:tblPrEx/></w:tblPrExChange></w:tblPrEx>' +
      '<w:trPr><w:trHeight w:val="5"/><w:ins w:id="9"/><w:trPrChange w:id="4"><w:trPr><w:cantSplit/></w:trPr></w:trPrChange></w:trPr>' +
      '<w:tc><w:tcPr><w:tcW w:w="3"/><w:shd w:fill="FF0000"/><w:cellIns w:id="8"/><w:tcPrChange w:id="5"><w:tcPr><w:tcW w:w="2"/></w:tcPr></w:tcPrChange></w:tcPr><w:p/></w:tc></w:tr></w:tbl>';
    expect(reject(input, 'tblPrChange:1', 'tblGridChange:2', 'tblPrExChange:3', 'trPrChange:4', 'tcPrChange:5')).toBe(
      canonical(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2"/></w:tblGrid>' +
          '<w:tr><w:tblPrEx></w:tblPrEx><w:trPr><w:cantSplit/><w:ins w:id="9"/></w:trPr>' +
          '<w:tc><w:tcPr><w:tcW w:w="2"/><w:cellIns w:id="8"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>',
      ),
    );
  });

  it('throws UnsupportedRevisionError for other markup', () => {
    expect(() => reject('<w:p><w:customXmlInsRangeStart w:id="1"/></w:p>', 'customXmlInsRangeStart:1')).toThrow(UnsupportedRevisionError);
    expect(() => reject('<w:p><w:pPr><w:numPr><w:ins w:id="1"/></w:numPr></w:pPr></w:p>', 'ins:1')).toThrow(UnsupportedRevisionError);
  });
});

describe('rejectRevisions', () => {
  const docx = (body: string) =>
    zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>${DOC_START}${body}${DOC_END}`) });
  const documentXml = (bytes: Uint8Array) => bodyXml(parseXml(unzipSync(bytes)['word/document.xml']!));
  const revision = (id: string, family: string, keys: string[]): RevisionListEntry => ({
    id,
    type: 'delete',
    family,
    constituentKeys: keys,
    text: '',
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: [],
    resolutionStatus: 'supported',
  });

  const body = `<w:p><w:pPr><w:rPr><w:del w:id="2"/></w:rPr></w:pPr><w:del w:id="1">${delRun('gone')}</w:del></w:p><w:p><w:ins w:id="3">${run('new')}</w:ins></w:p>`;
  const deletion = revision('d', 'content_delete', [`kind=Content:${W_NS}:del:1`, `kind=ParaMark:${W_NS}:del:2`]);
  const insertion = revision('i', 'content_insert', [`kind=Content:${W_NS}:ins:3`]);

  it('rewrites only the rejected revisions, choosing the rule by where the element sits', () => {
    // The content deletion also lists the paragraph mark it removes: the run is restored and the mark kept.
    const result = rejectRevisions(docx(body), [deletion, insertion], new Set(['d']));
    expect(documentXml(result)).toBe(canonical(`<w:p><w:pPr><w:rPr></w:rPr></w:pPr>${run('gone')}</w:p><w:p><w:ins w:id="3">${run('new')}</w:ins></w:p>`));
  });

  it('throws RevisionMarkupError naming the revision when its markup is missing', () => {
    const missing = revision('m', 'content_delete', [`kind=Content:${W_NS}:del:99`]);
    expect(() => rejectRevisions(docx(body), [missing], new Set(['m']))).toThrow(RevisionMarkupError);
    expect(() => rejectRevisions(docx(body), [missing], new Set(['m']))).toThrow(/revision m.*no element matches/);
  });

  it('throws RevisionMarkupError when several elements have the name and id', () => {
    const twice = `<w:p><w:ins w:id="3">${run('a')}</w:ins></w:p>` + body;
    expect(() => rejectRevisions(docx(twice), [insertion], new Set(['i']))).toThrow(/several elements match/);
  });

  it('throws RevisionMarkupError when the revision’s part is missing', () => {
    const inFootnotes = { ...insertion, partUri: '/word/footnotes.xml' };
    expect(() => rejectRevisions(docx(body), [inFootnotes], new Set(['i']))).toThrow(/no part \/word\/footnotes.xml/);
  });
});

