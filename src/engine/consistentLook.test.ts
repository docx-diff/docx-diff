import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { planConsistentLook, type FormattingChoice } from './consistentLook';
import { ElementIndex, W_NS, parseConstituentKey, parseXml, serializeXml } from './ooxml';
import { rejectElement } from './rejectRewrite';
import type { RevisionListEntry } from './types';

interface TestRevision {
  id: string;
  /** Markup elements as `localName:w:id`, e.g. `del:1`. */
  markup: string[];
  decision: 'accept' | 'reject';
}

function revision({ id, markup }: TestRevision): RevisionListEntry {
  return {
    id,
    type: 'delete',
    family: 'test',
    constituentKeys: markup.map((name) => {
      const [localName, wId] = name.split(':');
      return `kind=Content:${W_NS}:${localName}:${wId}`;
    }),
    text: '',
    partUri: '/word/document.xml',
    scope: 'body',
    affectedAnchors: [],
    resolutionStatus: 'supported',
  };
}

/** Plans, rejects the rejected revisions' markup, applies the plan; returns the body XML. */
function exportBody(body: string, revisions: TestRevision[], choice: FormattingChoice, outOfRange: string[] = []): string {
  const document = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`);
  const entries = revisions.map(revision);
  const decisions = new Map(revisions.map((r) => [r.id, r.decision]));
  const apply = planConsistentLook(document, entries, decisions, { formattingChoice: choice, outOfRange: new Set(outOfRange) });
  const index = new ElementIndex(document);
  const targets = entries
    .filter((entry) => decisions.get(entry.id) === 'reject')
    .flatMap((entry) => entry.constituentKeys.map((key) => ({ element: index.find(parseConstituentKey(key))!, entry })));
  for (const { element, entry } of targets) rejectElement(element, entry);
  apply();
  const xml = strFromU8(serializeXml(document));
  return xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>')).replace(/ xmlns:w="[^"]*"/g, '');
}

const P = '<w:rFonts w:ascii="Palatino"/>';
const I = '<w:i/>';
const B = '<w:b/>';
/** A run both versions have, restyled: `edited` now, `original` in its `w:rPrChange` (id `fid`). */
const restyled = (text: string, fid: string, original: string, edited = '') =>
  `<w:r><w:rPr>${edited}<w:rPrChange w:id="${fid}" w:author="X"><w:rPr>${original}</w:rPr></w:rPrChange></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const deleted = (text: string, id: string, rPr: string) => `<w:del w:id="${id}" w:author="X"><w:r><w:rPr>${rPr}</w:rPr><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const inserted = (text: string, id: string, rPr: string) => `<w:ins w:id="${id}" w:author="X"><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
/** The run as the export should have it. */
const plain = (text: string, rPr: string) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : '<w:rPr/>'}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const formatting = (...ids: string[]) => ids.map((id): TestRevision => ({ id: `f${id}`, markup: [`rPrChange:${id}`], decision: 'accept' }));

describe('planConsistentLook with the Edited formatting', () => {
  it('gives a restored deletion the Edited look of its neighbour that looked the same in the Original', () => {
    const body = `<w:p>${restyled('a ', '10', P)}${deleted('b ', '1', P)}${restyled('c', '11', P)}</w:p>`;
    const result = exportBody(body, [...formatting('10', '11'), { id: 'd1', markup: ['del:1'], decision: 'reject' }], 'edited');
    expect(result).toContain(plain('b ', ''));
    expect(result).not.toContain('Palatino"/><w:t');
  });

  it('uses the look of the same Original formatting elsewhere when the neighbours looked different', () => {
    const body =
      `<w:p>${restyled('a ', '10', P)}${deleted('b ', '1', `${P}${I}`)}${restyled('c', '11', P)}</w:p>` +
      `<w:p>${restyled('italic', '12', `${P}${I}`, I)}</w:p>`;
    const result = exportBody(body, [...formatting('10', '11', '12'), { id: 'd1', markup: ['del:1'], decision: 'reject' }], 'edited');
    expect(result).toContain(plain('b ', I));
  });

  it('falls back to the nearest kept run’s look when no text had that formatting in both versions', () => {
    const body = `<w:p>${restyled('a ', '10', P)}${deleted('b ', '1', `${P}${B}`)}</w:p>`;
    const result = exportBody(body, [...formatting('10'), { id: 'd1', markup: ['del:1'], decision: 'reject' }], 'edited');
    expect(result).toContain(plain('b ', ''));
  });

  it('leaves note references, accepted deletions and out-of-range text as they are', () => {
    const reference = `<w:del w:id="2" w:author="X"><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="5"/></w:r></w:del>`;
    const body = `<w:p>${restyled('a ', '10', P)}${reference}${deleted('tail', '3', P)}</w:p>`;
    const result = exportBody(
      body,
      [...formatting('10'), { id: 'd2', markup: ['del:2'], decision: 'reject' }, { id: 'd3', markup: ['del:3'], decision: 'reject' }],
      'edited',
      ['d3'],
    );
    expect(result).toContain('<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="5"/></w:r>');
    expect(result).toContain(plain('tail', P));
  });

  it('gives a restored paragraph the Edited properties of a neighbour that had the same Original properties, in schema order', () => {
    const jc = '<w:jc w:val="both"/>';
    const style = '<w:pStyle w:val="BodyText"/>';
    const neighbour = `<w:p><w:pPr>${style}<w:pPrChange w:id="20" w:author="X"><w:pPr>${jc}</w:pPr></w:pPrChange></w:pPr>${restyled('kept', '10', P)}</w:p>`;
    const restored = `<w:p><w:pPr>${jc}<w:rPr><w:del w:id="4" w:author="X"/>${P}</w:rPr></w:pPr>${deleted('restored', '5', P)}</w:p>`;
    const markChange = `<w:p><w:pPr><w:rPr><w:rPrChange w:id="21" w:author="X"><w:rPr>${P}</w:rPr></w:rPrChange></w:rPr></w:pPr></w:p>`;
    const result = exportBody(
      neighbour + restored + markChange,
      [
        ...formatting('10', '21'),
        { id: 'p20', markup: ['pPrChange:20'], decision: 'accept' },
        { id: 'd4', markup: ['del:4', 'del:5'], decision: 'reject' },
      ],
      'edited',
    );
    // The paragraph mark's Palatino is gone too (learned from the paragraph mark both versions have).
    expect(result).toContain(`<w:p><w:pPr>${style}<w:rPr/></w:pPr>${plain('restored', '')}</w:p>`);
  });

  it('keeps a paragraph’s own numbering when it falls back to a neighbour’s properties', () => {
    const numPr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>';
    const neighbour = `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:pPrChange w:id="20" w:author="X"><w:pPr><w:jc w:val="both"/></w:pPr></w:pPrChange></w:pPr>${restyled('kept', '10', P)}</w:p>`;
    const restored = `<w:p><w:pPr><w:pStyle w:val="List"/>${numPr}<w:rPr><w:del w:id="4" w:author="X"/></w:rPr></w:pPr>${deleted('item', '5', P)}</w:p>`;
    const result = exportBody(
      neighbour + restored,
      [...formatting('10'), { id: 'p20', markup: ['pPrChange:20'], decision: 'accept' }, { id: 'd4', markup: ['del:4', 'del:5'], decision: 'reject' }],
      'edited',
    );
    expect(result).toContain(`<w:p><w:pPr><w:pStyle w:val="BodyText"/>${numPr}<w:rPr/></w:pPr>`);
  });
});

describe('planConsistentLook with the Original formatting', () => {
  it('gives an accepted insertion the Original look of its neighbour', () => {
    const body = `<w:p>${restyled('a ', '10', P)}${inserted('new ', '1', '')}${restyled('c', '11', P)}</w:p>`;
    const result = exportBody(
      body,
      [...formatting('10', '11').map((r): TestRevision => ({ ...r, decision: 'reject' })), { id: 'i1', markup: ['ins:1'], decision: 'accept' }],
      'original',
    );
    expect(result).toContain(`<w:ins w:id="1" w:author="X">${plain('new ', P)}</w:ins>`);
  });

  it('leaves a restored deletion as it is: it already has the Original look', () => {
    const body = `<w:p>${restyled('a ', '10', P)}${deleted('b', '1', `${P}${B}`)}</w:p>`;
    const result = exportBody(
      body,
      [...formatting('10').map((r): TestRevision => ({ ...r, decision: 'reject' })), { id: 'd1', markup: ['del:1'], decision: 'reject' }],
      'original',
    );
    expect(result).toContain(plain('b', `${P}${B}`));
  });
});
